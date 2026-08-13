import React, { useState } from "react";
import { Settings } from "lucide-react";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";
import { EnvSelector } from "./EnvSelector";
import { AddWorkspaceModal } from "./AddWorkspaceModal";
import { SettingsDialog } from "./SettingsDialog";
import { useEnvStore } from "../store/envStore";

export function Titlebar() {
  const environments = useEnvStore((s) => s.environments);
  const activeEnvId = useEnvStore((s) => s.activeId);
  const setActiveEnv = useEnvStore((s) => s.setActive);
  const activeEnv = environments.find((e) => e.id === activeEnvId) ?? null;
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

        <div className="flex-1" />

        <div
          className="flex items-center gap-2"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          <EnvSelector
            env={activeEnv}
            envs={environments}
            onSelect={setActiveEnv}
            onManage={() => setSettingsSection("environments")}
          />

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
