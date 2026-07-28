# F5 Organize (Duplicate + Delete Confirmation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Duplicate (requests and folders/collections, recursive) and a delete-confirmation modal to the collection tree, persisted on the filesystem.

**Architecture:** A single `duplicate_node` function in `persistence/collection.rs` copies the request file or folder directory recursively with fresh ids and inserts the copy right after the original in the parent's order. A thin `#[tauri::command]` exposes it; tauri-specta regenerates `src/bindings.ts`; a zustand store action inserts the returned subtree into the in-memory tree; `CollectionTree.tsx` gains a Duplicate menu item and a confirm-before-delete modal.

**Tech Stack:** Rust (anyhow, toml, uuid), tauri-specta, React 19 + TS, zustand, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-07-25-f5-organize-duplicate-delete-confirm-design.md`

## Global Constraints

- Work in the worktree `.worktrees/feat-f5-organize-duplicate-delete`, branch `feat/f5-organize-duplicate-delete`.
- `src/bindings.ts` is GENERATED — never edit manually; regenerate with `cargo test export_bindings` (inside `src-tauri/`).
- Copy name suffix is exactly `" copy"` (lowercase): `"X copy"`. Only the top-level copied node gets the suffix; children keep their names.
- The copy is inserted **immediately after the original** in the parent's order (fs `children_order` and in-memory tree).
- Confirm modal copy: title `Delete '<name>'?`, body `This action cannot be undone.`, buttons `Cancel` / `Delete`.
- TS: no `any`. Components never call `invoke`/bindings directly — only wrappers in `src/lib/api.ts`.
- UI: design tokens only (`bg-card`, `border-border`, `bg-destructive`, `text-background`, …). No hardcoded hex.
- Commits: Conventional Commits, single line, English, no "via" (use "with"/"using").
- Rust: `cargo fmt` + `cargo clippy` clean before each commit.
- All code, comments, and test names in English.

---

### Task 1: Rust `duplicate_node` in persistence

**Files:**
- Modify: `src-tauri/src/persistence/collection.rs` (functions after `delete_node`, ~line 400; tests inside `mod tests`)

**Interfaces:**
- Consumes: existing private helpers `collections_root`, `resolve_path`, `validate_ids`, `new_id`, `read_root_meta`/`write_root_meta`, `read_folder_meta`/`write_folder_meta`, and types `RequestFile`, `FolderMeta`, `CollectionNode`, `RequestNode`.
- Produces: `pub fn duplicate_node(data_dir: &Path, workspace_id: &str, path: Vec<String>) -> anyhow::Result<CollectionNode>` — used by Task 2's command.

- [ ] **Step 1: Write the failing tests**

Add inside `mod tests` in `src-tauri/src/persistence/collection.rs`, following the existing style (`tmp(name)` temp dir + `fs::remove_dir_all` at the end, `let … else { panic!() }` destructuring):

```rust
    #[test]
    fn duplicate_request_inserts_copy_after_original() {
        let dir = tmp("dup-request");
        let col = create_collection(&dir, "ws1", "Col").unwrap();
        let CollectionNode::Folder { id: col_id, .. } = col else {
            panic!()
        };
        let a = create_request(
            &dir,
            "ws1",
            vec![col_id.clone()],
            "A",
            RequestKind::Rest {
                method: "GET".into(),
                url: "http://a".into(),
            },
        )
        .unwrap();
        let CollectionNode::Request(RequestNode { id: a_id, .. }) = a else {
            panic!()
        };
        create_request(
            &dir,
            "ws1",
            vec![col_id.clone()],
            "B",
            RequestKind::Rest {
                method: "GET".into(),
                url: "http://b".into(),
            },
        )
        .unwrap();

        let copy = duplicate_node(&dir, "ws1", vec![col_id.clone(), a_id.clone()]).unwrap();
        let CollectionNode::Request(RequestNode {
            id: copy_id,
            name: copy_name,
            kind: RequestKind::Rest { url, .. },
        }) = copy
        else {
            panic!()
        };
        assert_eq!(copy_name, "A copy");
        assert_ne!(copy_id, a_id);
        assert_eq!(url, "http://a");

        // order on disk: A, A copy, B
        let cols = list_collections(&dir, "ws1").unwrap();
        let CollectionNode::Folder { children, .. } = &cols[0] else {
            panic!()
        };
        let names: Vec<_> = children
            .iter()
            .map(|n| match n {
                CollectionNode::Request(r) => r.name.clone(),
                CollectionNode::Folder { name, .. } => name.clone(),
            })
            .collect();
        assert_eq!(names, vec!["A", "A copy", "B"]);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn duplicate_folder_recursively_with_fresh_ids() {
        let dir = tmp("dup-folder");
        let col = create_collection(&dir, "ws1", "Col").unwrap();
        let CollectionNode::Folder { id: col_id, .. } = col else {
            panic!()
        };
        let f = create_folder(&dir, "ws1", vec![col_id.clone()], "F").unwrap();
        let CollectionNode::Folder { id: f_id, .. } = f else {
            panic!()
        };
        let r = create_request(
            &dir,
            "ws1",
            vec![col_id.clone(), f_id.clone()],
            "R",
            RequestKind::Rest {
                method: "GET".into(),
                url: "http://r".into(),
            },
        )
        .unwrap();
        let CollectionNode::Request(RequestNode { id: r_id, .. }) = r else {
            panic!()
        };

        let copy = duplicate_node(&dir, "ws1", vec![col_id.clone(), f_id.clone()]).unwrap();
        let CollectionNode::Folder {
            id: copy_id,
            name: copy_name,
            children,
        } = copy
        else {
            panic!()
        };
        assert_eq!(copy_name, "F copy");
        assert_ne!(copy_id, f_id);
        // child keeps its name but gets a fresh id
        let CollectionNode::Request(RequestNode {
            id: child_id,
            name: child_name,
            ..
        }) = &children[0]
        else {
            panic!()
        };
        assert_eq!(child_name, "R");
        assert_ne!(child_id, &r_id);

        // fs round-trip agrees
        let cols = list_collections(&dir, "ws1").unwrap();
        let CollectionNode::Folder { children, .. } = &cols[0] else {
            panic!()
        };
        assert_eq!(children.len(), 2);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn duplicate_collection_at_root() {
        let dir = tmp("dup-collection");
        let a = create_collection(&dir, "ws1", "A").unwrap();
        let CollectionNode::Folder { id: a_id, .. } = a else {
            panic!()
        };
        create_collection(&dir, "ws1", "B").unwrap();

        duplicate_node(&dir, "ws1", vec![a_id]).unwrap();

        let cols = list_collections(&dir, "ws1").unwrap();
        let names: Vec<_> = cols
            .iter()
            .map(|n| match n {
                CollectionNode::Folder { name, .. } => name.clone(),
                _ => panic!(),
            })
            .collect();
        assert_eq!(names, vec!["A", "A copy", "B"]);
        fs::remove_dir_all(dir).unwrap();
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run (inside `src-tauri/`): `cargo test duplicate`
Expected: compile error — `duplicate_node` not found.

- [ ] **Step 3: Implement `duplicate_node`**

Add after `delete_node` in `src-tauri/src/persistence/collection.rs`:

```rust
fn insert_after(order: &mut Vec<String>, after: &str, id: String) {
    let pos = order
        .iter()
        .position(|x| x == after)
        .map(|i| i + 1)
        .unwrap_or(order.len());
    order.insert(pos, id);
}

fn copy_folder_recursive(
    src: &Path,
    dest_parent: &Path,
    top: bool,
) -> anyhow::Result<(String, CollectionNode)> {
    let meta = read_folder_meta(src)?;
    let id = new_id();
    let name = if top {
        format!("{} copy", meta.name)
    } else {
        meta.name.clone()
    };
    let dest = dest_parent.join(&id);
    std::fs::create_dir_all(&dest)?;
    let mut new_order = vec![];
    let mut children = vec![];
    for child_id in &meta.children_order {
        let child_dir = src.join(child_id);
        let child_file = src.join(format!("{child_id}.toml"));
        if child_dir.is_dir() {
            let (cid, cnode) = copy_folder_recursive(&child_dir, &dest, false)?;
            new_order.push(cid);
            children.push(cnode);
        } else if child_file.exists() {
            let mut rf: RequestFile = toml::from_str(&std::fs::read_to_string(&child_file)?)?;
            let cid = new_id();
            rf.id = cid.clone();
            std::fs::write(dest.join(format!("{cid}.toml")), toml::to_string(&rf)?)?;
            new_order.push(cid.clone());
            children.push(CollectionNode::Request(RequestNode {
                id: cid,
                name: rf.name,
                kind: rf.kind,
            }));
        }
    }
    write_folder_meta(
        &dest,
        &FolderMeta {
            name: name.clone(),
            children_order: new_order,
        },
    )?;
    Ok((
        id.clone(),
        CollectionNode::Folder { id, name, children },
    ))
}

pub fn duplicate_node(
    data_dir: &Path,
    workspace_id: &str,
    path: Vec<String>,
) -> anyhow::Result<CollectionNode> {
    validate_ids(&path)?;
    let root = collections_root(data_dir, workspace_id);
    let orig_id = path.last().ok_or_else(|| anyhow::anyhow!("empty path"))?;
    let parent = resolve_path(&root, &path[..path.len() - 1]);
    let as_dir = parent.join(orig_id);

    let (new_id, node) = if as_dir.is_dir() {
        copy_folder_recursive(&as_dir, &parent, true)?
    } else {
        let file = parent.join(format!("{orig_id}.toml"));
        let mut rf: RequestFile = toml::from_str(&std::fs::read_to_string(&file)?)?;
        let id = self::new_id();
        rf.id = id.clone();
        rf.name = format!("{} copy", rf.name);
        std::fs::write(parent.join(format!("{id}.toml")), toml::to_string(&rf)?)?;
        let node = CollectionNode::Request(RequestNode {
            id: id.clone(),
            name: rf.name,
            kind: rf.kind,
        });
        (id, node)
    };

    if path.len() == 1 {
        let mut meta = read_root_meta(&root)?;
        insert_after(&mut meta.children_order, orig_id, new_id);
        write_root_meta(&root, &meta)?;
    } else {
        let mut meta = read_folder_meta(&parent)?;
        insert_after(&mut meta.children_order, orig_id, new_id);
        write_folder_meta(&parent, &meta)?;
    }
    Ok(node)
}
```

Note the `self::new_id()` inside `duplicate_node`: the local binding `new_id` (the copy's id) would otherwise shadow the free function on the second call path. If you restructure so there is no shadowing, plain `new_id()` is fine.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test duplicate`
Expected: 3 passed. Then run the full suite: `cargo test` — all pass (80 existing + 3 new).

- [ ] **Step 5: Format, lint, commit**

```bash
cargo fmt && cargo clippy -- -D warnings
git add src-tauri/src/persistence/collection.rs
git commit -m "feat(persistence): duplicate_node copies requests and folders recursively"
```

---

### Task 2: Tauri command + regenerated bindings

**Files:**
- Modify: `src-tauri/src/commands/mod.rs` (after `delete_node`, ~line 77)
- Modify: `src-tauri/src/lib.rs` (the `collect_commands![…]` list, ~line 14)
- Regenerate: `src/bindings.ts` (never by hand)

**Interfaces:**
- Consumes: `collection::duplicate_node` from Task 1.
- Produces: generated `commands.duplicateNode(workspaceId: string, path: string[]): Promise<Result<CollectionNode, string>>` in `src/bindings.ts` — used by Task 3.

- [ ] **Step 1: Add the thin command**

In `src-tauri/src/commands/mod.rs`, after `delete_node` (matching its shape exactly):

```rust
#[tauri::command]
#[specta::specta]
pub fn duplicate_node(
    app: tauri::AppHandle,
    workspace_id: String,
    path: Vec<String>,
) -> Result<CollectionNode, String> {
    let dir = data_dir(&app)?;
    collection::duplicate_node(&dir, &workspace_id, path).map_err(|e| e.to_string())
}
```

- [ ] **Step 2: Register it**

In `src-tauri/src/lib.rs`, inside `collect_commands![…]`, add after `commands::delete_node,`:

```rust
        commands::duplicate_node,
```

- [ ] **Step 3: Regenerate bindings and verify**

Run (inside `src-tauri/`): `cargo test export_bindings`
Expected: PASS. Then verify: `grep -n "duplicateNode" ../src/bindings.ts` shows the new command.

- [ ] **Step 4: Full check**

Run: `cargo test` — all pass. `cargo fmt && cargo clippy -- -D warnings` — clean.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/mod.rs src-tauri/src/lib.rs src/bindings.ts
git commit -m "feat(commands): expose duplicate_node and regenerate bindings"
```

---

### Task 3: api wrapper + store `duplicate` action

**Files:**
- Modify: `src/lib/api.ts` (the `api` object, after `deleteNode`)
- Modify: `src/store/collectionStore.ts`
- Create: `src/store/collectionStore.test.ts`

**Interfaces:**
- Consumes: `commands.duplicateNode` from Task 2; `unwrap` helper in `api.ts`.
- Produces: `api.duplicateNode(workspaceId: string, path: string[]): Promise<CollectionNode>` and store action `duplicate(workspaceId: string, path: string[]): Promise<void>` — used by Task 4.

- [ ] **Step 1: Write the failing store tests**

Create `src/store/collectionStore.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useCollectionStore } from "./collectionStore";
import { api } from "../lib/api";
import type { CollectionNode } from "../lib/api";

vi.mock("../lib/api", () => ({
  api: { duplicateNode: vi.fn() },
}));

const reqA: CollectionNode = {
  type: "request",
  id: "a",
  name: "A",
  kind: "rest",
  method: "GET",
  url: "http://a",
};
const reqB: CollectionNode = {
  type: "request",
  id: "b",
  name: "B",
  kind: "rest",
  method: "GET",
  url: "http://b",
};
const folder = (children: CollectionNode[]): CollectionNode => ({
  type: "folder",
  id: "col",
  name: "Col",
  children,
});

beforeEach(() => {
  vi.clearAllMocks();
  useCollectionStore.setState({ collections: [], activeRequestId: null });
});

describe("collectionStore.duplicate", () => {
  it("inserts the returned copy right after the original inside a folder", async () => {
    const copy: CollectionNode = { ...reqA, id: "a2", name: "A copy" };
    vi.mocked(api.duplicateNode).mockResolvedValue(copy);
    useCollectionStore.setState({ collections: [folder([reqA, reqB])] });

    await useCollectionStore.getState().duplicate("w1", ["col", "a"]);

    const col = useCollectionStore.getState().collections[0];
    if (col.type !== "folder") throw new Error("expected folder");
    expect(col.children.map((n) => n.id)).toEqual(["a", "a2", "b"]);
    expect(api.duplicateNode).toHaveBeenCalledWith("w1", ["col", "a"]);
  });

  it("inserts a duplicated collection after the original at root", async () => {
    const copy: CollectionNode = { type: "folder", id: "col2", name: "Col copy", children: [] };
    vi.mocked(api.duplicateNode).mockResolvedValue(copy);
    useCollectionStore.setState({ collections: [folder([]), { type: "folder", id: "z", name: "Z", children: [] }] });

    await useCollectionStore.getState().duplicate("w1", ["col"]);

    expect(useCollectionStore.getState().collections.map((n) => n.id)).toEqual(["col", "col2", "z"]);
  });

  it("leaves the tree unchanged when the api call fails", async () => {
    vi.mocked(api.duplicateNode).mockRejectedValue("boom");
    useCollectionStore.setState({ collections: [folder([reqA])] });

    await useCollectionStore.getState().duplicate("w1", ["col", "a"]);

    const col = useCollectionStore.getState().collections[0];
    if (col.type !== "folder") throw new Error("expected folder");
    expect(col.children.map((n) => n.id)).toEqual(["a"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test`
Expected: FAIL — `duplicate` is not a function on the store (TS error / runtime undefined).

- [ ] **Step 3: Implement wrapper and action**

In `src/lib/api.ts`, after `deleteNode`:

```ts
  duplicateNode: (workspaceId: string, path: string[]) =>
    unwrap(commands.duplicateNode(workspaceId, path)),
```

In `src/store/collectionStore.ts`:

Add to the `CollectionState` interface after `remove`:

```ts
  duplicate: (workspaceId: string, path: string[]) => Promise<void>;
```

Add the action after `remove` in the store object:

```ts
  async duplicate(workspaceId, path) {
    try {
      const node = await api.duplicateNode(workspaceId, path);
      set((s) => ({ collections: insertAfter(s.collections, path, node) }));
    } catch (e) {
      console.error("duplicate failed:", e);
    }
  },
```

Add the helper next to the other tree helpers at the bottom:

```ts
function insertAfter(tree: CollectionNode[], path: string[], node: CollectionNode): CollectionNode[] {
  if (path.length === 1) {
    const i = tree.findIndex((n) => n.id === path[0]);
    return [...tree.slice(0, i + 1), node, ...tree.slice(i + 1)];
  }
  return tree.map((n) => {
    if (n.type !== "folder" || n.id !== path[0]) return n;
    return { ...n, children: insertAfter(n.children, path.slice(1), node) };
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test`
Expected: all pass (56 existing + 3 new).

- [ ] **Step 5: Commit**

```bash
git add src/lib/api.ts src/store/collectionStore.ts src/store/collectionStore.test.ts
git commit -m "feat(store): duplicate action inserts the copy after the original"
```

---

### Task 4: UI — Duplicate menu item + delete confirmation modal

**Files:**
- Modify: `src/components/CollectionTree.tsx`
- Test: `src/components/CollectionTree.test.tsx`

**Interfaces:**
- Consumes: store action `duplicate(workspaceId, path)` from Task 3; existing `remove`, `closeRequestsUnder`, `closeRequest`.
- Produces: user-visible context-menu entry `Duplicate` and confirm modal (used by no later task).

- [ ] **Step 1: Write the failing tests**

Append to `src/components/CollectionTree.test.tsx`:

```tsx
const folderNode: CollectionNode = {
  type: "folder",
  id: "f1",
  name: "MyFolder",
  children: [],
};

describe("CollectionTree — organize actions", () => {
  it("Duplicate in a request's context menu calls store.duplicate with the path", () => {
    const duplicate = vi.fn();
    useCollectionStore.setState({ collections: [restNode], duplicate });

    render(<CollectionTree workspaceId="w1" />);
    fireEvent.contextMenu(screen.getByText("GetThing"));
    fireEvent.click(screen.getByText("Duplicate"));

    expect(duplicate).toHaveBeenCalledWith("w1", ["r1"]);
  });

  it("Duplicate in a folder's context menu calls store.duplicate with the path", () => {
    const duplicate = vi.fn();
    useCollectionStore.setState({ collections: [folderNode], duplicate });

    render(<CollectionTree workspaceId="w1" />);
    fireEvent.contextMenu(screen.getByText("MyFolder"));
    fireEvent.click(screen.getByText("Duplicate"));

    expect(duplicate).toHaveBeenCalledWith("w1", ["f1"]);
  });

  it("Delete opens a confirmation modal and does not delete until confirmed", () => {
    const remove = vi.fn();
    useCollectionStore.setState({ collections: [restNode], remove });

    render(<CollectionTree workspaceId="w1" />);
    fireEvent.contextMenu(screen.getByText("GetThing"));
    fireEvent.click(screen.getByText("Delete"));

    expect(remove).not.toHaveBeenCalled();
    expect(screen.getByText(/cannot be undone/i)).toBeTruthy();

    // the context menu is closed now; the only "Delete" left is the modal button
    fireEvent.click(screen.getByText("Delete"));
    expect(remove).toHaveBeenCalledWith("w1", ["r1"]);
  });

  it("Cancel closes the confirmation without deleting", () => {
    const remove = vi.fn();
    useCollectionStore.setState({ collections: [restNode], remove });

    render(<CollectionTree workspaceId="w1" />);
    fireEvent.contextMenu(screen.getByText("GetThing"));
    fireEvent.click(screen.getByText("Delete"));
    fireEvent.click(screen.getByText("Cancel"));

    expect(remove).not.toHaveBeenCalled();
    expect(screen.queryByText(/cannot be undone/i)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test`
Expected: FAIL — no "Duplicate" menu entry; delete happens immediately (no modal text found).

- [ ] **Step 3: Implement**

All changes in `src/components/CollectionTree.tsx`:

3a. Extend `MenuAction` (the union at the top):

```tsx
type MenuAction =
  | { type: "rename"; path: string[]; currentName: string }
  | { type: "duplicate"; path: string[] }
  | { type: "delete"; path: string[] }
  | { type: "newFolder"; parentPath: string[] }
  | { type: "newRequest"; parentPath: string[] };
```

3b. Extend the `label` helper inside `ContextMenu`:

```tsx
  const label = (a: MenuAction) => {
    if (a.type === "rename") return "Rename";
    if (a.type === "duplicate") return "Duplicate";
    if (a.type === "delete") return "Delete";
    if (a.type === "newFolder") return "New Folder";
    return "New Request";
  };
```

3c. Add a local `ConfirmDeleteModal` component (after `ContextMenu`, before `RenameInput`), styled like `AddWorkspaceModal`:

```tsx
function ConfirmDeleteModal({
  name,
  onConfirm,
  onCancel,
}: {
  name: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="w-[360px] rounded-[6px] bg-card border border-border overflow-hidden">
        <div className="px-5 pt-4 pb-2">
          <span className="text-[15px] font-semibold text-foreground">Delete '{name}'?</span>
        </div>
        <div className="px-5 pb-4 text-[13px] text-muted">This action cannot be undone.</div>
        <div className="h-px bg-border" />
        <div className="flex items-center justify-end gap-[10px] px-5 py-[14px]">
          <button
            className="px-4 py-[7px] rounded-[4px] text-[13px] font-medium text-foreground bg-secondary border border-border hover:bg-secondary/80 cursor-pointer"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className="px-4 py-[7px] rounded-[4px] text-[13px] font-medium text-background bg-destructive hover:bg-destructive/90 cursor-pointer"
            onClick={onConfirm}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
```

The `stopPropagation` calls keep clicks inside the modal from bubbling to the tree row underneath (which would activate/open the request being deleted).

3d. `SortableFolderItem` — add state, store hook, menu entry, and modal:

```tsx
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const duplicate = useCollectionStore((s) => s.duplicate);
```

In `handleAction`, replace the `delete` branch and add `duplicate`:

```tsx
  function handleAction(a: MenuAction) {
    if (a.type === "rename") setRenaming(true);
    if (a.type === "duplicate") duplicate(workspaceId, path);
    if (a.type === "delete") setConfirmingDelete(true);
    if (a.type === "newFolder") { setOpen(true); onPendingCreate(path, "folder"); }
    if (a.type === "newRequest") { setOpen(true); onPendingCreate(path, "request"); }
  }
```

In `menuActions`, add between rename and delete:

```tsx
    { type: "duplicate", path },
```

At the end of the JSX (next to the `{menu && …}` block):

```tsx
      {confirmingDelete && (
        <ConfirmDeleteModal
          name={node.name}
          onConfirm={() => {
            remove(workspaceId, path);
            closeRequestsUnder(path);
            setConfirmingDelete(false);
          }}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}
```

3e. `SortableRequestItem` — same pattern:

```tsx
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const duplicate = useCollectionStore((s) => s.duplicate);
```

```tsx
  function handleAction(a: MenuAction) {
    if (a.type === "rename") setRenaming(true);
    if (a.type === "duplicate") duplicate(workspaceId, path);
    if (a.type === "delete") setConfirmingDelete(true);
  }
```

```tsx
  const menuActions: MenuAction[] = [
    { type: "rename", path, currentName: node.name },
    { type: "duplicate", path },
    { type: "delete", path },
  ];
```

```tsx
      {confirmingDelete && (
        <ConfirmDeleteModal
          name={node.name}
          onConfirm={() => {
            remove(workspaceId, path);
            closeInStore(node.id);
            setConfirmingDelete(false);
          }}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test`
Expected: all pass. Also run `pnpm lint` — clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/CollectionTree.tsx src/components/CollectionTree.test.tsx
git commit -m "feat(ui): duplicate menu action and delete confirmation modal in collection tree"
```

---

### Task 5: Full verification pass

**Files:** none new.

- [ ] **Step 1: Run everything**

```bash
pnpm test && pnpm lint
cd src-tauri && cargo test && cargo fmt --check && cargo clippy -- -D warnings && cd ..
```

Expected: all suites pass, lint/fmt/clippy clean.

- [ ] **Step 2: Manual smoke (optional but recommended)**

`pnpm tauri dev`: right-click a request → Duplicate → "X copy" appears right below; right-click → Delete → modal appears; Cancel keeps it, Delete removes it; duplicate a folder with children → whole subtree copied; restart the app → copies persisted.

- [ ] **Step 3: Commit any stragglers**

Only if fmt/lint touched files:

```bash
git add -u && git commit -m "style: fmt and lint fixes for F5 organize slice"
```
