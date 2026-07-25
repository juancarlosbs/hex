import { useState } from "react";
import { Folder, X } from "lucide-react";
import { cn } from "../lib/utils";
import { CollectionNode } from "../lib/api";
import { useCollectionStore } from "../store/collectionStore";

interface Destination {
  path: string[];
  name: string;
  depth: number;
}

function flattenFolders(nodes: CollectionNode[], base: string[], depth: number, out: Destination[]) {
  for (const n of nodes) {
    if (n.type !== "folder") continue;
    const path = [...base, n.id];
    out.push({ path, name: n.name, depth });
    flattenFolders(n.children, path, depth + 1, out);
  }
}

const samePath = (a: string[], b: string[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

interface Props {
  open: boolean;
  requestName: string;
  currentParentPath: string[];
  onMove: (destination: string[]) => void;
  onClose: () => void;
}

export function MoveRequestModal({ open, requestName, currentParentPath, onMove, onClose }: Props) {
  const collections = useCollectionStore((s) => s.collections);
  const [selected, setSelected] = useState<string[] | null>(null);

  if (!open) return null;

  const destinations: Destination[] = [];
  flattenFolders(collections, [], 0, destinations);

  function handleMove() {
    if (!selected) return;
    onMove(selected);
    setSelected(null);
    onClose();
  }

  return (
    <div
      role="dialog"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 cursor-default"
      onPointerDown={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) onClose();
      }}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
    >
      <div className="w-[440px] rounded-[6px] bg-card border border-border overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4">
          <span className="text-[15px] font-semibold text-foreground">
            Move <span className="font-mono text-[13px]">{requestName}</span>
          </span>
          <X size={16} className="text-muted cursor-pointer hover:text-foreground" onClick={onClose} />
        </div>

        <div className="h-px bg-border" />

        {/* Body: destination tree */}
        <div className="max-h-[280px] overflow-y-auto px-3 py-3 flex flex-col gap-[2px]">
          {destinations.map((d) => {
            const isCurrent = samePath(d.path, currentParentPath);
            const isSelected = selected !== null && samePath(d.path, selected);
            return (
              <button
                key={d.path.join("/")}
                disabled={isCurrent}
                className={cn(
                  "flex items-center gap-[6px] rounded-[6px] px-2 py-[6px] text-[13px] text-left cursor-pointer",
                  isSelected ? "bg-sidebar-accent text-foreground" : "hover:bg-sidebar-accent/50 text-foreground",
                  isCurrent && "opacity-50 cursor-not-allowed"
                )}
                style={{ paddingLeft: 8 + d.depth * 16 }}
                onClick={() => setSelected(d.path)}
              >
                <Folder size={14} className="text-sidebar-muted shrink-0" />
                <span className="truncate">{d.name}</span>
                {isCurrent && <span className="ml-auto text-[11px] text-muted">current</span>}
              </button>
            );
          })}
          {destinations.length === 0 && (
            <span className="px-2 py-[6px] text-[13px] text-muted">No collections yet.</span>
          )}
        </div>

        <div className="h-px bg-border" />

        {/* Footer */}
        <div className="flex items-center justify-end gap-[10px] px-5 py-[14px]">
          <button
            className="px-4 py-[7px] rounded-[4px] text-[13px] font-medium text-foreground bg-secondary border border-border hover:bg-secondary/80 cursor-pointer"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className={cn(
              "px-4 py-[7px] rounded-[4px] text-[13px] font-semibold cursor-pointer",
              selected
                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                : "bg-primary/40 text-primary-foreground/50 cursor-not-allowed"
            )}
            disabled={!selected}
            onClick={handleMove}
          >
            Move
          </button>
        </div>
      </div>
    </div>
  );
}
