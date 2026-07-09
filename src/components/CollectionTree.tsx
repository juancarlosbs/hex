import { useState, useEffect, useRef, forwardRef, useImperativeHandle } from "react";
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
import { CollectionNode } from "../lib/api";
import { useCollectionStore } from "../store/collectionStore";
import { useRequestStore } from "../store/requestStore";

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

// ── Helper ───────────────────────────────────────────────────────────────────

const arraysEqual = (a: string[], b: string[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

// ── SortableList (one DndContext per level) ───────────────────────────────────

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
  pendingCreation: { parentPath: string[]; kind: "folder" | "request" } | null;
  onPendingCreate: (parentPath: string[], kind: "folder" | "request") => void;
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
          kind={pendingCreation!.kind}
          workspaceId={workspaceId}
          onCreationDone={onCreationDone}
        />
      )}
    </DndContext>
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
    <div className="flex items-center gap-[6px] rounded-[6px] px-2 py-[7px]" style={{ paddingLeft: isRoot ? 8 : 28 }}>
      {isRequest ? (
        <span className="w-10 text-right text-[10px] font-bold font-mono shrink-0 text-method-get">GET</span>
      ) : (
        <Folder size={14} className="text-sidebar-muted shrink-0" />
      )}
      <RenameInput initial={defaultName} onCommit={handleCommit} onCancel={onCreationDone} />
    </div>
  );
}

// ── Folder item ───────────────────────────────────────────────────────────────

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
  pendingCreation: { parentPath: string[]; kind: "folder" | "request" } | null;
  onPendingCreate: (parentPath: string[], kind: "folder" | "request") => void;
  onCreationDone: () => void;
}) {
  const [open, setOpen] = useState(true);
  const [renaming, setRenaming] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const rename = useCollectionStore((s) => s.rename);
  const remove = useCollectionStore((s) => s.remove);
  const closeRequestsUnder = useRequestStore((s) => s.closeRequestsUnder);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: node.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY });
  }

  function handleAction(a: MenuAction) {
    if (a.type === "rename") setRenaming(true);
    if (a.type === "delete") {
      remove(workspaceId, path);
      closeRequestsUnder(path);
    }
    if (a.type === "newFolder") { setOpen(true); onPendingCreate(path, "folder"); }
    if (a.type === "newRequest") { setOpen(true); onPendingCreate(path, "request"); }
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
  const openInStore = useRequestStore((s) => s.openRequest);
  const closeInStore = useRequestStore((s) => s.closeRequest);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: node.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  const isActive = activeRequestId === node.id;

  function handleActivate() {
    setActive(node.id);
    if (node.kind === "rest") {
      openInStore(node.id, node.name, path);
    }
  }

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY });
  }

  function handleAction(a: MenuAction) {
    if (a.type === "rename") setRenaming(true);
    if (a.type === "delete") {
      remove(workspaceId, path);
      closeInStore(node.id);
    }
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
      onClick={handleActivate}
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

export interface CollectionTreeHandle {
  startCreate: () => void;
  startCreateRequest: () => void;
}

export const CollectionTree = forwardRef<CollectionTreeHandle, { workspaceId: string }>(
  function CollectionTree({ workspaceId }, ref) {
    const collections = useCollectionStore((s) => s.collections);
    const [pendingCreation, setPendingCreation] = useState<{
      parentPath: string[];
      kind: "folder" | "request";
    } | null>(null);

    useImperativeHandle(ref, () => ({
      startCreate: () => setPendingCreation({ parentPath: [], kind: "folder" }),
      startCreateRequest: () => {
        const first = collections[0];
        if (first) setPendingCreation({ parentPath: [first.id], kind: "request" });
      },
    }));

    return (
      <SortableList
        nodes={collections}
        parentPath={[]}
        workspaceId={workspaceId}
        pendingCreation={pendingCreation}
        onPendingCreate={(parentPath, kind) => setPendingCreation({ parentPath, kind })}
        onCreationDone={() => setPendingCreation(null)}
      />
    );
  }
);
