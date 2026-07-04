# Collections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement git-friendly collection storage (arbitrary-depth folders, REST + SOAP requests, drag-reorder within siblings) from Rust persistence layer through to a live sidebar tree.

**Architecture:** Rust `persistence::collection` owns all disk I/O (TOML files + directories); thin Tauri commands expose CRUD; a zustand store on the frontend hydrates from those commands and drives a recursive `CollectionTree` component with `@dnd-kit/sortable` for drag-reorder.

**Tech Stack:** Rust (toml, uuid, anyhow), Tauri v2 commands, TypeScript zustand store, React, @dnd-kit/core + @dnd-kit/sortable.

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `src-tauri/src/persistence/mod.rs` | expose `collection` submodule |
| Create | `src-tauri/src/persistence/collection.rs` | all disk read/write + domain types |
| Create | `src-tauri/src/commands/mod.rs` | thin Tauri command handlers |
| Modify | `src-tauri/src/lib.rs` | add `mod persistence; mod commands;`, register commands |
| Modify | `src-tauri/Cargo.toml` | add `toml`, `uuid`, `anyhow` |
| Create | `src/lib/api.ts` | typed `invoke` wrappers + TS types |
| Create | `src/store/collectionStore.ts` | zustand slice for collection tree |
| Create | `src/components/CollectionTree.tsx` | recursive sortable tree renderer |
| Modify | `src/components/Sidebar.tsx` | replace static mock with `CollectionTree` |

---

## Task 1: Add Rust dependencies

**Files:**
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Add dependencies**

Open `src-tauri/Cargo.toml` and add to `[dependencies]`:

```toml
anyhow = "1"
toml = "0.8"
uuid = { version = "1", features = ["v4"] }
```

- [ ] **Step 2: Verify it compiles**

```bash
cd src-tauri && cargo check
```

Expected: `Finished` with no errors (warnings OK).

- [ ] **Step 3: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "chore: add toml, uuid, anyhow dependencies"
```

---

## Task 2: Scaffold persistence module + implement read/list

**Files:**
- Create: `src-tauri/src/persistence/mod.rs`
- Create: `src-tauri/src/persistence/collection.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Create persistence/mod.rs**

Create `src-tauri/src/persistence/mod.rs`:

```rust
pub mod collection;
```

- [ ] **Step 2: Add mod declaration to lib.rs**

In `src-tauri/src/lib.rs`, add before the `greet` function:

```rust
mod persistence;
```

- [ ] **Step 3: Write failing tests for list_collections**

Create `src-tauri/src/persistence/collection.rs` with just the test module first:

```rust
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

// ── Types ────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum CollectionNode {
    Folder {
        id: String,
        name: String,
        children: Vec<CollectionNode>,
    },
    Request {
        id: String,
        name: String,
        #[serde(flatten)]
        kind: RequestKind,
    },
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum RequestKind {
    Rest { method: String, url: String },
    Soap { wsdl_url: String, operation: String },
}

#[derive(Serialize, Deserialize, Default)]
struct RootMeta {
    #[serde(default)]
    children_order: Vec<String>,
}

#[derive(Serialize, Deserialize)]
struct FolderMeta {
    name: String,
    #[serde(default)]
    children_order: Vec<String>,
}

#[derive(Serialize, Deserialize)]
struct RequestFile {
    id: String,
    name: String,
    #[serde(flatten)]
    kind: RequestKind,
}

// ── Path helpers ─────────────────────────────────────────────────────────────

fn collections_root(data_dir: &Path, workspace_id: &str) -> PathBuf {
    data_dir
        .join("workspaces")
        .join(workspace_id)
        .join("collections")
}

fn resolve_path(root: &Path, ids: &[String]) -> PathBuf {
    ids.iter().fold(root.to_path_buf(), |p, id| p.join(id))
}

fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

// ── Meta I/O ─────────────────────────────────────────────────────────────────

fn read_root_meta(root: &Path) -> anyhow::Result<RootMeta> {
    let p = root.join("_meta.toml");
    if !p.exists() {
        return Ok(RootMeta::default());
    }
    Ok(toml::from_str(&std::fs::read_to_string(p)?)?)
}

fn write_root_meta(root: &Path, meta: &RootMeta) -> anyhow::Result<()> {
    std::fs::create_dir_all(root)?;
    std::fs::write(root.join("_meta.toml"), toml::to_string(meta)?)?;
    Ok(())
}

fn read_folder_meta(dir: &Path) -> anyhow::Result<FolderMeta> {
    Ok(toml::from_str(&std::fs::read_to_string(
        dir.join("_meta.toml"),
    )?)?)
}

fn write_folder_meta(dir: &Path, meta: &FolderMeta) -> anyhow::Result<()> {
    std::fs::write(dir.join("_meta.toml"), toml::to_string(meta)?)?;
    Ok(())
}

// ── Tree read ────────────────────────────────────────────────────────────────

fn read_folder_children(dir: &Path, order: &[String]) -> anyhow::Result<Vec<CollectionNode>> {
    let mut nodes = vec![];
    for id in order {
        let subfolder = dir.join(id);
        let req_file = dir.join(format!("{}.toml", id));
        if subfolder.is_dir() {
            let meta = read_folder_meta(&subfolder)?;
            let children = read_folder_children(&subfolder, &meta.children_order)?;
            nodes.push(CollectionNode::Folder {
                id: id.clone(),
                name: meta.name,
                children,
            });
        } else if req_file.exists() {
            let rf: RequestFile = toml::from_str(&std::fs::read_to_string(&req_file)?)?;
            nodes.push(CollectionNode::Request {
                id: rf.id,
                name: rf.name,
                kind: rf.kind,
            });
        }
    }
    Ok(nodes)
}

pub fn list_collections(data_dir: &Path, workspace_id: &str) -> anyhow::Result<Vec<CollectionNode>> {
    let root = collections_root(data_dir, workspace_id);
    let root_meta = read_root_meta(&root)?;
    let mut cols = vec![];
    for id in &root_meta.children_order {
        let col_dir = root.join(id);
        if col_dir.is_dir() {
            let meta = read_folder_meta(&col_dir)?;
            let children = read_folder_children(&col_dir, &meta.children_order)?;
            cols.push(CollectionNode::Folder {
                id: id.clone(),
                name: meta.name,
                children,
            });
        }
    }
    Ok(cols)
}

// ── Mutations (stubbed for now, filled in Task 3) ────────────────────────────

pub fn create_collection(data_dir: &Path, workspace_id: &str, name: &str) -> anyhow::Result<CollectionNode> {
    todo!()
}
pub fn create_folder(data_dir: &Path, workspace_id: &str, parent_path: Vec<String>, name: &str) -> anyhow::Result<CollectionNode> {
    todo!()
}
pub fn create_request(data_dir: &Path, workspace_id: &str, parent_path: Vec<String>, name: &str, kind: RequestKind) -> anyhow::Result<CollectionNode> {
    todo!()
}
pub fn rename_node(data_dir: &Path, workspace_id: &str, path: Vec<String>, name: &str) -> anyhow::Result<()> {
    todo!()
}
pub fn delete_node(data_dir: &Path, workspace_id: &str, path: Vec<String>) -> anyhow::Result<()> {
    todo!()
}
pub fn reorder_children(data_dir: &Path, workspace_id: &str, parent_path: Vec<String>, ordered_ids: Vec<String>) -> anyhow::Result<()> {
    todo!()
}

// ── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn tmp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("hex-test-{}", name));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn list_empty_workspace_returns_empty() {
        let dir = tmp("list-empty");
        let result = list_collections(&dir, "ws1").unwrap();
        assert!(result.is_empty());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn list_with_no_root_meta_returns_empty() {
        let dir = tmp("list-no-meta");
        fs::create_dir_all(dir.join("workspaces/ws1/collections")).unwrap();
        let result = list_collections(&dir, "ws1").unwrap();
        assert!(result.is_empty());
        fs::remove_dir_all(dir).unwrap();
    }
}
```

- [ ] **Step 4: Run tests — expect passing (list functions are pure reads)**

```bash
cd src-tauri && cargo test persistence::collection::tests
```

Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/persistence/ src-tauri/src/lib.rs
git commit -m "feat: scaffold persistence module with list_collections and read helpers"
```

---

## Task 3: Implement all mutation functions

**Files:**
- Modify: `src-tauri/src/persistence/collection.rs`

- [ ] **Step 1: Write failing tests for mutations**

Add these tests to the `#[cfg(test)]` block in `collection.rs`:

```rust
    #[test]
    fn create_and_list_collection() {
        let dir = tmp("create-col");
        create_collection(&dir, "ws1", "My API").unwrap();
        let cols = list_collections(&dir, "ws1").unwrap();
        assert_eq!(cols.len(), 1);
        let CollectionNode::Folder { name, children, .. } = &cols[0] else {
            panic!("expected folder")
        };
        assert_eq!(name, "My API");
        assert!(children.is_empty());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn create_folder_inside_collection() {
        let dir = tmp("create-folder");
        let col = create_collection(&dir, "ws1", "Root").unwrap();
        let CollectionNode::Folder { id: col_id, .. } = col else { panic!() };
        create_folder(&dir, "ws1", vec![col_id.clone()], "Sub").unwrap();
        let cols = list_collections(&dir, "ws1").unwrap();
        let CollectionNode::Folder { children, .. } = &cols[0] else { panic!() };
        assert_eq!(children.len(), 1);
        let CollectionNode::Folder { name, .. } = &children[0] else { panic!() };
        assert_eq!(name, "Sub");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn create_request_in_collection() {
        let dir = tmp("create-req");
        let col = create_collection(&dir, "ws1", "Root").unwrap();
        let CollectionNode::Folder { id: col_id, .. } = col else { panic!() };
        create_request(
            &dir,
            "ws1",
            vec![col_id.clone()],
            "Get Users",
            RequestKind::Rest { method: "GET".into(), url: "https://example.com/users".into() },
        ).unwrap();
        let cols = list_collections(&dir, "ws1").unwrap();
        let CollectionNode::Folder { children, .. } = &cols[0] else { panic!() };
        assert_eq!(children.len(), 1);
        let CollectionNode::Request { name, kind: RequestKind::Rest { method, .. }, .. } = &children[0] else { panic!() };
        assert_eq!(name, "Get Users");
        assert_eq!(method, "GET");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn rename_collection() {
        let dir = tmp("rename-col");
        let col = create_collection(&dir, "ws1", "Old").unwrap();
        let CollectionNode::Folder { id, .. } = col else { panic!() };
        rename_node(&dir, "ws1", vec![id], "New").unwrap();
        let cols = list_collections(&dir, "ws1").unwrap();
        let CollectionNode::Folder { name, .. } = &cols[0] else { panic!() };
        assert_eq!(name, "New");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn rename_request() {
        let dir = tmp("rename-req");
        let col = create_collection(&dir, "ws1", "Col").unwrap();
        let CollectionNode::Folder { id: col_id, .. } = col else { panic!() };
        let req = create_request(&dir, "ws1", vec![col_id.clone()], "Old", RequestKind::Rest { method: "GET".into(), url: "u".into() }).unwrap();
        let CollectionNode::Request { id: req_id, .. } = req else { panic!() };
        rename_node(&dir, "ws1", vec![col_id, req_id], "New").unwrap();
        let cols = list_collections(&dir, "ws1").unwrap();
        let CollectionNode::Folder { children, .. } = &cols[0] else { panic!() };
        let CollectionNode::Request { name, .. } = &children[0] else { panic!() };
        assert_eq!(name, "New");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn delete_collection() {
        let dir = tmp("delete-col");
        create_collection(&dir, "ws1", "A").unwrap();
        create_collection(&dir, "ws1", "B").unwrap();
        let cols = list_collections(&dir, "ws1").unwrap();
        let CollectionNode::Folder { id: first_id, .. } = &cols[0] else { panic!() };
        let first_id = first_id.clone();
        delete_node(&dir, "ws1", vec![first_id]).unwrap();
        let cols = list_collections(&dir, "ws1").unwrap();
        assert_eq!(cols.len(), 1);
        let CollectionNode::Folder { name, .. } = &cols[0] else { panic!() };
        assert_eq!(name, "B");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn reorder_collections() {
        let dir = tmp("reorder-cols");
        let a = create_collection(&dir, "ws1", "A").unwrap();
        let b = create_collection(&dir, "ws1", "B").unwrap();
        let CollectionNode::Folder { id: a_id, .. } = a else { panic!() };
        let CollectionNode::Folder { id: b_id, .. } = b else { panic!() };
        reorder_children(&dir, "ws1", vec![], vec![b_id.clone(), a_id.clone()]).unwrap();
        let cols = list_collections(&dir, "ws1").unwrap();
        let CollectionNode::Folder { name: n0, .. } = &cols[0] else { panic!() };
        let CollectionNode::Folder { name: n1, .. } = &cols[1] else { panic!() };
        assert_eq!(n0, "B");
        assert_eq!(n1, "A");
        fs::remove_dir_all(dir).unwrap();
    }
```

- [ ] **Step 2: Run tests — expect failures (todo!() panics)**

```bash
cd src-tauri && cargo test persistence::collection::tests
```

Expected: new tests fail/panic.

- [ ] **Step 3: Implement all mutation functions**

Replace the `todo!()` stubs in `collection.rs` with real implementations:

```rust
pub fn create_collection(data_dir: &Path, workspace_id: &str, name: &str) -> anyhow::Result<CollectionNode> {
    let root = collections_root(data_dir, workspace_id);
    let id = new_id();
    let col_dir = root.join(&id);
    std::fs::create_dir_all(&col_dir)?;
    write_folder_meta(&col_dir, &FolderMeta { name: name.to_string(), children_order: vec![] })?;
    let mut root_meta = read_root_meta(&root)?;
    root_meta.children_order.push(id.clone());
    write_root_meta(&root, &root_meta)?;
    Ok(CollectionNode::Folder { id, name: name.to_string(), children: vec![] })
}

pub fn create_folder(data_dir: &Path, workspace_id: &str, parent_path: Vec<String>, name: &str) -> anyhow::Result<CollectionNode> {
    let root = collections_root(data_dir, workspace_id);
    let parent_dir = resolve_path(&root, &parent_path);
    let id = new_id();
    let folder_dir = parent_dir.join(&id);
    std::fs::create_dir_all(&folder_dir)?;
    write_folder_meta(&folder_dir, &FolderMeta { name: name.to_string(), children_order: vec![] })?;
    let mut parent_meta = read_folder_meta(&parent_dir)?;
    parent_meta.children_order.push(id.clone());
    write_folder_meta(&parent_dir, &parent_meta)?;
    Ok(CollectionNode::Folder { id, name: name.to_string(), children: vec![] })
}

pub fn create_request(data_dir: &Path, workspace_id: &str, parent_path: Vec<String>, name: &str, kind: RequestKind) -> anyhow::Result<CollectionNode> {
    let root = collections_root(data_dir, workspace_id);
    let parent_dir = resolve_path(&root, &parent_path);
    let id = new_id();
    let rf = RequestFile { id: id.clone(), name: name.to_string(), kind: kind.clone() };
    std::fs::write(parent_dir.join(format!("{}.toml", id)), toml::to_string(&rf)?)?;
    let mut parent_meta = read_folder_meta(&parent_dir)?;
    parent_meta.children_order.push(id.clone());
    write_folder_meta(&parent_dir, &parent_meta)?;
    Ok(CollectionNode::Request { id, name: name.to_string(), kind })
}

pub fn rename_node(data_dir: &Path, workspace_id: &str, path: Vec<String>, name: &str) -> anyhow::Result<()> {
    let root = collections_root(data_dir, workspace_id);
    let id = path.last().ok_or_else(|| anyhow::anyhow!("empty path"))?;
    let parent = resolve_path(&root, &path[..path.len() - 1]);
    let as_dir = parent.join(id);
    if as_dir.is_dir() {
        let mut meta = read_folder_meta(&as_dir)?;
        meta.name = name.to_string();
        write_folder_meta(&as_dir, &meta)?;
    } else {
        let req_path = parent.join(format!("{}.toml", id));
        let mut rf: RequestFile = toml::from_str(&std::fs::read_to_string(&req_path)?)?;
        rf.name = name.to_string();
        std::fs::write(req_path, toml::to_string(&rf)?)?;
    }
    Ok(())
}

pub fn delete_node(data_dir: &Path, workspace_id: &str, path: Vec<String>) -> anyhow::Result<()> {
    let root = collections_root(data_dir, workspace_id);
    let id = path.last().ok_or_else(|| anyhow::anyhow!("empty path"))?;
    if path.len() == 1 {
        std::fs::remove_dir_all(root.join(id))?;
        let mut root_meta = read_root_meta(&root)?;
        root_meta.children_order.retain(|x| x != id);
        write_root_meta(&root, &root_meta)?;
    } else {
        let parent = resolve_path(&root, &path[..path.len() - 1]);
        let as_dir = parent.join(id);
        if as_dir.is_dir() {
            std::fs::remove_dir_all(&as_dir)?;
        } else {
            std::fs::remove_file(parent.join(format!("{}.toml", id)))?;
        }
        let mut meta = read_folder_meta(&parent)?;
        meta.children_order.retain(|x| x != id);
        write_folder_meta(&parent, &meta)?;
    }
    Ok(())
}

pub fn reorder_children(data_dir: &Path, workspace_id: &str, parent_path: Vec<String>, ordered_ids: Vec<String>) -> anyhow::Result<()> {
    let root = collections_root(data_dir, workspace_id);
    if parent_path.is_empty() {
        let mut meta = read_root_meta(&root)?;
        meta.children_order = ordered_ids;
        write_root_meta(&root, &meta)?;
    } else {
        let parent = resolve_path(&root, &parent_path);
        let mut meta = read_folder_meta(&parent)?;
        meta.children_order = ordered_ids;
        write_folder_meta(&parent, &meta)?;
    }
    Ok(())
}
```

- [ ] **Step 4: Run all tests**

```bash
cd src-tauri && cargo test persistence::collection::tests
```

Expected: all 9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/persistence/collection.rs
git commit -m "feat: implement collection persistence (CRUD + reorder)"
```

---

## Task 4: Add Tauri commands and wire into app

**Files:**
- Create: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Create commands/mod.rs**

Create `src-tauri/src/commands/mod.rs`:

```rust
use crate::persistence::collection::{self, CollectionNode, RequestKind};
use tauri::Manager;

