import { useState, useEffect, useMemo, useRef, forwardRef, useImperativeHandle } from "react";
import {
  DndContext,
  closestCenter,
  DragEndEvent,
  DragMoveEvent,
  DragOverEvent,
  DragStartEvent,
  MeasuringStrategy,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronDown, Folder, Hexagon } from "lucide-react";
import { cn } from "../lib/utils";
import { useCollectionStore } from "../store/collectionStore";
import { useRequestStore } from "../store/requestStore";
import {
  FlatItem,
  INDENT,
  flattenTree,
  getProjection,
  pendingInsertIndex,
  resolveDrop,
} from "./collectionTreeDnd";

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
  | { type: "duplicate"; path: string[] }
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
    if (a.type === "duplicate") return "Duplicate";
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

// ── Confirm delete modal ──────────────────────────────────────────────────

function ConfirmDeleteModal({
  name,
  onConfirm,
  onCancel,
}: {
  name: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  return (
    <div
      role="dialog"
      aria-modal="true"
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
            ref={cancelRef}
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
  const committed = useRef(false);

  useEffect(() => { ref.current?.select(); }, []);

  return (
    <input
      ref={ref}
      className="flex-1 bg-background border border-border rounded px-1 text-[13px] outline-none"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          if (committed.current) return;
          committed.current = true;
          onCommit(value.trim() || initial);
        }
        if (e.key === "Escape") {
          if (committed.current) return;
          committed.current = true;
          onCancel();
        }
      }}
      onBlur={() => {
        if (committed.current) return;
        committed.current = true;
        onCommit(value.trim() || initial);
      }}
      autoFocus
    />
  );
}

// ── Pending creation row ──────────────────────────────────────────────────────

function PendingCreationRow({
  parentPath,
  kind,
  workspaceId,
  onCreationDone,
}: {
  parentPath: string[];
  kind: "folder" | "request";
  workspaceId: string;
  onCreationDone: () => void;
}) {
  const addCollection = useCollectionStore((s) => s.addCollection);
  const addFolder = useCollectionStore((s) => s.addFolder);
  const addRequest = useCollectionStore((s) => s.addRequest);
  const setActiveRequest = useCollectionStore((s) => s.setActiveRequest);
  const openRequest = useRequestStore((s) => s.openRequest);
  const isRoot = parentPath.length === 0;
  const isRequest = kind === "request";
  const defaultName = isRequest ? "New Request" : isRoot ? "New Collection" : "New Folder";

  async function handleCommit(name: string) {
    if (isRequest) {
      const node = await addRequest(workspaceId, parentPath, name, {
        kind: "rest",
        method: "GET",
        url: "",
      });
      if (node) {
        setActiveRequest(node.id);
        openRequest(node.id, name, [...parentPath, node.id]);
      }
    } else if (isRoot) {
      addCollection(workspaceId, name);
    } else {
      addFolder(workspaceId, parentPath, name);
    }
    onCreationDone();
  }

  return (
    <div
      className="flex items-center gap-[6px] rounded-[6px] px-2 py-[7px]"
      style={{ paddingLeft: 8 + parentPath.length * INDENT }}
    >
      {isRequest ? (
        <span className="w-10 text-right text-[10px] font-bold font-mono shrink-0 text-method-get">GET</span>
      ) : (
        <Folder size={14} className="text-sidebar-muted shrink-0" />
      )}
      <RenameInput initial={defaultName} onCommit={handleCommit} onCancel={onCreationDone} />
    </div>
  );
}

// ── Row (folder or request) ───────────────────────────────────────────────────

