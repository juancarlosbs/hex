# Collections Feature Design

**Date:** 2026-07-03
**Status:** Approved

## Overview

Collections are the primary organizational unit for requests in Hex. Both REST requests and WSDL-imported SOAP operations live in the same collection tree. The tree supports arbitrary nesting depth (collections → folders → folders → requests) and drag-reorder within siblings.

Storage is git-friendly: each request is a `.toml` file on disk, folders are directories, order is tracked in `_meta.toml` per container.

---

## Disk Layout

```
~/.local/share/hex/workspaces/{workspace_id}/
  collections/
    {collection_id}/
      _meta.toml              # { name, children_order: [id, id, ...] }
      {request_id}.toml       # request at root of collection
      {folder_id}/
        _meta.toml
        {request_id}.toml
        {subfolder_id}/
          _meta.toml
          {request_id}.toml
```

- IDs are UUID v4, generated at creation time.
- `children_order` in `_meta.toml` is the authoritative sort order. Drag-reorder rewrites this list.
- Names are display-only; renaming never touches the ID or path.
- No filesystem path strings cross the IPC boundary — paths are `Vec<String>` of IDs.

### `_meta.toml` format
```toml
name = "My Collection"
children_order = ["uuid-1", "uuid-2", "uuid-3"]
```

### Request `.toml` format
```toml
id = "uuid-1"
name = "Get Users"

[rest]
method = "GET"
url = "https://api.example.com/users"
```

```toml
id = "uuid-2"
name = "GetBalance"

[soap]
wsdl_url = "https://service.example.com/payment?wsdl"
operation = "GetBalance"
```

---

## Rust Layer — `persistence/collection.rs`

### Domain types

```rust
pub enum CollectionNode {
    Folder { id: String, name: String, children: Vec<CollectionNode> },
    Request { id: String, name: String, kind: RequestKind },
}

pub enum RequestKind {
    Rest { method: String, url: String },
    Soap { wsdl_url: String, operation: String },
}
```

Rust walks the tree recursively and returns it pre-sorted per `children_order`. The frontend never sorts.

### Tauri commands

| Command | Signature | What it does |
|---|---|---|
| `list_collections` | `(workspace_id: String)` → `Vec<CollectionNode>` | Reads full tree from disk |
| `create_collection` | `(workspace_id, name)` → `CollectionNode` | mkdir + `_meta.toml` |
| `create_folder` | `(workspace_id, path: Vec<String>, name)` → `CollectionNode` | mkdir + `_meta.toml`, appends id to parent `children_order` |
| `create_request` | `(workspace_id, path: Vec<String>, request: RequestKind)` → `CollectionNode` | Writes `.toml`, appends id to parent `children_order` |
| `rename_node` | `(workspace_id, path: Vec<String>, name)` | Updates name in `_meta.toml` or request `.toml` |
| `delete_node` | `(workspace_id, path: Vec<String>)` | Removes file/dir, removes id from parent `children_order` |
| `reorder_children` | `(workspace_id, parent_path: Vec<String>, ordered_ids: Vec<String>)` | Rewrites `children_order` in parent `_meta.toml` |

All commands use `thiserror` typed errors, mapped to user-facing messages at the command layer.

---

## Frontend Layer

### Store — `src/store/collectionStore.ts`

Zustand slice:
- Hydrates from `list_collections` on workspace activation.
- All mutations are optimistic: update local state immediately, fire Rust command in background, roll back on error.
- Exposes: `tree`, `activeRequestId`, and action functions mirroring the Tauri commands.

### Sidebar

The current static mock in `src/components/Sidebar.tsx` is replaced with a real recursive tree renderer.

- `CollectionNode` component renders either a folder row (with toggle + children) or a request row.
- Expand/collapse state: `useState` per folder, local only (resets on reload — acceptable for MVP).
- Active request highlighted via `activeRequestId` from the store.

### Context Menu

Right-click on any node:
- **Collection / Folder:** New Request, New Folder, Rename, Delete
- **Request:** Rename, Delete

### Drag-Reorder

`@dnd-kit/sortable` (new dependency). Drag is constrained to siblings only — cross-folder move is v2. On drop, calls `reorder_children`.

### Error Handling

Rust command errors surface as toasts via shadcn's toast primitive. Optimistic updates roll back on failure.

---

## WSDL Integration

When a WSDL import succeeds, each operation is auto-saved as a `Soap` request node under a new collection named after the WSDL service. This wires the existing import flow into the collection tree without additional user steps.

---

## Scope

### In scope
- Full CRUD: collections, folders, REST requests, SOAP requests
- Arbitrary nesting depth
- Drag-reorder within siblings
- Sidebar renders the real tree (replaces static mock)
- WSDL import auto-populates a collection

### Deferred (v2)
- Cross-folder drag (move request between folders)
- Search/filter across the tree
- Duplicate request
- Import from Postman/OpenAPI
- Keyboard reorder
