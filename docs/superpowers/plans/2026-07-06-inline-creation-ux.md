# Inline Creation UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the user clicks "New Collection" (FolderPlus icon) or "New Folder" (context menu), show an inline input pre-filled and pre-selected instead of immediately creating with a hardcoded name — Enter confirms, Escape cancels with no creation.

**Architecture:** Add `pendingCreation: { parentPath: string[] } | null` state to `CollectionTree`. Make `CollectionTree` a `forwardRef` exposing `startCreate()` so `Sidebar` can trigger root-level creation. Thread `pendingCreation`/`onPendingCreate`/`onCreationDone` props down through `SortableList` and `SortableFolderItem`. Render a `PendingCreationRow` (using the existing `RenameInput`) appended after sorted items at the matching level. Change the `newFolder` handler in `SortableFolderItem` to call `onPendingCreate(path)` instead of directly calling `addFolder`.

**Tech Stack:** React 19, TypeScript, Zustand (`useCollectionStore`), existing `RenameInput` component, `forwardRef` + `useImperativeHandle`.

---

## Files

- Modify: `src/components/CollectionTree.tsx` — all logic changes
- Modify: `src/components/Sidebar.tsx` — use `treeRef`, remove direct `addCollection` call

---

### Task 1: Add `forwardRef` + `pendingCreation` state to `CollectionTree`

**Files:**
- Modify: `src/components/CollectionTree.tsx:1,342-347`

- [ ] **Step 1: Update imports at the top of the file**

Replace line 1:
```tsx
import { useState, useEffect, useRef } from "react";
```
With:
```tsx
import { useState, useEffect, useRef, forwardRef, useImperativeHandle } from "react";
```

- [ ] **Step 2: Replace the `CollectionTree` export at the bottom of the file**

Replace:
```tsx
export function CollectionTree({ workspaceId }: { workspaceId: string }) {
  const collections = useCollectionStore((s) => s.collections);
  return (
    <SortableList nodes={collections} parentPath={[]} workspaceId={workspaceId} />
  );
}
```
With:
```tsx
export interface CollectionTreeHandle {
  startCreate: () => void;
}

export const CollectionTree = forwardRef<CollectionTreeHandle, { workspaceId: string }>(
  function CollectionTree({ workspaceId }, ref) {
    const collections = useCollectionStore((s) => s.collections);
    const [pendingCreation, setPendingCreation] = useState<{ parentPath: string[] } | null>(null);

    useImperativeHandle(ref, () => ({
      startCreate: () => setPendingCreation({ parentPath: [] }),
    }));

    return (
      <SortableList
        nodes={collections}
        parentPath={[]}
        workspaceId={workspaceId}
        pendingCreation={pendingCreation}
        onPendingCreate={(parentPath) => setPendingCreation({ parentPath })}
        onCreationDone={() => setPendingCreation(null)}
      />
    );
  }
);
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `pnpm build 2>&1 | head -40`

Expected: compilation errors about `SortableList` missing new props (those will be fixed in Task 2). The `CollectionTree` itself should have no new errors beyond the prop mismatch.

- [ ] **Step 4: Commit**

```bash
git add src/components/CollectionTree.tsx
git commit -m "feat(collections): add forwardRef + pendingCreation state to CollectionTree"
```

---

### Task 2: Add props to `SortableList` and render `PendingCreationRow`

**Files:**
- Modify: `src/components/CollectionTree.tsx:119-165`

- [ ] **Step 1: Add `arraysEqual` helper before `SortableList`**

Insert before the `// ── SortableList` comment (around line 119):
```tsx
const arraysEqual = (a: string[], b: string[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);
```

- [ ] **Step 2: Update `SortableList` signature and body**

Replace:
```tsx
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
```
With:
```tsx
function SortableList({
  nodes,
  parentPath,
  workspaceId,
  pendingCreation,
  onPendingCreate,
  onCreationDone,
}: {
  nodes: CollectionNode[];
  parentPath: string[];
  workspaceId: string;
  pendingCreation: { parentPath: string[] } | null;
  onPendingCreate: (parentPath: string[]) => void;
  onCreationDone: () => void;
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

  const showPending = pendingCreation !== null && arraysEqual(pendingCreation.parentPath, parentPath);

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
              pendingCreation={pendingCreation}
              onPendingCreate={onPendingCreate}
              onCreationDone={onCreationDone}
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
      {showPending && (
        <PendingCreationRow
          parentPath={parentPath}
          workspaceId={workspaceId}
          onCreationDone={onCreationDone}
        />
      )}
    </DndContext>
  );
}
```

- [ ] **Step 3: Add `PendingCreationRow` component**

Insert between the `SortableList` function and the `// ── Folder item` comment:

```tsx
// ── Pending creation row ──────────────────────────────────────────────────────

function PendingCreationRow({
  parentPath,
  workspaceId,
  onCreationDone,
}: {
  parentPath: string[];
  workspaceId: string;
  onCreationDone: () => void;
}) {
  const addCollection = useCollectionStore((s) => s.addCollection);
  const addFolder = useCollectionStore((s) => s.addFolder);
  const isRoot = parentPath.length === 0;
  const defaultName = isRoot ? "New Collection" : "New Folder";

  function handleCommit(name: string) {
    if (isRoot) addCollection(workspaceId, name);
    else addFolder(workspaceId, parentPath, name);
    onCreationDone();
  }

  return (
    <div className="flex items-center gap-[6px] rounded-[6px] px-2 py-[7px]" style={{ paddingLeft: isRoot ? 8 : 28 }}>
      <Folder size={14} className="text-sidebar-muted shrink-0" />
      <RenameInput
        initial={defaultName}
        onCommit={handleCommit}
        onCancel={onCreationDone}
      />
    </div>
  );
}
```

