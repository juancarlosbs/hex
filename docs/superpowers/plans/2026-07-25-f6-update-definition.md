# F6 Update Definition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-fetch a service's WSDL, diff its operations against the imported collection, and apply the changes — orphaning (never deleting) requests whose operations disappeared.

**Architecture:** Pure diff in `domain/wsdl.rs`; apply logic in `persistence/collection.rs`; a thin `preview_definition_update` / `apply_definition_update` command pair mirroring the existing `import_wsdl` → `confirm_wsdl_import` pattern. Frontend: a zustand store driving a diff-preview modal (same shape as `wsdlImportStore` + `ImportWsdlModal`), a context-menu entry on imported collections, an orphan badge, and a Settings toggle to skip the preview.

**Tech Stack:** Rust (tauri v2, specta, serde/toml, anyhow), React 19 + TS, zustand, Vitest + @testing-library/react, tauri-plugin-store.

**Spec:** `docs/superpowers/specs/2026-07-25-f6-update-definition-design.md`

## Global Constraints

- Work happens in the worktree `.worktrees/f6-update-definition` on branch `feat/f6-update-definition`. All paths below are relative to that worktree root.
- `src/bindings.ts` is GENERATED — never edit it manually. Regenerate with `cargo test export_bindings` (run inside `src-tauri/`).
- Domain stays pure: no I/O in `src-tauri/src/domain/`. Commands stay thin (validate + delegate).
- No new dependencies. No `any` in TS. Rust: `cargo fmt` + `cargo clippy` clean before each commit.
- Commits: Conventional Commits, single-line, plain English.
- Rust tests run inside `src-tauri/`: `cargo test`. Frontend tests: `pnpm test -- --run`.
- The Orphans folder is a normal folder named `Orphans` created at the collection root on first use. Operations match by the request's `operation` field (rename-safe), never by display name.

---

### Task 1: Pure operation diff in the domain

**Files:**
- Modify: `src-tauri/src/domain/wsdl.rs`

**Interfaces:**
- Consumes: existing `OperationRef` (fields `name, endpoint, soap_action, soap_version, input_element`; derives `PartialEq`).
- Produces: `pub struct DefinitionDiff { pub new: Vec<OperationRef>, pub changed: Vec<OperationRef>, pub removed: Vec<String>, pub unchanged: u32 }` and `pub fn diff_operations(current: &[OperationRef], fresh: &[OperationRef]) -> DefinitionDiff`. Tasks 2 and 3 rely on these exact names.

- [ ] **Step 1: Write the failing tests**

Append to `src-tauri/src/domain/wsdl.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn op(name: &str, endpoint: &str) -> OperationRef {
        OperationRef {
            name: name.into(),
            endpoint: endpoint.into(),
            soap_action: format!("http://x/{name}"),
            soap_version: SoapVersion::V11,
            input_element: QName {
                namespace: "http://x/ns".into(),
                local: name.into(),
            },
        }
    }

    #[test]
    fn identical_sets_produce_empty_diff_and_count_unchanged() {
        let ops = vec![op("Add", "http://x/svc"), op("Sub", "http://x/svc")];
        let diff = diff_operations(&ops, &ops);
        assert!(diff.new.is_empty());
        assert!(diff.changed.is_empty());
        assert!(diff.removed.is_empty());
        assert_eq!(diff.unchanged, 2);
    }

    #[test]
    fn operation_only_in_fresh_is_new() {
        let diff = diff_operations(&[op("Add", "http://x/svc")], &[op("Add", "http://x/svc"), op("Mul", "http://x/svc")]);
        assert_eq!(diff.new, vec![op("Mul", "http://x/svc")]);
        assert_eq!(diff.unchanged, 1);
    }

    #[test]
    fn operation_only_in_current_is_removed_by_name() {
        let diff = diff_operations(&[op("Add", "http://x/svc"), op("Sub", "http://x/svc")], &[op("Add", "http://x/svc")]);
        assert_eq!(diff.removed, vec!["Sub".to_string()]);
    }

    #[test]
    fn metadata_difference_marks_changed_with_fresh_version() {
        let fresh = op("Add", "http://x/v2/svc");
        let diff = diff_operations(&[op("Add", "http://x/svc")], std::slice::from_ref(&fresh));
        assert_eq!(diff.changed, vec![fresh]);
        assert_eq!(diff.unchanged, 0);
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run (inside `src-tauri/`): `cargo test domain::wsdl`
Expected: compile error — `DefinitionDiff` / `diff_operations` not found.

- [ ] **Step 3: Write the implementation**

Add above the tests in `src-tauri/src/domain/wsdl.rs`:

```rust
/// Result of diffing a re-fetched WSDL's operations against the imported ones
/// (product.md F6). Pure data — applying it lives in persistence.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DefinitionDiff {
    /// Operations present in the fresh WSDL but not imported yet.
    pub new: Vec<OperationRef>,
    /// Fresh version of operations whose metadata differs from the saved one.
    pub changed: Vec<OperationRef>,
    /// Names of imported operations that no longer exist in the fresh WSDL.
    pub removed: Vec<String>,
    /// Operations present on both sides with identical metadata.
    pub unchanged: u32,
}

