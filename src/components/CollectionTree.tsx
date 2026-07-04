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
    if (a.type === "newRequest") addRequest(workspaceId, path, "New Request", { kind: "rest", method: "GET", url: "" } as RequestKind);
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

export function CollectionTree({ workspaceId }: { workspaceId: string }) {
  const collections = useCollectionStore((s) => s.collections);
  return (
    <SortableList nodes={collections} parentPath={[]} workspaceId={workspaceId} />
  );
}