- [ ] **Step 4: Verify TypeScript compiles (expect errors about `SortableFolderItem` missing new props)**

Run: `pnpm build 2>&1 | head -40`

- [ ] **Step 5: Commit**

```bash
git add src/components/CollectionTree.tsx
git commit -m "feat(collections): add SortableList pending creation props and PendingCreationRow"
```

---

### Task 3: Thread props through `SortableFolderItem` and fix `newFolder` handler

**Files:**
- Modify: `src/components/CollectionTree.tsx:169-248`

- [ ] **Step 1: Update `SortableFolderItem` signature**

Replace:
```tsx
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
```
With:
```tsx
function SortableFolderItem({
  node,
  path,
  workspaceId,
  pendingCreation,
  onPendingCreate,
  onCreationDone,
}: {
  node: Extract<CollectionNode, { type: "folder" }>;
  path: string[];
  workspaceId: string;
  pendingCreation: { parentPath: string[] } | null;
  onPendingCreate: (parentPath: string[]) => void;
  onCreationDone: () => void;
}) {
  const [open, setOpen] = useState(true);
  const [renaming, setRenaming] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const rename = useCollectionStore((s) => s.rename);
  const remove = useCollectionStore((s) => s.remove);
  const addRequest = useCollectionStore((s) => s.addRequest);
```

- [ ] **Step 2: Update `handleAction` to use `onPendingCreate` for `newFolder`**

Replace:
```tsx
  function handleAction(a: MenuAction) {
    if (a.type === "rename") setRenaming(true);
    if (a.type === "delete") remove(workspaceId, path);
    if (a.type === "newFolder") addFolder(workspaceId, path, "New Folder");
    if (a.type === "newRequest") addRequest(workspaceId, path, "New Request", { kind: "rest", method: "GET", url: "" } as RequestKind);
  }
```
With:
```tsx
  function handleAction(a: MenuAction) {
    if (a.type === "rename") setRenaming(true);
    if (a.type === "delete") remove(workspaceId, path);
    if (a.type === "newFolder") { setOpen(true); onPendingCreate(path); }
    if (a.type === "newRequest") addRequest(workspaceId, path, "New Request", { kind: "rest", method: "GET", url: "" } as RequestKind);
  }
```

Note: `setOpen(true)` ensures the folder is expanded so the inline input is visible.

- [ ] **Step 3: Pass new props to the nested `SortableList` inside `SortableFolderItem`**

Replace:
```tsx
      {open && node.children.length > 0 && (
        <div style={{ paddingLeft: 16 }}>
          <SortableList nodes={node.children} parentPath={path} workspaceId={workspaceId} />
        </div>
      )}
```
With:
```tsx
      {open && (node.children.length > 0 || (pendingCreation !== null && arraysEqual(pendingCreation.parentPath, path))) && (
        <div style={{ paddingLeft: 16 }}>
          <SortableList
            nodes={node.children}
            parentPath={path}
            workspaceId={workspaceId}
            pendingCreation={pendingCreation}
            onPendingCreate={onPendingCreate}
            onCreationDone={onCreationDone}
          />
        </div>
      )}
```

This ensures the children area renders (and thus `PendingCreationRow` shows) even when the folder is empty.

- [ ] **Step 4: Verify TypeScript compiles clean**

Run: `pnpm build 2>&1 | head -40`

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/CollectionTree.tsx
git commit -m "feat(collections): thread pending creation props through SortableFolderItem"
```

---

### Task 4: Update `Sidebar` to use `treeRef`

**Files:**
- Modify: `src/components/Sidebar.tsx`

- [ ] **Step 1: Update `Sidebar.tsx` to the following**

Full file content:
```tsx
import { useRef } from "react";
import { FolderPlus, Plus, RefreshCw, Search } from "lucide-react";
import { CollectionTree, CollectionTreeHandle } from "./CollectionTree";
import { useWorkspaceStore } from "../store/workspaceStore";

export function Sidebar() {
  const workspaceId = useWorkspaceStore((s) => s.activeId);
  const treeRef = useRef<CollectionTreeHandle>(null);

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
            onClick={() => treeRef.current?.startCreate()}
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
        <CollectionTree ref={treeRef} workspaceId={workspaceId} />
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

- [ ] **Step 2: Verify TypeScript compiles clean**

Run: `pnpm build 2>&1 | head -40`

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/Sidebar.tsx
git commit -m "feat(collections): wire Sidebar FolderPlus to CollectionTree.startCreate via ref"
```

---

### Task 5: Manual verification

- [ ] **Step 1: Start dev server**

Run: `pnpm tauri dev`

- [ ] **Step 2: Verify FolderPlus (root-level creation)**

1. Click the FolderPlus icon in the sidebar header.
2. An inline input appears at the bottom of the tree, pre-filled with "New Collection" and text selected.
3. Type a name → press Enter → collection is created with the typed name.
4. Click FolderPlus again → press Enter without typing → collection is created as "New Collection".
5. Click FolderPlus again → press Escape → nothing is created.

- [ ] **Step 3: Verify context menu "New Folder" (nested creation)**

1. Right-click any collection/folder → click "New Folder".
2. The folder expands (if collapsed) and an inline input appears inside it, pre-filled with "New Folder".
3. Type a name → Enter → folder is created inside the parent with that name.
4. Right-click again → "New Folder" → Escape → nothing created.

- [ ] **Step 4: Verify blur commits**

1. Click FolderPlus → inline input appears.
2. Type a name → click elsewhere (outside the input) → item is created (blur commits).
