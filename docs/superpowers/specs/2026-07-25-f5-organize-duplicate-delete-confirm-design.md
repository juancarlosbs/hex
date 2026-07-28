# F5 — Organize: Duplicate + Delete Confirmation — Design

Date: 2026-07-25
Slice: F5 — Organize (docs/product.md §5)

## Context

Most of F5 already exists: drag-reorder within a level (dnd-kit, one
`DndContext` per level), inline rename, delete, and the persistence commands
(`rename_node`, `delete_node`, `reorder_children`). This slice fills the two
remaining gaps:

1. **Duplicate** — no menu item, no store action, no Rust command.
2. **Delete confirmation** — delete is currently immediate.

**Out of scope (decided):** cross-folder drag-move. Today's drag only reorders
within one level; moving between folders requires restructuring the
`DndContext` nesting and is a separate slice.

## Decisions

- Duplicate covers **requests and folders/collections** (recursive).
- Copy is named `"<name> copy"` (top level only; children keep their names)
  and is inserted **immediately after the original** in the parent's order.
- Delete confirmation is a **small modal**: *"Delete '<name>'? This action
  cannot be undone."* with Cancel / Delete (destructive), for every node type.

## 1. Rust — `persistence/collection.rs`

New function:

```rust
pub fn duplicate_node(
    data_dir: &Path,
    workspace_id: &str,
    path: Vec<String>,
) -> anyhow::Result<CollectionNode>
```

- **Request** (`{id}.toml`): read the `RequestFile`, assign `new_id()`, set
  `name` to `"<name> copy"`, write `{new_id}.toml` in the same parent
  directory.
- **Folder/collection** (directory): recursive copy — every child directory
  and request file gets a fresh id; each copied folder's `meta.toml`
  `children_order` is remapped old-id → new-id. Only the top-level copy gets
  the `" copy"` suffix.
- Insert the new top-level id into the parent's `children_order`
  (`RootMeta` when duplicating a collection, `FolderMeta` otherwise) right
  after the original id.
- Return the newly created `CollectionNode` subtree.

Rejected alternative: orchestrating the copy from the frontend with N
`create_*` calls — multiple IPC round-trips, no atomicity, and it leaks the
file layout to the frontend.

## 2. Command + bindings

Thin `duplicate_node` command in `commands/mod.rs` (validate + delegate,
matching the existing `rename_node`/`delete_node` commands). Regenerate
`src/bindings.ts` with tauri-specta.

## 3. Store — `src/store/collectionStore.ts`

New action `duplicate(workspaceId, path)`: call the binding, insert the
returned node into the in-memory tree right after the original (no re-fetch).

## 4. UI — `src/components/CollectionTree.tsx`

- Add **Duplicate** to the context menu of both request and folder/collection
  items, between Rename and Delete.
- Delete no longer executes immediately: it opens the confirmation modal.
  On confirm, keep the current behavior (`remove` + close affected open
  request tabs). On cancel, nothing happens.
- The modal is a small local component in `CollectionTree.tsx`, styled with
  existing tokens (destructive button), state held per item.

## 5. Error handling

Persistence errors surface the same way as the existing mutations
(command returns `Result`; store logs/ignores per current pattern). No new
error UI in this slice.

## 6. Testing

- **Rust** (`collection.rs` tests): duplicate a request (same content, new
  id, name suffixed, ordered after original); duplicate a folder with nested
  children (all ids fresh, structure and names preserved, orders remapped);
  duplicated collection appears after original in root order.
- **Vitest** (`CollectionTree.test.tsx`): context menu shows Duplicate for
  request and folder; clicking Duplicate calls the store action; Delete opens
  the confirmation modal; confirming deletes; cancelling does not.