function SortableRow({
  item,
  depth,
  isCollapsed,
  onToggle,
  workspaceId,
  onPendingCreate,
}: {
  item: FlatItem;
  depth: number; // projected depth while this row is being dragged
  isCollapsed: boolean;
  onToggle: (id: string) => void;
  workspaceId: string;
  onPendingCreate: (parentPath: string[], kind: "folder" | "request") => void;
}) {
  const { node, parentPath } = item;
  const path = [...parentPath, node.id];
  const [renaming, setRenaming] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const rename = useCollectionStore((s) => s.rename);
  const remove = useCollectionStore((s) => s.remove);
  const duplicate = useCollectionStore((s) => s.duplicate);
  const activeRequestId = useCollectionStore((s) => s.activeRequestId);
  const setActive = useCollectionStore((s) => s.setActiveRequest);
  const openInStore = useRequestStore((s) => s.openRequest);
  const closeInStore = useRequestStore((s) => s.closeRequest);
  const closeRequestsUnder = useRequestStore((s) => s.closeRequestsUnder);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: node.id,
  });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY });
  }

  function handleAction(a: MenuAction) {
    if (a.type === "rename") setRenaming(true);
    if (a.type === "duplicate") duplicate(workspaceId, path);
    if (a.type === "delete") setConfirmingDelete(true);
    if (a.type === "newFolder") onPendingCreate(path, "folder");
    if (a.type === "newRequest") onPendingCreate(path, "request");
  }

  if (node.type === "folder") {
    const menuActions: MenuAction[] = [
      { type: "newRequest", parentPath: path },
      { type: "newFolder", parentPath: path },
      { type: "rename", path, currentName: node.name },
      { type: "duplicate", path },
      { type: "delete", path },
    ];
    return (
      <div ref={setNodeRef} style={style}>
        <div
          className="flex items-center gap-[6px] rounded-[6px] px-2 py-[7px] cursor-pointer hover:bg-sidebar-accent/50 select-none"
          style={{ paddingLeft: 8 + depth * INDENT }}
          onContextMenu={handleContextMenu}
          {...attributes}
          {...listeners}
        >
          <ChevronDown
            size={14}
            className={cn("text-sidebar-muted shrink-0 transition-transform", isCollapsed && "-rotate-90")}
            onClick={(e) => {
              e.stopPropagation();
              onToggle(node.id);
            }}
          />
          <Folder size={14} className="text-sidebar-muted shrink-0" />
          {renaming ? (
            <RenameInput
              initial={node.name}
              onCommit={(v) => {
                rename(workspaceId, path, v);
                setRenaming(false);
              }}
              onCancel={() => setRenaming(false)}
            />
          ) : (
            <span className="text-[13px] font-semibold text-foreground">{node.name}</span>
          )}
        </div>
        {menu && (
          <ContextMenu x={menu.x} y={menu.y} actions={menuActions} onAction={handleAction} onClose={() => setMenu(null)} />
        )}
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
      </div>
    );
  }

  const isActive = activeRequestId === node.id;
  const isSoap = node.kind === "soap";
  const menuActions: MenuAction[] = [
    { type: "rename", path, currentName: node.name },
    { type: "duplicate", path },
    { type: "delete", path },
  ];

  return (
    <div ref={setNodeRef} style={style}>
      <div
        className={cn(
          "flex items-center gap-2 rounded-[6px] px-2 py-[6px] cursor-pointer select-none",
          isActive ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/50"
        )}
        style={{ paddingLeft: 8 + depth * INDENT }}
        onClick={() => {
          setActive(node.id);
          openInStore(node.id, node.name, path);
        }}
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
              METHOD_COLORS[(node as { method: string }).method] ?? "text-sidebar-muted"
            )}
          >
            {(node as { method: string }).method}
          </span>
        )}
        {renaming ? (
          <RenameInput
            initial={node.name}
            onCommit={(v) => {
              rename(workspaceId, path, v);
              setRenaming(false);
            }}
            onCancel={() => setRenaming(false)}
          />
        ) : (
          <span className={cn("text-[12px] font-mono", isActive ? "text-foreground" : "text-sidebar-muted")}>
            {node.name}
          </span>
        )}
      </div>
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} actions={menuActions} onAction={handleAction} onClose={() => setMenu(null)} />
      )}
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
    </div>
  );
}

// ── Root export ───────────────────────────────────────────────────────────────

export interface CollectionTreeHandle {
  startCreate: () => void;
  startCreateRequest: () => void;
}

