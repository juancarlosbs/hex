# Drag Between Folders — Design

**Date:** 2026-07-25
**Status:** Approved

## Goal

Allow dragging requests and folders across folders/collections in the sidebar tree, with exact drop positioning. Today drag-and-drop only reorders siblings within the same level (one `DndContext` per level).

## Approach

Flattened-tree pattern (dnd-kit SortableTree): the tree renders as a single flat list with `depth`, under one `DndContext` + one `SortableContext`. Pointer projection decides the target parent and index.

## Rules

- Requests and folders can be dropped into any folder or collection, at an exact position.
- Root level holds collections only: a request/folder cannot be dropped at root, and a collection cannot be moved into another collection (collections only reorder among themselves).
- A folder cannot be moved into itself or a descendant (enforced in UI by collapsing the dragged folder, and validated in the backend).

## Backend (Rust)

New `move_node` in `src-tauri/src/persistence/collection.rs`:

```
move_node(data_dir, workspace_id, from_path: Vec<String>, to_parent_path: Vec<String>, index: usize)
```

- Validates ids (existing `validate_ids`).
- Rejects moving a node into itself or a descendant (`to_parent_path` starts with `from_path`).
- `fs::rename` of the request file (`<id>.toml`) or folder dir to the destination dir.
- Removes the id from the source parent's `children_order` (`_meta.toml` / root `_meta.toml`), inserts it at `index` in the destination's `children_order` (clamped to len).
- Thin `#[tauri::command] move_node` in `commands/mod.rs`; regenerate `src/bindings.ts` with tauri-specta.

## Frontend

### Stores

- `collectionStore.move(workspaceId, fromPath, toParentPath, index)`: optimistic tree update + rollback on error (same pattern as `reorder`).
- `requestStore.updatePathsUnder(oldPrefix, newPrefix)`: rewrites the path prefix of open tabs so saves target the new location.

### CollectionTree rewrite

- `flattenTree(collections, collapsedIds)` → `FlatItem[]` (`{ id, node, depth, parentPath }`), skipping children of collapsed folders. Pure function.
- Open/collapsed state lifts from per-folder `useState` to a `collapsedIds: Set<string>` in `CollectionTree` (flatten depends on it).
- One `DndContext` + one `SortableContext` over the flat list, `verticalListSortingStrategy`.
- Projection (pure function, SortableTree-style): from the drop index and horizontal pointer offset (`delta.x`, 16px per indent step), compute the projected depth clamped between the min/max valid depths given the items above/below → yields `toParentPath` + `index`. Non-collection items clamp `minDepth` to 1; collections clamp depth to 0.
- While dragging a folder, its subtree is collapsed (hidden) — prevents dropping into itself and matches the SortableTree pattern.
- Drop indicator: insertion line indented at the projected depth.
- `onDragEnd`: same parent → `reorder`; different parent → `move` (then `updatePathsUnder` for the moved subtree).

## Error handling

- Backend errors roll back the optimistic tree update (existing store pattern) and log to console.
- Backend rejects cycles and invalid ids even if the UI regresses.

## Testing

- **Rust** (`collection.rs` tests): move request across folders, move folder with children, reject move-into-descendant, index clamped when out of range, `children_order` correct on both sides.
- **Vitest** (`CollectionTree.test.tsx`): `flattenTree` (collapsed folders skipped, depths/parentPaths correct) and projection (depth clamping, root-level restriction, parent/index resolution). Both pure — no DOM needed.
