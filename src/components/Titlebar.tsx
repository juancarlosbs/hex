import React, { useState } from "react";
import { Search, Settings, X } from "lucide-react";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";
import { EnvSelector } from "./EnvSelector";
import { AddWorkspaceModal } from "./AddWorkspaceModal";
import { SettingsDialog } from "./SettingsDialog";
import { useRequestStore } from "../store/requestStore";
import { useCollectionStore } from "../store/collectionStore";

const METHOD_COLORS: Record<string, string> = {
  GET: "text-method-get",
  POST: "text-method-post",
  DELETE: "text-method-delete",
  PUT: "text-method-post",
  PATCH: "text-method-post",
};

function RequestTabs() {
  const order = useRequestStore((s) => s.order);
  const openRequests = useRequestStore((s) => s.openRequests);
  const activeId = useRequestStore((s) => s.activeId);
  const setActive = useRequestStore((s) => s.setActive);
  const closeRequest = useRequestStore((s) => s.closeRequest);
  const setActiveRequest = useCollectionStore((s) => s.setActiveRequest);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  function activate(id: string) {
    setActive(id);
    setActiveRequest(id);
  }

  function requestClose(id: string) {
    if (openRequests[id]?.dirty) setConfirmId(id);
    else doClose(id);
  }

  function doClose(id: string) {
    closeRequest(id);
    setActiveRequest(useRequestStore.getState().activeId);
  }

  return (
    <>
      <div
        className="flex items-center gap-[6px]"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        {order.map((id) => {
          const req = openRequests[id];
          if (!req) return null;
          const active = id === activeId;
          return (
            <div
              key={id}
              onClick={() => activate(id)}
              className={`flex items-center gap-[7px] px-[10px] py-[7px] rounded-[4px] cursor-pointer select-none
                ${active ? "bg-background border border-border" : "bg-transparent border border-transparent"}`}
            >
              <span className={`text-[10px] font-bold ${METHOD_COLORS[req.method] ?? "text-muted"}`}>
                {req.method}
              </span>
              <span className={`text-[12px] ${active ? "text-foreground font-semibold" : "text-muted"}`}>
                {req.name}
              </span>
              {req.dirty && <span className="w-[6px] h-[6px] rounded-full bg-accent shrink-0" />}
              <X
                size={12}
                className={`text-muted ${active ? "opacity-100" : "opacity-50"} hover:opacity-100`}
                onClick={(e) => { e.stopPropagation(); requestClose(id); }}
              />
            </div>
          );
        })}
      </div>
      {confirmId && (
        <DiscardChangesDialog
          onCancel={() => setConfirmId(null)}
          onDiscard={() => { doClose(confirmId); setConfirmId(null); }}
        />
      )}
    </>
  );
}

function DiscardChangesDialog({ onCancel, onDiscard }: { onCancel: () => void; onDiscard: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onPointerDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="w-[360px] rounded-[6px] bg-card border border-border overflow-hidden">
        <div className="px-5 py-4">
          <span className="text-[15px] font-semibold text-foreground">Discard changes?</span>
          <p className="mt-2 text-[13px] text-muted">
            This request has unsaved changes. Closing the tab will discard them.
          </p>
        </div>
        <div className="h-px bg-border" />
        <div className="flex items-center justify-end gap-[10px] px-5 py-[14px]">
          <button
            className="px-4 py-[7px] rounded-[4px] text-[13px] font-medium text-foreground bg-secondary border border-border hover:bg-secondary/80 cursor-pointer"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className="px-4 py-[7px] rounded-[4px] text-[13px] font-semibold cursor-pointer bg-accent text-accent-foreground hover:bg-accent/90"
            onClick={onDiscard}
          >
            Discard
          </button>
        </div>
      </div>
    </div>
  );
}

const ENVS = [
  { name: "Development" },
  { name: "Staging" },
  { name: "Production" },
];

export function Titlebar() {
  const [env, setEnv] = useState<string | null>("Development");
  const [addOpen, setAddOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<"workspaces" | "environments" | undefined>();

  return (
    <>
      <header
        className="flex items-center h-11 px-3 gap-[18px] bg-card border-b border-border"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      >
        <div className="w-17 shrink-0" />

        <WorkspaceSwitcher
          onAddWorkspace={() => setAddOpen(true)}
          onManageWorkspaces={() => setSettingsSection("workspaces")}
        />

        <RequestTabs />

        <div className="flex-1" />

        <div
          className="flex items-center gap-2"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          <EnvSelector env={env} envs={ENVS} onSelect={setEnv} onManage={() => setSettingsSection("environments")} />

          <div className="flex items-center gap-2 px-2 py-[6px] w-[260px] rounded-[4px] bg-secondary border border-border cursor-text">
            <Search size={13} className="text-muted shrink-0" />
            <span className="flex-1 text-[12px] text-muted">Search</span>
            <span className="text-[11px] text-muted">⌘K</span>
          </div>

          <div
            className="p-[6px] rounded-[4px] cursor-pointer hover:bg-secondary"
            onClick={() => setSettingsSection("workspaces")}
          >
            <Settings size={15} className="text-muted" />
          </div>
        </div>
      </header>

      <AddWorkspaceModal open={addOpen} onClose={() => setAddOpen(false)} />
      <SettingsDialog
        open={settingsSection !== undefined}
        initialSection={settingsSection}
        onClose={() => setSettingsSection(undefined)}
      />
    </>
  );
}