export const CollectionTree = forwardRef<CollectionTreeHandle, { workspaceId: string }>(
  function CollectionTree({ workspaceId }, ref) {
    const collections = useCollectionStore((s) => s.collections);
    const reorder = useCollectionStore((s) => s.reorder);
    const move = useCollectionStore((s) => s.move);
    const updatePathsUnder = useRequestStore((s) => s.updatePathsUnder);

    const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
    const [pendingCreation, setPendingCreation] = useState<{
      parentPath: string[];
      kind: "folder" | "request";
    } | null>(null);
    const [activeId, setActiveId] = useState<string | null>(null);
    const [overId, setOverId] = useState<string | null>(null);
    const [offsetX, setOffsetX] = useState(0);

    // hide the dragged folder's subtree so it can't be dropped into itself
    const hidden = useMemo(() => {
      if (!activeId) return collapsed;
      const s = new Set(collapsed);
      s.add(activeId);
      return s;
    }, [collapsed, activeId]);

    const flatItems = useMemo(() => flattenTree(collections, hidden), [collections, hidden]);
    const projected =
      activeId && overId ? getProjection(flatItems, activeId, overId, offsetX) : null;

    // distance constraint: without it, any pointerdown (incl. bubbled from context-menu
    // buttons) activates a drag and pointer capture swallows the click
    const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

    useImperativeHandle(ref, () => ({
      startCreate: () => setPendingCreation({ parentPath: [], kind: "folder" }),
      startCreateRequest: () => {
        const first = collections[0];
        if (first) setPendingCreation({ parentPath: [first.id], kind: "request" });
      },
    }));

    function resetDrag() {
      setActiveId(null);
      setOverId(null);
      setOffsetX(0);
    }

    function handleDragStart({ active }: DragStartEvent) {
      setActiveId(String(active.id));
      setOverId(String(active.id));
    }

    function handleDragMove({ delta }: DragMoveEvent) {
      setOffsetX(delta.x);
    }

    function handleDragOver({ over }: DragOverEvent) {
      setOverId(over ? String(over.id) : null);
    }

    function handleDragEnd({ active }: DragEndEvent) {
      const item = flatItems.find((i) => i.id === active.id);
      const proj = projected;
      resetDrag();
      if (!item || !proj) return;
      const resolution = resolveDrop(item, proj, collections);
      if (resolution.kind === "reorder") {
        reorder(workspaceId, resolution.parentPath, resolution.ids);
      } else {
        const { fromPath, toParentPath, index } = resolution;
        move(workspaceId, fromPath, toParentPath, index).then((ok) => {
          if (ok) updatePathsUnder(fromPath, [...toParentPath, item.id]);
        });
      }
    }

    function toggle(id: string) {
      setCollapsed((s) => {
        const n = new Set(s);
        if (n.has(id)) n.delete(id);
        else n.add(id);
        return n;
      });
    }

    function handlePendingCreate(parentPath: string[], kind: "folder" | "request") {
      // expand the target folder so the input row is visible
      const last = parentPath[parentPath.length - 1];
      if (last) {
        setCollapsed((s) => {
          const n = new Set(s);
          n.delete(last);
          return n;
        });
      }
      setPendingCreation({ parentPath, kind });
    }

    const rows = flatItems.map((item) => (
      <SortableRow
        key={item.id}
        item={item}
        depth={item.id === activeId && projected ? projected.depth : item.depth}
        isCollapsed={collapsed.has(item.id)}
        onToggle={toggle}
        workspaceId={workspaceId}
        onPendingCreate={handlePendingCreate}
      />
    ));

    if (pendingCreation) {
      rows.splice(
        pendingInsertIndex(flatItems, pendingCreation.parentPath),
        0,
        <PendingCreationRow
          key="__pending"
          parentPath={pendingCreation.parentPath}
          kind={pendingCreation.kind}
          workspaceId={workspaceId}
          onCreationDone={() => setPendingCreation(null)}
        />
      );
    }

    return (
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
        onDragStart={handleDragStart}
        onDragMove={handleDragMove}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={resetDrag}
      >
        <SortableContext items={flatItems.map((i) => i.id)} strategy={verticalListSortingStrategy}>
          {rows}
        </SortableContext>
      </DndContext>
    );
  }
);