/// Diff by operation name. `changed` carries the fresh `OperationRef` for any
/// name on both sides whose endpoint/action/version/input differ.
pub fn diff_operations(current: &[OperationRef], fresh: &[OperationRef]) -> DefinitionDiff {
    let mut diff = DefinitionDiff {
        new: vec![],
        changed: vec![],
        removed: vec![],
        unchanged: 0,
    };
    for op in fresh {
        match current.iter().find(|c| c.name == op.name) {
            None => diff.new.push(op.clone()),
            Some(cur) if cur != op => diff.changed.push(op.clone()),
            Some(_) => diff.unchanged += 1,
        }
    }
    for cur in current {
        if !fresh.iter().any(|op| op.name == cur.name) {
            diff.removed.push(cur.name.clone());
        }
    }
    diff
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run (inside `src-tauri/`): `cargo test domain::wsdl`
Expected: 4 tests PASS.

- [ ] **Step 5: Format, lint, commit**

```bash
cargo fmt && cargo clippy -- -D warnings
git add src-tauri/src/domain/wsdl.rs
git commit -m "feat(domain): pure operation diff for update definition"
```

---

### Task 2: Persistence — orphan flag, snapshot, and apply

**Files:**
- Modify: `src-tauri/src/persistence/collection.rs`
- Modify: `src-tauri/src/commands/mod.rs` (only the `RequestKind::Soap { … }` literal in `confirm_wsdl_import` gains `orphan: None`)

**Interfaces:**
- Consumes: `DefinitionDiff`, `diff_operations`, `OperationRef`, `QName`, `SoapVersion` from Task 1; existing helpers `collections_root`, `resolve_path`, `read_folder_meta`, `write_folder_meta`, `create_folder`, `create_request`, `validate_ids`.
- Produces (Task 3 relies on these exact signatures):
  - `orphan: Option<bool>` field on `RequestKind::Soap`.
  - `pub fn soap_snapshot(data_dir: &Path, workspace_id: &str, collection_id: &str) -> anyhow::Result<(String, Vec<OperationRef>)>` — `(wsdl_url, current operations)`, excluding the Orphans folder.
  - `pub fn apply_definition_update(data_dir: &Path, workspace_id: &str, collection_id: &str, wsdl_url: &str, diff: &DefinitionDiff) -> anyhow::Result<()>`.

- [ ] **Step 1: Add the orphan field**

In `src-tauri/src/persistence/collection.rs`, extend the `Soap` variant of `RequestKind`:

```rust
    #[serde(rename_all = "camelCase")]
    Soap {
        wsdl_url: String,
        operation: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        endpoint: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        soap_action: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        soap_version: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        input_element: Option<crate::domain::wsdl::QName>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        orphan: Option<bool>,
    },
```

Then run `cargo build` and add `orphan: None,` to every `RequestKind::Soap { … }` literal the compiler flags — `confirm_wsdl_import` in `src-tauri/src/commands/mod.rs` and the existing tests at the bottom of `collection.rs`.

- [ ] **Step 2: Write the failing tests**

Append inside the existing `mod tests` in `collection.rs` (reuse the existing `tmp(name)` helper):

```rust
    use crate::domain::wsdl::{DefinitionDiff, OperationRef, QName, SoapVersion};

    fn fresh_op(name: &str, endpoint: &str) -> OperationRef {
        OperationRef {
            name: name.into(),
            endpoint: endpoint.into(),
            soap_action: format!("http://x/{name}"),
            soap_version: SoapVersion::V11,
            input_element: QName { namespace: "http://x/ns".into(), local: name.into() },
        }
    }

    fn empty_diff() -> DefinitionDiff {
        DefinitionDiff { new: vec![], changed: vec![], removed: vec![], unchanged: 0 }
    }

    /// Import a service with the given ops; returns the collection id.
    fn import_service(dir: &Path, ops: &[OperationRef]) -> String {
        let col = create_collection(dir, "w1", "Svc").unwrap();
        let CollectionNode::Folder { id, .. } = col else { panic!() };
        for op in ops {
            create_request(dir, "w1", vec![id.clone()], &op.name, soap_kind("http://x?wsdl", op)).unwrap();
        }
        id
    }

    /// (request display name, kind) for every SOAP request directly under `path`.
    fn soap_children_at(dir: &Path, path: &[String]) -> Vec<(String, RequestKind)> {
        let nodes = list_collections(dir, "w1").unwrap();
        let mut cur = nodes;
        for id in path {
            cur = cur
                .into_iter()
                .find_map(|n| match n {
                    CollectionNode::Folder { id: fid, children, .. } if &fid == id => Some(children),
                    _ => None,
                })
                .unwrap();
        }
        cur.into_iter()
            .filter_map(|n| match n {
                CollectionNode::Request(r) if matches!(r.kind, RequestKind::Soap { .. }) => Some((r.name, r.kind)),
                _ => None,
            })
            .collect()
    }

    /// Id of the Orphans folder inside the collection, if present.
    fn orphans_folder_id(dir: &Path, col_id: &str) -> Option<String> {
        let nodes = list_collections(dir, "w1").unwrap();
        let children = nodes.into_iter().find_map(|n| match n {
            CollectionNode::Folder { id, children, .. } if id == col_id => Some(children),
            _ => None,
        })?;
        children.into_iter().find_map(|n| match n {
            CollectionNode::Folder { id, name, .. } if name == "Orphans" => Some(id),
            _ => None,
        })
    }

    #[test]
    fn snapshot_returns_wsdl_url_and_current_ops_excluding_orphans() {
        let dir = tmp("f6-snapshot");
        let col = import_service(&dir, &[fresh_op("Add", "http://x/svc"), fresh_op("Sub", "http://x/svc")]);
        // orphan "Sub" first so the snapshot must skip it
        let diff = DefinitionDiff { removed: vec!["Sub".into()], ..empty_diff() };
        apply_definition_update(&dir, "w1", &col, "http://x?wsdl", &diff).unwrap();

        let (url, ops) = soap_snapshot(&dir, "w1", &col).unwrap();
        assert_eq!(url, "http://x?wsdl");
        assert_eq!(ops.len(), 1);
        assert_eq!(ops[0].name, "Add");
    }

    #[test]
    fn apply_creates_requests_for_new_operations() {
        let dir = tmp("f6-new");
        let col = import_service(&dir, &[fresh_op("Add", "http://x/svc")]);
        let diff = DefinitionDiff { new: vec![fresh_op("Mul", "http://x/svc")], ..empty_diff() };
        apply_definition_update(&dir, "w1", &col, "http://x?wsdl", &diff).unwrap();

        let children = soap_children_at(&dir, &[col.clone()]);
        assert_eq!(children.len(), 2);
        assert!(children.iter().any(|(n, _)| n == "Mul"));
    }

    #[test]
    fn apply_moves_removed_operations_to_orphans_folder() {
        let dir = tmp("f6-orphan");
        let col = import_service(&dir, &[fresh_op("Add", "http://x/svc"), fresh_op("Sub", "http://x/svc")]);
        let diff = DefinitionDiff { removed: vec!["Sub".into()], ..empty_diff() };
        apply_definition_update(&dir, "w1", &col, "http://x?wsdl", &diff).unwrap();

        // gone from the collection root
        let root_children = soap_children_at(&dir, &[col.clone()]);
        assert_eq!(root_children.len(), 1, "orphaned request must leave the root, never be deleted");
        // present in Orphans with the flag set
        let orphans = orphans_folder_id(&dir, &col).expect("Orphans folder created");
        let orphaned = soap_children_at(&dir, &[col.clone(), orphans]);
        assert_eq!(orphaned.len(), 1);
        assert!(matches!(&orphaned[0].1, RequestKind::Soap { orphan: Some(true), .. }));
    }

    #[test]
    fn apply_refreshes_changed_metadata_preserving_user_data() {
        let dir = tmp("f6-changed");
        let col = import_service(&dir, &[fresh_op("Add", "http://x/svc")]);
        // save user data on the request
        let nodes = list_collections(&dir, "w1").unwrap();
        let CollectionNode::Folder { children, .. } = &nodes[0] else { panic!() };
        let CollectionNode::Request(req) = children[0].clone() else { panic!() };
        update_request(
            &dir,
            "w1",
            vec![col.clone(), req.id.clone()],
            RequestContent {
                kind: req.kind.clone(),
                params: vec![],
                headers: vec![KeyValueEntry {
                    id: "h1".into(),
                    key: "X-Trace".into(),
                    value: "on".into(),
                    description: None,
                    enabled: true,
                    entry_type: None,
                }],
                body: None,
                auth: None,
            },
        )
        .unwrap();

        let diff = DefinitionDiff { changed: vec![fresh_op("Add", "http://x/v2/svc")], ..empty_diff() };
        apply_definition_update(&dir, "w1", &col, "http://x?wsdl", &diff).unwrap();

        let rf = get_request(&dir, "w1", vec![col.clone(), req.id]).unwrap();
        let RequestKind::Soap { endpoint, .. } = &rf.kind else { panic!() };
        assert_eq!(endpoint.as_deref(), Some("http://x/v2/svc"));
        assert_eq!(rf.headers.len(), 1, "user headers must survive a metadata refresh");
    }

    #[test]
    fn apply_restores_an_orphan_when_its_operation_returns() {
        let dir = tmp("f6-unorphan");
        let col = import_service(&dir, &[fresh_op("Add", "http://x/svc"), fresh_op("Sub", "http://x/svc")]);
        let remove = DefinitionDiff { removed: vec!["Sub".into()], ..empty_diff() };
        apply_definition_update(&dir, "w1", &col, "http://x?wsdl", &remove).unwrap();

        let back = DefinitionDiff { new: vec![fresh_op("Sub", "http://x/svc")], ..empty_diff() };
        apply_definition_update(&dir, "w1", &col, "http://x?wsdl", &back).unwrap();

        let root_children = soap_children_at(&dir, &[col.clone()]);
        assert_eq!(root_children.len(), 2, "restored, not duplicated");
        let sub = root_children.iter().find(|(n, _)| n == "Sub").unwrap();
        assert!(matches!(&sub.1, RequestKind::Soap { orphan: None, .. }));
        let orphans = orphans_folder_id(&dir, &col).unwrap();
        assert!(soap_children_at(&dir, &[col.clone(), orphans]).is_empty());
    }
```

- [ ] **Step 3: Run tests to verify they fail**

Run (inside `src-tauri/`): `cargo test persistence::collection`
Expected: compile error — `soap_kind`, `soap_snapshot`, `apply_definition_update` not found.

- [ ] **Step 4: Write the implementation**

Add a new section in `collection.rs` before the tests:

```rust
// ── F6 Update Definition ─────────────────────────────────────────────────────

use crate::domain::wsdl::{DefinitionDiff, OperationRef, QName, SoapVersion};

const ORPHANS_FOLDER_NAME: &str = "Orphans";

fn soap_version_str(v: SoapVersion) -> &'static str {
    match v {
        SoapVersion::V11 => "1.1",
        SoapVersion::V12 => "1.2",
    }
}

/// RequestKind for a fresh operation. Also used to refresh a stale request's
/// metadata: everything the WSDL owns comes from `op`, orphan is cleared.
pub fn soap_kind(wsdl_url: &str, op: &OperationRef) -> RequestKind {
    RequestKind::Soap {
        wsdl_url: wsdl_url.to_string(),
        operation: op.name.clone(),
        endpoint: Some(op.endpoint.clone()),
        soap_action: Some(op.soap_action.clone()),
        soap_version: Some(soap_version_str(op.soap_version).to_string()),
        input_element: Some(op.input_element.clone()),
        orphan: None,
    }
}

/// OperationRef as saved on disk. Missing optional metadata (pre-slice files)
/// becomes empty defaults so the diff flags the operation as changed.
fn saved_operation_ref(kind: &RequestKind) -> Option<OperationRef> {
    let RequestKind::Soap {
        operation,
        endpoint,
        soap_action,
        soap_version,
        input_element,
        ..
    } = kind
    else {
        return None;
    };
    Some(OperationRef {
        name: operation.clone(),
        endpoint: endpoint.clone().unwrap_or_default(),
        soap_action: soap_action.clone().unwrap_or_default(),
        soap_version: match soap_version.as_deref() {
            Some("1.2") => SoapVersion::V12,
            _ => SoapVersion::V11,
        },
        input_element: input_element.clone().unwrap_or(QName {
            namespace: String::new(),
            local: String::new(),
        }),
    })
}

/// Recursively collect SOAP requests under `dir` as (id path relative to the
/// collection root, file). `skip` omits one direct child of the root (Orphans).
fn collect_soap_requests(
    dir: &Path,
    prefix: &[String],
    skip: Option<&str>,
) -> anyhow::Result<Vec<(Vec<String>, RequestFile)>> {
    let meta = read_folder_meta(dir)?;
    let mut out = vec![];
    for id in &meta.children_order {
        if prefix.is_empty() && Some(id.as_str()) == skip {
            continue;
        }
        let path: Vec<String> = prefix.iter().cloned().chain([id.clone()]).collect();
        let sub = dir.join(id);
        let file = dir.join(format!("{id}.toml"));
        if sub.is_dir() {
            out.extend(collect_soap_requests(&sub, &path, None)?);
        } else if file.exists() {
            let rf: RequestFile = toml::from_str(&std::fs::read_to_string(&file)?)?;
            if matches!(rf.kind, RequestKind::Soap { .. }) {
                out.push((path, rf));
            }
        }
    }
    Ok(out)
}

fn find_by_operation<'a>(
    reqs: &'a [(Vec<String>, RequestFile)],
    name: &str,
) -> Option<&'a (Vec<String>, RequestFile)> {
    reqs.iter().find(
        |(_, rf)| matches!(&rf.kind, RequestKind::Soap { operation, .. } if operation == name),
    )
}

fn find_orphans_folder(col_dir: &Path) -> anyhow::Result<Option<String>> {
    let meta = read_folder_meta(col_dir)?;
    for id in &meta.children_order {
        let sub = col_dir.join(id);
        if sub.is_dir() && read_folder_meta(&sub)?.name == ORPHANS_FOLDER_NAME {
            return Ok(Some(id.clone()));
        }
    }
    Ok(None)
}

/// Move a request file to another folder of the same collection, rewriting it
/// with `rf` and keeping both children_order metas consistent.
fn move_request(
    col_dir: &Path,
    from: &[String],
    to_folder: &[String],
    rf: &RequestFile,
) -> anyhow::Result<()> {
    let id = from.last().ok_or_else(|| anyhow::anyhow!("empty path"))?;
    let from_dir = resolve_path(col_dir, &from[..from.len() - 1]);
    let to_dir = resolve_path(col_dir, to_folder);
    std::fs::write(to_dir.join(format!("{id}.toml")), toml::to_string(rf)?)?;
    if from_dir != to_dir {
        std::fs::remove_file(from_dir.join(format!("{id}.toml")))?;
        let mut m = read_folder_meta(&from_dir)?;
        m.children_order.retain(|x| x != id);
        write_folder_meta(&from_dir, &m)?;
        let mut m = read_folder_meta(&to_dir)?;
        m.children_order.push(id.clone());
        write_folder_meta(&to_dir, &m)?;
    }
    Ok(())
}

/// wsdl_url + saved operation snapshot of an imported collection. Requests in
/// the Orphans folder don't count as current operations.
pub fn soap_snapshot(
    data_dir: &Path,
    workspace_id: &str,
    collection_id: &str,
) -> anyhow::Result<(String, Vec<OperationRef>)> {
    validate_ids(&[collection_id.to_string()])?;
    let col_dir = collections_root(data_dir, workspace_id).join(collection_id);
    let orphans = find_orphans_folder(&col_dir)?;
    let reqs = collect_soap_requests(&col_dir, &[], orphans.as_deref())?;
    let wsdl_url = reqs
        .iter()
        .find_map(|(_, rf)| match &rf.kind {
            RequestKind::Soap { wsdl_url, .. } => Some(wsdl_url.clone()),
            _ => None,
        })
        .ok_or_else(|| anyhow::anyhow!("collection has no SOAP requests"))?;
    let ops = reqs
        .iter()
        .filter_map(|(_, rf)| saved_operation_ref(&rf.kind))
        .collect();
    Ok((wsdl_url, ops))
}

/// Apply a previewed diff: create new requests (restoring matching orphans),
/// refresh changed metadata in place, and move removed operations into the
/// Orphans folder — never delete (product.md F6).
pub fn apply_definition_update(
    data_dir: &Path,
    workspace_id: &str,
    collection_id: &str,
    wsdl_url: &str,
    diff: &DefinitionDiff,
) -> anyhow::Result<()> {
    validate_ids(&[collection_id.to_string()])?;
    let col_dir = collections_root(data_dir, workspace_id).join(collection_id);
    let mut orphans_id = find_orphans_folder(&col_dir)?;

    // Removed → Orphans (folder created on first use) + orphan flag.
    if !diff.removed.is_empty() {
        let oid = match &orphans_id {
            Some(id) => id.clone(),
            None => {
                let CollectionNode::Folder { id, .. } = create_folder(
                    data_dir,
                    workspace_id,
                    vec![collection_id.to_string()],
                    ORPHANS_FOLDER_NAME,
                )?
                else {
                    anyhow::bail!("create_folder did not return a folder");
                };
                orphans_id = Some(id.clone());
                id
            }
        };
        let current = collect_soap_requests(&col_dir, &[], Some(&oid))?;
        for name in &diff.removed {
            let Some((path, rf)) = find_by_operation(&current, name) else {
                continue; // already moved or hand-deleted; nothing to orphan
            };
            let mut rf = rf.clone();
            if let RequestKind::Soap { orphan, .. } = &mut rf.kind {
                *orphan = Some(true);
            }
            move_request(&col_dir, path, &[oid.clone()], &rf)?;
        }
    }

    // New → restore a matching orphan, else create at the collection root.
    for op in &diff.new {
        let restored = if let Some(oid) = &orphans_id {
            let orphaned = collect_soap_requests(&col_dir.join(oid), &[oid.clone()], None)?;
            match find_by_operation(&orphaned, &op.name) {
                Some((path, rf)) => {
                    let mut rf = rf.clone();
                    rf.kind = soap_kind(wsdl_url, op);
                    move_request(&col_dir, path, &[], &rf)?;
                    true
                }
                None => false,
            }
        } else {
            false
        };
        if !restored {
            create_request(
                data_dir,
                workspace_id,
                vec![collection_id.to_string()],
                &op.name,
                soap_kind(wsdl_url, op),
            )?;
        }
    }

    // Changed → refresh metadata in place, wherever the request lives.
    let current = collect_soap_requests(&col_dir, &[], orphans_id.as_deref())?;
    for op in &diff.changed {
        let Some((path, rf)) = find_by_operation(&current, &op.name) else {
            continue;
        };
        let mut rf = rf.clone();
        rf.kind = soap_kind(wsdl_url, op);
        let parent = resolve_path(&col_dir, &path[..path.len() - 1]);
        std::fs::write(
            parent.join(format!("{}.toml", rf.id)),
            toml::to_string(&rf)?,
        )?;
    }

    Ok(())
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run (inside `src-tauri/`): `cargo test`
Expected: all tests PASS (new F6 tests plus the whole existing suite — the `orphan` field must not break any round-trip test).

- [ ] **Step 6: Format, lint, commit**

```bash
cargo fmt && cargo clippy -- -D warnings
git add src-tauri/src/persistence/collection.rs src-tauri/src/commands/mod.rs
git commit -m "feat(persistence): apply wsdl definition updates with orphan folder"
```

---

### Task 3: Command pair, registration, bindings, api wrappers

**Files:**
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs:19-25` (command list)
- Modify: `src/lib/api.ts`
- Regenerated: `src/bindings.ts` (via `cargo test export_bindings` — never by hand)

**Interfaces:**
- Consumes: `soap_snapshot`, `apply_definition_update` (Task 2); `diff_operations`, `DefinitionDiff` (Task 1).
- Produces: commands `preview_definition_update(workspace_id, collection_id) -> DefinitionUpdatePreview` and `apply_definition_update(workspace_id, collection_id, preview)`; TS wrappers `api.previewDefinitionUpdate(workspaceId, collectionId)` and `api.applyDefinitionUpdate(workspaceId, collectionId, preview)`; re-exported TS types `DefinitionDiff`, `DefinitionUpdatePreview`. Tasks 4-6 rely on these exact names.

- [ ] **Step 1: Extract the shared fetch pipeline and add the commands**

In `src-tauri/src/commands/mod.rs`, replace the body of `import_wsdl` with a call to a new helper, then add the F6 pair:

```rust
/// Shared F2 pipeline: fetch the WSDL, parse it, and resolve the full schema
/// closure up front so failures name WHICH url failed and why — never a
/// silent partial import. Used by import and Update Definition (F6).
async fn fetch_parse_resolve(url: &str) -> Result<wsdl::parse::WsdlDocument, String> {
    let client = http_client()?;
    let fetch = |u: String| {
        let client = client.clone();
        async move { fetch_text(&client, &u).await }
    };
    let xml = fetch(url.to_string()).await.map_err(|message| {
        wsdl::error::WsdlError::Fetch {
            url: url.to_string(),
            message,
        }
        .to_string()
    })?;
    let parsed = wsdl::parse::parse(url, &xml).map_err(|e| e.to_string())?;
    // SchemaSet discarded here: resolve runs to validate the full schema
    // closure up front; get_operation_schema/send_soap rebuild it on demand.
    wsdl::resolve::resolve(url, &xml, fetch)
        .await
        .map_err(|e| e.to_string())?;
    Ok(parsed)
}

#[tauri::command]
#[specta::specta]
pub async fn import_wsdl(url: String) -> Result<WsdlImportPreview, String> {
    let parsed = fetch_parse_resolve(&url).await?;
    Ok(WsdlImportPreview {
        service_name: parsed.service_name,
        wsdl_url: url,
        operations: parsed.operations,
    })
}

use crate::domain::wsdl::{diff_operations, DefinitionDiff};

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DefinitionUpdatePreview {
    pub service_name: String,
    pub wsdl_url: String,
    pub diff: DefinitionDiff,
}

/// Update Definition (product.md F6), preview half: re-fetch the collection's
/// WSDL through the same pipeline as import and diff against what's saved.
#[tauri::command]
#[specta::specta]
pub async fn preview_definition_update(
    app: tauri::AppHandle,
    workspace_id: String,
    collection_id: String,
) -> Result<DefinitionUpdatePreview, String> {
    let dir = data_dir(&app)?;
    let (wsdl_url, current) =
        collection::soap_snapshot(&dir, &workspace_id, &collection_id).map_err(|e| e.to_string())?;
    let parsed = fetch_parse_resolve(&wsdl_url).await?;
    let diff = diff_operations(&current, &parsed.operations);
    Ok(DefinitionUpdatePreview {
        service_name: parsed.service_name,
        wsdl_url,
        diff,
    })
}

/// Update Definition (product.md F6), apply half: persist a previewed diff.
#[tauri::command]
#[specta::specta]
pub fn apply_definition_update(
    app: tauri::AppHandle,
    workspace_id: String,
    collection_id: String,
    preview: DefinitionUpdatePreview,
) -> Result<(), String> {
    let dir = data_dir(&app)?;
    collection::apply_definition_update(
        &dir,
        &workspace_id,
        &collection_id,
        &preview.wsdl_url,
        &preview.diff,
    )
    .map_err(|e| e.to_string())
}
```

- [ ] **Step 2: Register the commands**

In `src-tauri/src/lib.rs`, append to the `collect_commands![...]` list:

```rust
        commands::preview_definition_update,
        commands::apply_definition_update,
```

- [ ] **Step 3: Regenerate bindings and verify**

Run (inside `src-tauri/`): `cargo test export_bindings`
Expected: PASS. Then `grep -n "previewDefinitionUpdate\|applyDefinitionUpdate\|DefinitionDiff" ../src/bindings.ts` shows the new commands and types.

- [ ] **Step 4: Add the api.ts wrappers**

In `src/lib/api.ts`, add to the type re-exports:

```ts
export type { DefinitionDiff, DefinitionUpdatePreview } from "../bindings";
```

and import `DefinitionUpdatePreview` in the `import type { ... }` block, then add to the `api` object:

```ts
  previewDefinitionUpdate: (workspaceId: string, collectionId: string) =>
    unwrap(commands.previewDefinitionUpdate(workspaceId, collectionId)),

  applyDefinitionUpdate: (
    workspaceId: string,
    collectionId: string,
    preview: DefinitionUpdatePreview,
  ) => unwrap(commands.applyDefinitionUpdate(workspaceId, collectionId, preview)),
```

- [ ] **Step 5: Verify everything builds**

Run (inside `src-tauri/`): `cargo test` — expected: PASS.
Run (repo root): `pnpm test -- --run` — expected: existing suite PASS (typecheck of api.ts happens via Vitest's TS pipeline; also run `pnpm lint`).

- [ ] **Step 6: Format, lint, commit**

```bash
cargo fmt && cargo clippy -- -D warnings && pnpm lint
git add src-tauri/src/commands/mod.rs src-tauri/src/lib.rs src/bindings.ts src/lib/api.ts
git commit -m "feat(commands): preview and apply definition update pair"
```

---

### Task 4: Frontend stores — settings flag + update-definition flow

**Files:**
- Create: `src/store/settingsStore.ts`
- Create: `src/store/updateDefinitionStore.ts`
- Test: `src/store/updateDefinitionStore.test.ts`
- Modify: `src/main.tsx:15` (init chain)

**Interfaces:**
- Consumes: `api.previewDefinitionUpdate` / `api.applyDefinitionUpdate` / `DefinitionUpdatePreview` (Task 3); `getStore()` from `src/lib/storage`; `useCollectionStore.load`.
- Produces: `useSettingsStore` with `skipUpdatePreview: boolean` + `setSkipUpdatePreview(v)` + `initSettingsStore()`; `useUpdateDefinitionStore` with `phase` (`idle | loading | preview | done | error`), `start(workspaceId, collectionId)`, `apply(workspaceId)`, `reset()`. Tasks 5-6 rely on these exact names.

- [ ] **Step 1: Write settingsStore**

`src/store/settingsStore.ts`:

```ts
import { create } from "zustand";
import { getStore } from "../lib/storage";

interface SettingsState {
  /** F6: skip the diff preview modal and apply definition updates directly. */
  skipUpdatePreview: boolean;
  setSkipUpdatePreview: (v: boolean) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  skipUpdatePreview: false,

  setSkipUpdatePreview(v) {
    set({ skipUpdatePreview: v });
    getStore().then((s) => s.set("skipUpdatePreview", v));
  },
}));

export async function initSettingsStore() {
  const store = await getStore();
  const v = await store.get<boolean>("skipUpdatePreview");
  if (v !== undefined) useSettingsStore.setState({ skipUpdatePreview: v ?? false });
}
```

In `src/main.tsx` replace `initWorkspaceStore().then(render)` with:

```ts
Promise.all([initWorkspaceStore(), initSettingsStore()]).then(render)
```

(keep the existing `.catch` handler; add the `initSettingsStore` import).

- [ ] **Step 2: Write the failing store tests**

`src/store/updateDefinitionStore.test.ts` (mirrors `wsdlImportStore.test.ts`):

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/api", () => ({
  api: {
    previewDefinitionUpdate: vi.fn(),
    applyDefinitionUpdate: vi.fn(),
    listCollections: vi.fn().mockResolvedValue([]),
  },
}));
vi.mock("../lib/storage", () => ({
  getStore: vi.fn().mockResolvedValue({ set: vi.fn(), get: vi.fn() }),
}));

