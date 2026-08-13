// src/components/ActivityBar.tsx
import { useState } from "react";
import { Folder, Layers, History, Ellipsis } from "lucide-react";
import { SettingsDialog } from "./SettingsDialog";

interface ActivityBarProps {
  collectionsActive: boolean;
  onToggleCollections: () => void;
}

export function ActivityBar({ collectionsActive, onToggleCollections }: ActivityBarProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <>
      <aside
        className="flex flex-col items-center h-full w-12 shrink-0 py-[10px] gap-[6px] border-r border-border"
        style={{ backgroundColor: "var(--color-sidebar)" }}
      >
        <button
          type="button"
          aria-label="Collections"
          onClick={onToggleCollections}
          className={`flex items-center justify-center w-[34px] h-[34px] rounded-[4px] cursor-pointer
            ${collectionsActive ? "bg-secondary" : "hover:bg-secondary/60"}`}
        >
          <Folder size={18} className={collectionsActive ? "text-foreground" : "text-sidebar-muted"} />
        </button>
        <button
          type="button"
          aria-label="Environments"
          onClick={() => setSettingsOpen(true)}
          className="flex items-center justify-center w-[34px] h-[34px] rounded-[4px] cursor-pointer hover:bg-secondary/60"
        >
          <Layers size={18} className="text-sidebar-muted" />
        </button>
        {/* ponytail: History and More are inert — the design defines no flow for them yet */}
        <button
          type="button"
          aria-label="History"
          className="flex items-center justify-center w-[34px] h-[34px] rounded-[4px] cursor-default"
        >
          <History size={18} className="text-sidebar-muted" />
        </button>
        <div className="w-[22px] h-px bg-border my-[2px]" />
        <button
          type="button"
          aria-label="More"
          className="flex items-center justify-center w-[34px] h-[34px] rounded-[4px] cursor-default"
        >
          <Ellipsis size={18} className="text-sidebar-muted" />
        </button>
      </aside>
      <SettingsDialog
        open={settingsOpen}
        initialSection="environments"
        onClose={() => setSettingsOpen(false)}
      />
    </>
  );
}