fn data_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_collections(app: tauri::AppHandle, workspace_id: String) -> Result<Vec<CollectionNode>, String> {
    let dir = data_dir(&app)?;
    collection::list_collections(&dir, &workspace_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_collection(app: tauri::AppHandle, workspace_id: String, name: String) -> Result<CollectionNode, String> {
    let dir = data_dir(&app)?;
    collection::create_collection(&dir, &workspace_id, &name).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_folder(app: tauri::AppHandle, workspace_id: String, parent_path: Vec<String>, name: String) -> Result<CollectionNode, String> {
    let dir = data_dir(&app)?;
    collection::create_folder(&dir, &workspace_id, parent_path, &name).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_request(app: tauri::AppHandle, workspace_id: String, parent_path: Vec<String>, name: String, kind: RequestKind) -> Result<CollectionNode, String> {
    let dir = data_dir(&app)?;
    collection::create_request(&dir, &workspace_id, parent_path, &name, kind).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn rename_node(app: tauri::AppHandle, workspace_id: String, path: Vec<String>, name: String) -> Result<(), String> {
    let dir = data_dir(&app)?;
    collection::rename_node(&dir, &workspace_id, path, &name).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_node(app: tauri::AppHandle, workspace_id: String, path: Vec<String>) -> Result<(), String> {
    let dir = data_dir(&app)?;
    collection::delete_node(&dir, &workspace_id, path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn reorder_children(app: tauri::AppHandle, workspace_id: String, parent_path: Vec<String>, ordered_ids: Vec<String>) -> Result<(), String> {
    let dir = data_dir(&app)?;
    collection::reorder_children(&dir, &workspace_id, parent_path, ordered_ids).map_err(|e| e.to_string())
}
```

- [ ] **Step 2: Update lib.rs**

Replace the entire contents of `src-tauri/src/lib.rs`:

```rust
mod commands;
mod persistence;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            commands::list_collections,
            commands::create_collection,
            commands::create_folder,
            commands::create_request,
            commands::rename_node,
            commands::delete_node,
            commands::reorder_children,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 3: Verify it compiles**

```bash
cd src-tauri && cargo check
```

Expected: `Finished` — no errors.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands/ src-tauri/src/lib.rs
git commit -m "feat: add collection Tauri commands"
```

---

## Task 5: Create src/lib/api.ts with TypeScript types and invoke wrappers

**Files:**
- Create: `src/lib/api.ts`

- [ ] **Step 1: Create api.ts**

Create `src/lib/api.ts`:

```typescript
import { invoke } from "@tauri-apps/api/core";

export type RequestKind =
  | { kind: "rest"; method: string; url: string }
  | { kind: "soap"; wsdlUrl: string; operation: string };

export type CollectionNode =
  | { type: "folder"; id: string; name: string; children: CollectionNode[] }
  | ({ type: "request"; id: string; name: string } & RequestKind);

export const api = {
  listCollections: (workspaceId: string) =>
    invoke<CollectionNode[]>("list_collections", { workspaceId }),

  createCollection: (workspaceId: string, name: string) =>
    invoke<CollectionNode>("create_collection", { workspaceId, name }),

  createFolder: (workspaceId: string, parentPath: string[], name: string) =>
    invoke<CollectionNode>("create_folder", { workspaceId, parentPath, name }),

  createRequest: (workspaceId: string, parentPath: string[], name: string, kind: RequestKind) =>
    invoke<CollectionNode>("create_request", { workspaceId, parentPath, name, kind }),

  renameNode: (workspaceId: string, path: string[], name: string) =>
    invoke<void>("rename_node", { workspaceId, path, name }),

  deleteNode: (workspaceId: string, path: string[]) =>
    invoke<void>("delete_node", { workspaceId, path }),

  reorderChildren: (workspaceId: string, parentPath: string[], orderedIds: string[]) =>
    invoke<void>("reorder_children", { workspaceId, parentPath, orderedIds }),
};
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
pnpm build 2>&1 | head -20
```

Expected: no TS errors in `src/lib/api.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/api.ts
git commit -m "feat: add typed collection api wrappers"
```

---

## Task 6: Create collection zustand store

**Files:**
- Create: `src/store/collectionStore.ts`
- Modify: `src/App.tsx`

- [ ] **Step 1: Create collectionStore.ts**

Create `src/store/collectionStore.ts`:

```typescript
import { create } from "zustand";
import { api, CollectionNode, RequestKind } from "../lib/api";

interface CollectionState {
  collections: CollectionNode[];
  activeRequestId: string | null;
  load: (workspaceId: string) => Promise<void>;
  addCollection: (workspaceId: string, name: string) => Promise<void>;
  addFolder: (workspaceId: string, parentPath: string[], name: string) => Promise<void>;
  addRequest: (workspaceId: string, parentPath: string[], name: string, kind: RequestKind) => Promise<void>;
  rename: (workspaceId: string, path: string[], name: string) => Promise<void>;
  remove: (workspaceId: string, path: string[]) => Promise<void>;
  reorder: (workspaceId: string, parentPath: string[], orderedIds: string[]) => Promise<void>;
  setActiveRequest: (id: string | null) => void;
}

export const useCollectionStore = create<CollectionState>((set, get) => ({
  collections: [],
  activeRequestId: null,

  async load(workspaceId) {
    const collections = await api.listCollections(workspaceId);
    set({ collections });
  },

  async addCollection(workspaceId, name) {
    const node = await api.createCollection(workspaceId, name);
    set((s) => ({ collections: [...s.collections, node] }));
  },

  async addFolder(workspaceId, parentPath, name) {
    const node = await api.createFolder(workspaceId, parentPath, name);
    set((s) => ({ collections: insertNode(s.collections, parentPath, node) }));
  },

  async addRequest(workspaceId, parentPath, name, kind) {
    const node = await api.createRequest(workspaceId, parentPath, name, kind);
    set((s) => ({ collections: insertNode(s.collections, parentPath, node) }));
  },

  async rename(workspaceId, path, name) {
    await api.renameNode(workspaceId, path, name);
    set((s) => ({ collections: renameNode(s.collections, path, name) }));
  },

  async remove(workspaceId, path) {
    await api.deleteNode(workspaceId, path);
    set((s) => ({ collections: removeNode(s.collections, path) }));
  },

  async reorder(workspaceId, parentPath, orderedIds) {
    await api.reorderChildren(workspaceId, parentPath, orderedIds);
    set((s) => ({ collections: reorderInTree(s.collections, parentPath, orderedIds) }));
  },

  setActiveRequest(id) {
    set({ activeRequestId: id });
  },
}));

// ── Tree mutation helpers ─────────────────────────────────────────────────────

function insertNode(tree: CollectionNode[], parentPath: string[], node: CollectionNode): CollectionNode[] {
  if (parentPath.length === 0) return [...tree, node];
  return tree.map((n) => {
    if (n.type !== "folder" || n.id !== parentPath[0]) return n;
    return { ...n, children: insertNode(n.children, parentPath.slice(1), node) };
  });
}

function renameNode(tree: CollectionNode[], path: string[], name: string): CollectionNode[] {
  if (path.length === 1) {
    return tree.map((n) => (n.id === path[0] ? { ...n, name } : n));
  }
  return tree.map((n) => {
    if (n.type !== "folder" || n.id !== path[0]) return n;
    return { ...n, children: renameNode(n.children, path.slice(1), name) };
  });
}

function removeNode(tree: CollectionNode[], path: string[]): CollectionNode[] {
  if (path.length === 1) return tree.filter((n) => n.id !== path[0]);
  return tree.map((n) => {
    if (n.type !== "folder" || n.id !== path[0]) return n;
    return { ...n, children: removeNode(n.children, path.slice(1)) };
  });
}

function reorderInTree(tree: CollectionNode[], parentPath: string[], orderedIds: string[]): CollectionNode[] {
  if (parentPath.length === 0) {
    return orderedIds.map((id) => tree.find((n) => n.id === id)!).filter(Boolean);
  }
  return tree.map((n) => {
    if (n.type !== "folder" || n.id !== parentPath[0]) return n;
    return { ...n, children: reorderInTree(n.children, parentPath.slice(1), orderedIds) };
  });
}
```

- [ ] **Step 2: Load collections on workspace activation in App.tsx**

Replace `src/App.tsx`:

```tsx
import { useEffect } from "react";
import { Sidebar } from "./components/Sidebar";
import { Titlebar } from "./components/Titlebar";
import { useWorkspaceStore, initWorkspaceStore } from "./store/workspaceStore";
import { useCollectionStore } from "./store/collectionStore";

function App() {
  const activeId = useWorkspaceStore((s) => s.activeId);
  const loadCollections = useCollectionStore((s) => s.load);

  useEffect(() => {
    initWorkspaceStore();
  }, []);

  useEffect(() => {
    loadCollections(activeId);
  }, [activeId, loadCollections]);

  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
      <Titlebar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
      </div>
    </div>
  );
}

export default App;
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
pnpm build 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/store/collectionStore.ts src/App.tsx
git commit -m "feat: add collection store and load on workspace change"
```

---

## Task 7: Install @dnd-kit and build CollectionTree

**Files:**
- Create: `src/components/CollectionTree.tsx`

- [ ] **Step 1: Install @dnd-kit packages**

```bash
pnpm add @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```

- [ ] **Step 2: Create CollectionTree.tsx**

Create `src/components/CollectionTree.tsx`:

```tsx
import { useState, useEffect, useRef } from "react";
import {
  DndContext,
  closestCenter,
  DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronDown, Folder, Hexagon } from "lucide-react";
import { cn } from "../lib/utils";
import { CollectionNode, RequestKind } from "../lib/api";
import { useCollectionStore } from "../store/collectionStore";
import { useWorkspaceStore } from "../store/workspaceStore";

const METHOD_COLORS: Record<string, string> = {
  GET: "text-method-get",
  POST: "text-method-post",
  DELETE: "text-method-delete",
  PUT: "text-method-put",
  PATCH: "text-method-post",
};

// ── Context menu ──────────────────────────────────────────────────────────────

type MenuAction =
  | { type: "rename"; path: string[]; currentName: string }
  | { type: "delete"; path: string[] }
  | { type: "newFolder"; parentPath: string[] }
  | { type: "newRequest"; parentPath: string[] };

function ContextMenu({
  x,
  y,
  actions,
  onAction,
  onClose,
}: {
  x: number;
  y: number;
  actions: MenuAction[];
  onAction: (a: MenuAction) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("pointerdown", handler);
    return () => document.removeEventListener("pointerdown", handler);
  }, [onClose]);

  const label = (a: MenuAction) => {
    if (a.type === "rename") return "Rename";
    if (a.type === "delete") return "Delete";
    if (a.type === "newFolder") return "New Folder";
    return "New Request";
  };

  return (
    <div
      ref={ref}
      className="fixed z-50 min-w-[140px] rounded-[6px] border border-border bg-background shadow-md py-1"
      style={{ left: x, top: y }}
    >
      {actions.map((a, i) => (
        <button
          key={i}
          className="w-full text-left px-3 py-[6px] text-[13px] hover:bg-sidebar-accent cursor-pointer"
          onClick={() => { onAction(a); onClose(); }}
        >
          {label(a)}
        </button>
      ))}
    </div>
  );
}

// ── Inline rename input ───────────────────────────────────────────────────────

function RenameInput({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (v: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => { ref.current?.select(); }, []);

  return (
    <input
      ref={ref}
      className="flex-1 bg-background border border-border rounded px-1 text-[13px] outline-none"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onCommit(value.trim() || initial);
        if (e.key === "Escape") onCancel();
      }}
      onBlur={() => onCommit(value.trim() || initial)}
      autoFocus
    />
  );
}

// ── SortableList (one DndContext per level) ───────────────────────────────────

function SortableList({
  nodes,
  parentPath,
  workspaceId,
}: {
  nodes: CollectionNode[];
  parentPath: string[];
  workspaceId: string;
}) {
  const reorder = useCollectionStore((s) => s.reorder);
  const sensors = useSensors(useSensor(PointerSensor));

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = nodes.findIndex((n) => n.id === active.id);
    const newIndex = nodes.findIndex((n) => n.id === over.id);
    const ordered = arrayMove(nodes, oldIndex, newIndex).map((n) => n.id);
    reorder(workspaceId, parentPath, ordered);
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={nodes.map((n) => n.id)} strategy={verticalListSortingStrategy}>
        {nodes.map((node) =>
          node.type === "folder" ? (
            <SortableFolderItem
              key={node.id}
              node={node}
              path={[...parentPath, node.id]}
              workspaceId={workspaceId}
            />
          ) : (
            <SortableRequestItem
              key={node.id}
              node={node}
              path={[...parentPath, node.id]}
              workspaceId={workspaceId}
            />
          )
        )}
      </SortableContext>
    </DndContext>
  );
}

// ── Folder item ───────────────────────────────────────────────────────────────

function SortableFolderItem({
  node,
  path,
  workspaceId,
}: {
  node: Extract<CollectionNode, { type: "folder" }>;
  path: string[];
  workspaceId: string;
}) {
  const [open, setOpen] = useState(true);
  const [renaming, setRenaming] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const rename = useCollectionStore((s) => s.rename);
  const remove = useCollectionStore((s) => s.remove);
  const addFolder = useCollectionStore((s) => s.addFolder);
  const addRequest = useCollectionStore((s) => s.addRequest);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: node.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY });
  }

  function handleAction(a: MenuAction) {
    if (a.type === "rename") setRenaming(true);
    if (a.type === "delete") remove(workspaceId, path);
    if (a.type === "newFolder") addFolder(workspaceId, path, "New Folder");
    if (a.type === "newRequest") addRequest(workspaceId, path, "New Request", { kind: "rest", method: "GET", url: "" });
  }

  const menuActions: MenuAction[] = [
    { type: "newRequest", parentPath: path },
    { type: "newFolder", parentPath: path },
    { type: "rename", path, currentName: node.name },
    { type: "delete", path },
  ];

  return (
    <div ref={setNodeRef} style={style}>
      <div
        className="flex items-center gap-[6px] rounded-[6px] px-2 py-[7px] cursor-pointer hover:bg-sidebar-accent/50 select-none"
        onContextMenu={handleContextMenu}
        {...attributes}
        {...listeners}
      >
        <ChevronDown
          size={14}
          className={cn("text-sidebar-muted shrink-0 transition-transform", !open && "-rotate-90")}
          onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        />
        <Folder size={14} className="text-sidebar-muted shrink-0" />
        {renaming ? (
          <RenameInput
            initial={node.name}
            onCommit={(v) => { rename(workspaceId, path, v); setRenaming(false); }}
            onCancel={() => setRenaming(false)}
          />
        ) : (
          <span className="text-[13px] font-semibold text-foreground">{node.name}</span>
        )}
      </div>
      {open && node.children.length > 0 && (
        <div style={{ paddingLeft: 16 }}>
          <SortableList nodes={node.children} parentPath={path} workspaceId={workspaceId} />
        </div>
      )}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          actions={menuActions}
          onAction={handleAction}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}

// ── Request item ──────────────────────────────────────────────────────────────

function SortableRequestItem({
  node,
  path,
  workspaceId,
}: {
  node: Extract<CollectionNode, { type: "request" }>;
  path: string[];
  workspaceId: string;
}) {
  const [renaming, setRenaming] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const rename = useCollectionStore((s) => s.rename);
  const remove = useCollectionStore((s) => s.remove);
  const activeRequestId = useCollectionStore((s) => s.activeRequestId);
  const setActive = useCollectionStore((s) => s.setActiveRequest);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: node.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  const isActive = activeRequestId === node.id;

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY });
  }

  function handleAction(a: MenuAction) {
    if (a.type === "rename") setRenaming(true);
    if (a.type === "delete") remove(workspaceId, path);
  }

  const menuActions: MenuAction[] = [
    { type: "rename", path, currentName: node.name },
    { type: "delete", path },
  ];

  const isSoap = node.kind === "soap";

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-2 rounded-[6px] px-2 py-[6px] cursor-pointer select-none",
        isActive ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/50"
      )}
      onClick={() => setActive(node.id)}
      onContextMenu={handleContextMenu}
      {...attributes}
      {...listeners}
    >
      {isSoap ? (
        <div className="w-10 flex justify-end shrink-0">
          <Hexagon size={14} className="text-soap-op" />
        </div>
      ) : (
        <span
          className={cn(
            "w-10 text-right text-[10px] font-bold font-mono shrink-0",
            METHOD_COLORS[(node as Extract<CollectionNode & { kind: "rest" }, unknown> & { method: string }).method] ?? "text-sidebar-muted"
          )}
        >
          {(node as { method: string }).method}
        </span>
      )}
      {renaming ? (
        <RenameInput
          initial={node.name}
          onCommit={(v) => { rename(workspaceId, path, v); setRenaming(false); }}
          onCancel={() => setRenaming(false)}
        />
      ) : (
        <span className={cn("text-[12px] font-mono", isActive ? "text-foreground" : "text-sidebar-muted")}>
          {node.name}
        </span>
      )}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          actions={menuActions}
          onAction={handleAction}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}