import { useUpdateDefinitionStore } from "./updateDefinitionStore";
import { useSettingsStore } from "./settingsStore";
import { DefinitionUpdatePreview } from "../lib/api";
import { api } from "../lib/api";

const OP = {
  name: "Mul",
  endpoint: "http://x/svc",
  soapAction: "http://x/Mul",
  soapVersion: "1.1" as const,
  inputElement: { namespace: "http://x/ns", local: "Mul" },
};

const PREVIEW: DefinitionUpdatePreview = {
  serviceName: "CalcService",
  wsdlUrl: "http://x/svc?wsdl",
  diff: { new: [OP], changed: [], removed: ["Sub"], unchanged: 1 },
};

beforeEach(() => {
  useUpdateDefinitionStore.setState({ phase: { state: "idle" } });
  useSettingsStore.setState({ skipUpdatePreview: false });
  vi.clearAllMocks();
});

describe("start", () => {
  it("lands on preview with the fetched diff", async () => {
    vi.mocked(api.previewDefinitionUpdate).mockResolvedValue(PREVIEW);
    await useUpdateDefinitionStore.getState().start("w1", "c1");
    const phase = useUpdateDefinitionStore.getState().phase;
    expect(phase).toEqual({ state: "preview", collectionId: "c1", preview: PREVIEW });
    expect(api.applyDefinitionUpdate).not.toHaveBeenCalled();
  });

  it("applies directly when skipUpdatePreview is on", async () => {
    useSettingsStore.setState({ skipUpdatePreview: true });
    vi.mocked(api.previewDefinitionUpdate).mockResolvedValue(PREVIEW);
    vi.mocked(api.applyDefinitionUpdate).mockResolvedValue(undefined);
    await useUpdateDefinitionStore.getState().start("w1", "c1");
    expect(api.applyDefinitionUpdate).toHaveBeenCalledWith("w1", "c1", PREVIEW);
    expect(useUpdateDefinitionStore.getState().phase).toEqual({
      state: "done",
      summary: "Applied: 1 new, 0 changed, 1 orphaned",
    });
  });

  it("still previews an empty diff when skipUpdatePreview is on", async () => {
    useSettingsStore.setState({ skipUpdatePreview: true });
    const empty = { ...PREVIEW, diff: { new: [], changed: [], removed: [], unchanged: 2 } };
    vi.mocked(api.previewDefinitionUpdate).mockResolvedValue(empty);
    await useUpdateDefinitionStore.getState().start("w1", "c1");
    expect(api.applyDefinitionUpdate).not.toHaveBeenCalled();
    expect(useUpdateDefinitionStore.getState().phase.state).toBe("preview");
  });

  it("surfaces fetch errors", async () => {
    vi.mocked(api.previewDefinitionUpdate).mockRejectedValue("fetch http://x failed");
    await useUpdateDefinitionStore.getState().start("w1", "c1");
    expect(useUpdateDefinitionStore.getState().phase).toEqual({
      state: "error",
      message: "fetch http://x failed",
    });
  });
});

