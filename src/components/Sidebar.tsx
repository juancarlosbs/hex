import { FolderPlus, Plus, RefreshCw, Search } from "lucide-react";
import { CollectionTree } from "./CollectionTree";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useCollectionStore } from "../store/collectionStore";

export function Sidebar() {
  const workspaceId = useWorkspaceStore((s) => s.activeId);
  const addCollection = useCollectionStore((s) => s.addCollection);

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
            onClick={() => addCollection(workspaceId, "New Collection")}
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
        <CollectionTree workspaceId={workspaceId} />
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
