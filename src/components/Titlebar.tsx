import React, { useState } from "react";
import { Search, Settings, X, Hexagon } from "lucide-react";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";
import { EnvSelector } from "./EnvSelector";

const METHOD_COLORS: Record<string, string> = {
  GET: "text-method-get",
  POST: "text-method-post",
  DELETE: "text-method-delete",
  PUT: "text-method-post",
  PATCH: "text-method-post",
};

type RestTab = { kind: "rest"; method: string; path: string; active?: boolean };
type SoapTab = { kind: "soap"; operation: string; active?: boolean };
type Tab = RestTab | SoapTab;

function TabItem({ tab, onClose }: { tab: Tab; onClose: () => void }) {
  const active = tab.active;
  return (
    <div
      className={`flex items-center gap-[7px] px-[10px] py-[7px] rounded-[4px] cursor-pointer select-none
        ${active ? "bg-background border border-border" : "bg-transparent border border-transparent"}`}
    >
      {tab.kind === "rest" ? (
        <span
          className={`text-[10px] font-bold ${METHOD_COLORS[tab.method] ?? "text-muted"}`}
        >
          {tab.method}
        </span>
      ) : (
        <Hexagon size={13} className="text-soap-op" />
      )}
      <span
        className={`text-[12px] ${active ? "text-foreground font-semibold" : "text-muted"}`}
      >
        {tab.kind === "rest" ? tab.path : tab.operation}
      </span>
      <X
        size={12}
        className={`text-muted ${active ? "opacity-100" : "opacity-50"} hover:opacity-100`}
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      />
    </div>
  );
}

const INITIAL_TABS: Tab[] = [
  { kind: "rest", method: "GET", path: "/users" },
  { kind: "soap", operation: "GetBalance" },
  { kind: "rest", method: "POST", path: "/auth/token", active: true },
];

const WORKSPACES = ["API Workspace", "Mobile Backend", "Internal Tools"];
const ENVS = [
  { name: "Development" },
  { name: "Staging" },
  { name: "Production" },
];

export function Titlebar() {
  const [workspace, setWorkspace] = useState("API Workspace");
  const [env, setEnv] = useState<string | null>("Development");

  return (
    <header
      className="flex items-center h-11 px-3 gap-[18px] bg-card border-b border-border"
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      {/* Space for macOS native traffic lights (titleBarStyle: overlay) */}
      <div className="w-17 shrink-0" />

      {/* Workspace Switcher */}
      <WorkspaceSwitcher
        workspaceName={workspace}
        workspaces={WORKSPACES}
        onSelect={setWorkspace}
      />

      {/* Tabs */}
      <div
        className="flex items-center gap-[6px]"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        {INITIAL_TABS.map((tab, i) => (
          <TabItem key={i} tab={tab} onClose={() => {}} />
        ))}
      </div>

      {/* Drag Region */}
      <div className="flex-1" />

      {/* Actions */}
      <div
        className="flex items-center gap-2"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        {/* Env Selector */}
        <EnvSelector env={env} envs={ENVS} onSelect={(e) => setEnv(e)} />

        {/* Command Palette */}
        <div className="flex items-center gap-2 px-2 py-[6px] w-[260px] rounded-[4px] bg-secondary border border-border cursor-text">
          <Search size={13} className="text-muted shrink-0" />
          <span className="flex-1 text-[12px] text-muted">Search</span>
          <span className="text-[11px] text-muted">⌘K</span>
        </div>

        {/* Settings */}
        <div className="p-[6px] rounded-[4px] cursor-pointer hover:bg-secondary">
          <Settings size={15} className="text-muted" />
        </div>
      </div>
    </header>
  );
}