describe("apply", () => {
  it("applies the previewed diff and reports a summary", async () => {
    vi.mocked(api.applyDefinitionUpdate).mockResolvedValue(undefined);
    useUpdateDefinitionStore.setState({
      phase: { state: "preview", collectionId: "c1", preview: PREVIEW },
    });
    await useUpdateDefinitionStore.getState().apply("w1");
    expect(api.applyDefinitionUpdate).toHaveBeenCalledWith("w1", "c1", PREVIEW);
    expect(useUpdateDefinitionStore.getState().phase).toEqual({
      state: "done",
      summary: "Applied: 1 new, 0 changed, 1 orphaned",
    });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm test -- --run src/store/updateDefinitionStore.test.ts`
Expected: FAIL — module `./updateDefinitionStore` not found.

- [ ] **Step 4: Write updateDefinitionStore**

`src/store/updateDefinitionStore.ts`:

```ts
import { create } from "zustand";
import { api, DefinitionUpdatePreview } from "../lib/api";
import { useCollectionStore } from "./collectionStore";
import { useSettingsStore } from "./settingsStore";

type Phase =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "preview"; collectionId: string; preview: DefinitionUpdatePreview }
  | { state: "done"; summary: string }
  | { state: "error"; message: string };

interface UpdateDefinitionState {
  phase: Phase;
  start: (workspaceId: string, collectionId: string) => Promise<void>;
  apply: (workspaceId: string) => Promise<void>;
  reset: () => void;
}

type Diff = DefinitionUpdatePreview["diff"];

const isEmpty = (d: Diff) => d.new.length === 0 && d.changed.length === 0 && d.removed.length === 0;

const summary = (d: Diff) =>
  `Applied: ${d.new.length} new, ${d.changed.length} changed, ${d.removed.length} orphaned`;

export const useUpdateDefinitionStore = create<UpdateDefinitionState>((set, get) => ({
  phase: { state: "idle" },

  async start(workspaceId, collectionId) {
    set({ phase: { state: "loading" } });
    try {
      const preview = await api.previewDefinitionUpdate(workspaceId, collectionId);
      // Settings can skip the preview — but an empty diff still just informs.
      if (useSettingsStore.getState().skipUpdatePreview && !isEmpty(preview.diff)) {
        await api.applyDefinitionUpdate(workspaceId, collectionId, preview);
        await useCollectionStore.getState().load(workspaceId);
        set({ phase: { state: "done", summary: summary(preview.diff) } });
        return;
      }
      set({ phase: { state: "preview", collectionId, preview } });
    } catch (e) {
      set({ phase: { state: "error", message: String(e) } });
    }
  },

  async apply(workspaceId) {
    const phase = get().phase;
    if (phase.state !== "preview") return;
    try {
      await api.applyDefinitionUpdate(workspaceId, phase.collectionId, phase.preview);
      await useCollectionStore.getState().load(workspaceId);
      set({ phase: { state: "done", summary: summary(phase.preview.diff) } });
    } catch (e) {
      set({ phase: { state: "error", message: String(e) } });
    }
  },

  reset() {
    set({ phase: { state: "idle" } });
  },
}));
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test -- --run`
Expected: new tests PASS, existing suite PASS.

- [ ] **Step 6: Commit**

```bash
pnpm lint
git add src/store/settingsStore.ts src/store/updateDefinitionStore.ts src/store/updateDefinitionStore.test.ts src/main.tsx
git commit -m "feat(store): update definition flow with skip-preview setting"
```

---

### Task 5: Diff modal + context-menu entry

**Files:**
- Create: `src/components/UpdateDefinitionModal.tsx`
- Test: `src/components/UpdateDefinitionModal.test.tsx`
- Modify: `src/components/Sidebar.tsx` (mount the modal next to `ImportWsdlModal`)
- Modify: `src/components/CollectionTree.tsx` (menu action)

**Interfaces:**
- Consumes: `useUpdateDefinitionStore` (Task 4); `useWorkspaceStore.activeId`; `DefinitionUpdatePreview` type.
- Produces: `<UpdateDefinitionModal />` (self-contained — visibility driven by store phase, no props); `MenuAction` variant `{ type: "updateDefinition"; collectionId: string }`.

- [ ] **Step 1: Write the failing modal tests**

`src/components/UpdateDefinitionModal.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

vi.mock("../lib/api", () => ({
  api: {
    previewDefinitionUpdate: vi.fn(),
    applyDefinitionUpdate: vi.fn(),
    listCollections: vi.fn().mockResolvedValue([]),
  },
}));
vi.mock("../lib/storage", () => ({
  getStore: vi.fn().mockResolvedValue({ set: vi.fn(), get: vi.fn() }),
}));

import { UpdateDefinitionModal } from "./UpdateDefinitionModal";
import { useUpdateDefinitionStore } from "../store/updateDefinitionStore";
import { DefinitionUpdatePreview } from "../lib/api";

const OP = {
  name: "Mul",
  endpoint: "http://x/svc",
  soapAction: "http://x/Mul",
  soapVersion: "1.1" as const,
  inputElement: { namespace: "http://x/ns", local: "Mul" },
};

const PREVIEW: DefinitionUpdatePreview = {
  serviceName: "CalcService",
  wsdlUrl: "http://x/svc?wsdl",
  diff: { new: [OP], changed: [{ ...OP, name: "Add" }], removed: ["Sub"], unchanged: 1 },
};

afterEach(cleanup);
beforeEach(() => {
  useUpdateDefinitionStore.setState({ phase: { state: "idle" } });
});

describe("UpdateDefinitionModal", () => {
  it("renders nothing while idle", () => {
    const { container } = render(<UpdateDefinitionModal />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the three diff sections in preview", () => {
    useUpdateDefinitionStore.setState({
      phase: { state: "preview", collectionId: "c1", preview: PREVIEW },
    });
    render(<UpdateDefinitionModal />);
    expect(screen.getByText("Mul")).toBeTruthy();
    expect(screen.getByText("Add")).toBeTruthy();
    expect(screen.getByText("Sub")).toBeTruthy();
    expect(screen.getByText("Apply Changes")).toBeTruthy();
  });

  it("shows an up-to-date message for an empty diff", () => {
    useUpdateDefinitionStore.setState({
      phase: {
        state: "preview",
        collectionId: "c1",
        preview: { ...PREVIEW, diff: { new: [], changed: [], removed: [], unchanged: 2 } },
      },
    });
    render(<UpdateDefinitionModal />);
    expect(screen.getByText(/up to date/i)).toBeTruthy();
    expect(screen.queryByText("Apply Changes")).toBeNull();
  });

  it("shows the summary in done state and resets on OK", () => {
    useUpdateDefinitionStore.setState({
      phase: { state: "done", summary: "Applied: 1 new, 1 changed, 1 orphaned" },
    });
    render(<UpdateDefinitionModal />);
    expect(screen.getByText("Applied: 1 new, 1 changed, 1 orphaned")).toBeTruthy();
    fireEvent.click(screen.getByText("OK"));
    expect(useUpdateDefinitionStore.getState().phase.state).toBe("idle");
  });

  it("shows the error message", () => {
    useUpdateDefinitionStore.setState({
      phase: { state: "error", message: "fetch http://x failed: HTTP 404" },
    });
    render(<UpdateDefinitionModal />);
    expect(screen.getByText("fetch http://x failed: HTTP 404")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- --run src/components/UpdateDefinitionModal.test.tsx`
Expected: FAIL — module `./UpdateDefinitionModal` not found.

- [ ] **Step 3: Write the modal**

`src/components/UpdateDefinitionModal.tsx` (visuals follow `ImportWsdlModal.tsx` — same overlay, card, header, footer classes):

```tsx
import { Hexagon, RefreshCw, X } from "lucide-react";
import { useUpdateDefinitionStore } from "../store/updateDefinitionStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import type { DefinitionUpdatePreview } from "../lib/api";

function Section({ title, names }: { title: string; names: string[] }) {
  if (names.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-[0.5px] text-muted">
        {title}
      </span>
      <div className="max-h-[120px] overflow-y-auto rounded-[4px] border border-border">
        {names.map((name) => (
          <div key={name} className="flex items-center gap-2 px-3 py-[6px] text-[13px] text-foreground">
            <Hexagon size={14} className="text-soap-op shrink-0" />
            {name}
          </div>
        ))}
      </div>
    </div>
  );
}

const isEmpty = (d: DefinitionUpdatePreview["diff"]) =>
  d.new.length === 0 && d.changed.length === 0 && d.removed.length === 0;

export function UpdateDefinitionModal() {
  const phase = useUpdateDefinitionStore((s) => s.phase);
  const apply = useUpdateDefinitionStore((s) => s.apply);
  const reset = useUpdateDefinitionStore((s) => s.reset);
  const workspaceId = useWorkspaceStore((s) => s.activeId);

  if (phase.state === "idle") return null;

  const upToDate = phase.state === "preview" && isEmpty(phase.preview.diff);
  const applicable = phase.state === "preview" && !upToDate;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onPointerDown={(e) => { if (e.target === e.currentTarget) reset(); }}
    >
      <div className="w-[480px] rounded-[6px] bg-card border border-border overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4">
          <span className="text-[15px] font-semibold text-foreground">Update Definition</span>
          <X size={16} className="text-muted cursor-pointer hover:text-foreground" onClick={reset} />
        </div>

        <div className="h-px bg-border" />

        <div className="flex flex-col gap-4 px-5 py-5">
          {phase.state === "loading" && (
            <div className="flex items-center gap-2 text-[13px] text-muted">
              <RefreshCw size={14} className="animate-spin" />
              Fetching WSDL…
            </div>
          )}

          {phase.state === "error" && (
            <div className="rounded-[4px] border border-border bg-secondary px-3 py-2 text-[12px] text-destructive break-all">
              {phase.message}
            </div>
          )}

          {phase.state === "done" && (
            <span className="text-[13px] text-foreground">{phase.summary}</span>
          )}

          {upToDate && (
            <span className="text-[13px] text-muted">
              Everything is up to date — the WSDL matches the imported operations.
            </span>
          )}

          {applicable && phase.state === "preview" && (
            <>
              <span className="text-[12px] font-semibold text-foreground">
                {phase.preview.serviceName}
                <span className="text-muted font-normal"> · {phase.preview.wsdlUrl}</span>
              </span>
              <Section title="New" names={phase.preview.diff.new.map((o) => o.name)} />
              <Section title="Changed" names={phase.preview.diff.changed.map((o) => o.name)} />
              <Section title="Removed → Orphans" names={phase.preview.diff.removed} />
            </>
          )}
        </div>

        <div className="h-px bg-border" />

        <div className="flex items-center justify-end gap-[10px] px-5 py-[14px]">
          {applicable ? (
            <>
              <button
                className="px-4 py-[7px] rounded-[4px] text-[13px] font-medium text-foreground bg-secondary border border-border hover:bg-secondary/80 cursor-pointer"
                onClick={reset}
              >
                Cancel
              </button>
              <button
                className="px-4 py-[7px] rounded-[4px] text-[13px] font-semibold bg-accent text-accent-foreground hover:bg-accent/90 cursor-pointer"
                onClick={() => apply(workspaceId)}
              >
                Apply Changes
              </button>
            </>
          ) : (
            <button
              className="px-4 py-[7px] rounded-[4px] text-[13px] font-medium text-foreground bg-secondary border border-border hover:bg-secondary/80 cursor-pointer"
              onClick={reset}
            >
              {phase.state === "loading" ? "Cancel" : "OK"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- --run src/components/UpdateDefinitionModal.test.tsx`
Expected: 5 tests PASS.

- [ ] **Step 5: Mount the modal and wire the context menu**

`src/components/Sidebar.tsx` — next to `<ImportWsdlModal … />` add:

```tsx
<UpdateDefinitionModal />
```

(with `import { UpdateDefinitionModal } from "./UpdateDefinitionModal";`).

`src/components/CollectionTree.tsx`:

1. Extend the union (line ~33):

```ts
type MenuAction =
  | { type: "rename"; path: string[]; currentName: string }
  | { type: "delete"; path: string[] }
  | { type: "newFolder"; parentPath: string[] }
  | { type: "newRequest"; parentPath: string[] }
  | { type: "updateDefinition"; collectionId: string };
```

2. In `ContextMenu`'s `label` function add before the final return:

```ts
    if (a.type === "updateDefinition") return "Update Definition";
```

3. Add a helper next to `arraysEqual`:

```ts
function hasSoapRequest(node: Extract<CollectionNode, { type: "folder" }>): boolean {
  return node.children.some((c) =>
    c.type === "request" ? c.kind === "soap" : hasSoapRequest(c)
  );
}
```

4. In `SortableFolderItem` (uses `useUpdateDefinitionStore` — add the import):

```ts
  const startUpdateDefinition = useUpdateDefinitionStore((s) => s.start);
```

extend `handleAction`:

```ts
    if (a.type === "updateDefinition") startUpdateDefinition(workspaceId, a.collectionId);
```

and build the menu with the entry first, only for imported root collections:

```ts
  // Update Definition targets an imported service: a root collection holding SOAP requests.
  const menuActions: MenuAction[] = [
    ...(path.length === 1 && hasSoapRequest(node)
      ? [{ type: "updateDefinition", collectionId: node.id } satisfies MenuAction]
      : []),
    { type: "newRequest", parentPath: path },
    { type: "newFolder", parentPath: path },
    { type: "rename", path, currentName: node.name },
    { type: "delete", path },
  ];
```

- [ ] **Step 6: Run the full frontend suite**

Run: `pnpm test -- --run`
Expected: PASS (including the existing `CollectionTree` tests).

- [ ] **Step 7: Commit**

```bash
pnpm lint
git add src/components/UpdateDefinitionModal.tsx src/components/UpdateDefinitionModal.test.tsx src/components/Sidebar.tsx src/components/CollectionTree.tsx
git commit -m "feat(ui): update definition diff modal and collection menu entry"
```

---

### Task 6: Orphan badge + Settings toggle

**Files:**
- Modify: `src/components/CollectionTree.tsx` (request row badge)
- Modify: `src/components/CollectionTree.test.tsx`
- Modify: `src/components/SettingsDialog.tsx` (General section)

**Interfaces:**
- Consumes: `orphan` field on soap `CollectionNode` requests (flattened into the node by bindings, Task 3); `useSettingsStore` (Task 4).
- Produces: user-visible orphan badge; working Settings toggle. Nothing downstream depends on this task.

- [ ] **Step 1: Write the failing badge test**

Append to `src/components/CollectionTree.test.tsx`:

```tsx
describe("CollectionTree — orphan badge", () => {
  it("marks an orphaned soap request", () => {
    useCollectionStore.setState({
      collections: [{ ...soapNode, orphan: true }],
    });
    render(<CollectionTree workspaceId="w1" />);
    expect(screen.getByText("orphan")).toBeTruthy();
  });

  it("does not mark a live soap request", () => {
    useCollectionStore.setState({ collections: [soapNode] });
    render(<CollectionTree workspaceId="w1" />);
    expect(screen.queryByText("orphan")).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify the first one fails**

Run: `pnpm test -- --run src/components/CollectionTree.test.tsx`
Expected: FAIL — no element with text "orphan".

- [ ] **Step 3: Render the badge**

In `SortableRequestItem` (`CollectionTree.tsx`), after the `isSoap` line:

```ts
  const isOrphan = node.kind === "soap" && node.orphan === true;
```

and just before the closing of the row (after the name/`RenameInput` block, before `{menu && …}`):

```tsx
      {isOrphan && (
        <span
          className="ml-auto shrink-0 text-[9px] uppercase tracking-[0.5px] text-sidebar-muted border border-border rounded-[3px] px-1"
          title="Operation no longer exists in the WSDL"
        >
          orphan
        </span>
      )}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- --run src/components/CollectionTree.test.tsx`
Expected: PASS.

- [ ] **Step 5: Add the Settings toggle**

In `src/components/SettingsDialog.tsx`, add a `GeneralSection` (import `useSettingsStore`):

```tsx
function GeneralSection({ onClose }: { onClose: () => void }) {
  const skip = useSettingsStore((s) => s.skipUpdatePreview);
  const setSkip = useSettingsStore((s) => s.setSkipUpdatePreview);
  return (
    <div className="relative flex flex-col gap-4 p-6">
      <button
        className="absolute top-3 right-3 p-1 rounded text-muted hover:text-foreground cursor-pointer"
        onClick={onClose}
      >
        <X size={16} />
      </button>
      <span className="text-[15px] font-semibold text-foreground">General</span>
      <label className="flex items-start gap-3 cursor-pointer select-none">
        <input
          type="checkbox"
          className="mt-[2px]"
          checked={skip}
          onChange={(e) => setSkip(e.target.checked)}
        />
        <span className="flex flex-col">
          <span className="text-[13px] text-foreground">
            Apply definition updates without preview
          </span>
          <span className="text-[11px] text-muted">
            Update Definition applies changes immediately and shows a summary instead of the diff modal.
          </span>
        </span>
      </label>
    </div>
  );
}
```

and wire it into the content switch in `SettingsDialog`:

```tsx
          {section === "general" ? (
            <GeneralSection onClose={onClose} />
          ) : section === "workspaces" ? (
```

- [ ] **Step 6: Full verification**

Run: `pnpm test -- --run` and (inside `src-tauri/`) `cargo test`.
Expected: both suites fully PASS.

- [ ] **Step 7: Commit**

```bash
pnpm lint
git add src/components/CollectionTree.tsx src/components/CollectionTree.test.tsx src/components/SettingsDialog.tsx
git commit -m "feat(ui): orphan badge and skip-preview setting"
```

---

## Final verification (after all tasks)

- [ ] `cargo test` (inside `src-tauri/`) — full Rust suite green.
- [ ] `pnpm test -- --run` — full frontend suite green.
- [ ] `pnpm lint`, `cargo fmt --check`, `cargo clippy -- -D warnings` — clean.
- [ ] Manual smoke (`pnpm tauri dev`): import a WSDL → right-click the collection → Update Definition → modal shows "Everything is up to date". Toggle the setting and repeat.