// ── Root export ───────────────────────────────────────────────────────────────

export function CollectionTree({ workspaceId }: { workspaceId: string }) {
  const collections = useCollectionStore((s) => s.collections);
  return (
    <SortableList nodes={collections} parentPath={[]} workspaceId={workspaceId} />
  );
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
pnpm build 2>&1 | head -30
```

Expected: no type errors. Fix any before continuing.

- [ ] **Step 4: Commit**

```bash
git add src/components/CollectionTree.tsx
git commit -m "feat: add CollectionTree with drag-reorder and context menu"
```

---

## Task 8: Update Sidebar to use the real tree

**Files:**
- Modify: `src/components/Sidebar.tsx`

- [ ] **Step 1: Replace static mock in Sidebar.tsx**

Replace the entire contents of `src/components/Sidebar.tsx`:

```tsx
import { FolderPlus, Plus, RefreshCw, Search } from "lucide-react";
import { CollectionTree } from "./CollectionTree";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useCollectionStore } from "../store/collectionStore";

export function Sidebar() {
  const workspaceId = useWorkspaceStore((s) => s.activeId);
  const addCollection = useCollectionStore((s) => s.addCollection);

  return (
    <aside
      className="flex flex-col h-full w-[264px] shrink-0 border-r border-border"
      style={{ backgroundColor: "var(--color-sidebar)" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 pt-3 pb-2">
        <span
          className="text-[11px] font-semibold tracking-[0.5px] text-sidebar-muted"
          style={{ fontFamily: "var(--font-sans)" }}
        >
          WORKSPACE
        </span>
        <div className="flex items-center gap-1">
          <FolderPlus
            size={14}
            className="text-sidebar-muted cursor-pointer hover:text-foreground"
            onClick={() => addCollection(workspaceId, "New Collection")}
          />
          <Plus size={14} className="text-sidebar-muted cursor-pointer hover:text-foreground" />
        </div>
      </div>

      {/* Search */}
      <div className="px-3 pb-2">
        <div className="flex items-center gap-2 px-[9px] py-[7px] rounded-[6px] bg-background border border-border cursor-text">
          <Search size={13} className="text-sidebar-muted shrink-0" />
          <span className="text-[12px] text-sidebar-muted">Filter requests</span>
        </div>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto px-[6px] py-1">
        <CollectionTree workspaceId={workspaceId} />
      </div>

      {/* Footer */}
      <div className="flex items-center justify-center gap-2 px-3 py-[10px] border-t border-border cursor-pointer hover:text-foreground">
        <RefreshCw size={13} className="text-sidebar-muted" />
        <span className="text-[12px] font-medium text-sidebar-muted">
          Update Definition
        </span>
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: Run the app and verify the sidebar is live**

```bash
pnpm tauri dev
```

Expected:
- Sidebar loads empty (no hardcoded items)
- Clicking the `FolderPlus` icon creates a "New Collection" folder
- Right-clicking a folder shows context menu with New Request, New Folder, Rename, Delete
- Drag-reorder works within siblings
- Refreshing/restarting the app preserves collections (data persists on disk)

- [ ] **Step 3: Commit**

```bash
git add src/components/Sidebar.tsx
git commit -m "feat: wire Sidebar to live CollectionTree"
```

---

## Self-Review Notes

**Spec coverage check:**

| Spec requirement | Covered in task |
|---|---|
| Both REST + SOAP in same tree | Task 2 (`RequestKind` enum), Task 7 (`SortableRequestItem` renders both) |
| Arbitrary depth nesting | Task 2 (`read_folder_children` is recursive), Task 7 (`SortableList` recurses) |
| Git-friendly disk storage | Task 2+3 (TOML files + directories, one file per request) |
| Drag-reorder within siblings | Task 7 (`DndContext` per level, `arrayMove` + `reorder` on drop) |
| CRUD (create/rename/delete) | Task 3 (Rust), Task 7 (context menu + inline rename) |
| Sidebar renders real tree | Task 8 |
| Collections load on workspace change | Task 6 (`App.tsx` `useEffect` on `activeId`) |

**WSDL integration note:** When the WSDL import command is implemented (future task), it should call `create_collection` + `create_request` (with `kind: Soap`) for each operation. The persistence layer is ready for it.
