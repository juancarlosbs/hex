import { useState } from "react";
import { X, Layers, Globe, Palette, Keyboard, Settings, Plus, Pencil, Trash2, Check } from "lucide-react";
import { cn } from "../lib/utils";
import { useWorkspaceStore, type Workspace } from "../store/workspaceStore";

interface Props {
  open: boolean;
  onClose: () => void;
}

const NAV = [
  { id: "general", label: "General", icon: Settings },
  { id: "workspaces", label: "Workspaces", icon: Layers },
  { id: "environments", label: "Environments", icon: Globe },
  { id: "themes", label: "Themes", icon: Palette },
  { id: "shortcuts", label: "Shortcuts", icon: Keyboard },
] as const;

type Section = (typeof NAV)[number]["id"];

function WorkspacesSection() {
  const { workspaces, activeId, addWorkspace, removeWorkspace, renameWorkspace, setActive } =
    useWorkspaceStore();
  const [addOpen, setAddOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");

  function startEdit(ws: Workspace) {
    setEditId(ws.id);
    setEditName(ws.name);
    setEditDesc(ws.description);
  }

  function commitEdit() {
    if (editId && editName.trim()) {
      renameWorkspace(editId, editName.trim(), editDesc.trim());
    }
    setEditId(null);
  }

  function handleAdd() {
    if (!newName.trim()) return;
    addWorkspace(newName.trim(), newDesc.trim());
    setNewName("");
    setNewDesc("");
    setAddOpen(false);
  }

  return (
    <div className="flex flex-col gap-4 p-5">
      <div className="flex items-center justify-between">
        <span className="text-[16px] font-semibold text-foreground">Workspaces</span>
        <button
          className="flex items-center gap-[6px] px-3 py-[6px] rounded-[4px] bg-accent text-accent-foreground text-[12px] font-semibold cursor-pointer hover:bg-accent/90"
          onClick={() => setAddOpen(true)}
        >
          <Plus size={13} />
          New Workspace
        </button>
      </div>

      {/* Inline add form */}
      {addOpen && (
        <div className="flex flex-col gap-3 p-3 rounded-[6px] bg-secondary border border-border">
          <input
            autoFocus
            className="w-full rounded-[4px] bg-background border border-border px-3 py-2 text-[13px] text-foreground placeholder:text-muted outline-none focus:border-ring"
            placeholder="Workspace name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); if (e.key === "Escape") setAddOpen(false); }}
          />
          <input
            className="w-full rounded-[4px] bg-background border border-border px-3 py-2 text-[13px] text-foreground placeholder:text-muted outline-none focus:border-ring"
            placeholder="Description (optional)"
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); if (e.key === "Escape") setAddOpen(false); }}
          />
          <div className="flex gap-2">
            <button
              className="px-3 py-[5px] text-[12px] font-semibold rounded-[4px] bg-accent text-accent-foreground cursor-pointer hover:bg-accent/90 disabled:opacity-40"
              onClick={handleAdd}
              disabled={!newName.trim()}
            >
              Create
            </button>
            <button
              className="px-3 py-[5px] text-[12px] text-muted cursor-pointer hover:text-foreground"
              onClick={() => setAddOpen(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Workspace list */}
      <div className="flex flex-col gap-[2px]">
        {workspaces.map((ws) => {
          const isActive = ws.id === activeId;
          const isEditing = ws.id === editId;

          return (
            <div
              key={ws.id}
              className={cn(
                "flex items-center gap-3 px-3 py-[10px] rounded-[6px]",
                isActive ? "bg-[#1e1e2a]" : "hover:bg-secondary"
              )}
            >
              <Layers size={16} className={isActive ? "text-foreground" : "text-muted"} />

              <div className="flex-1 min-w-0">
                {isEditing ? (
                  <div className="flex flex-col gap-1">
                    <input
                      autoFocus
                      className="w-full rounded-[4px] bg-background border border-border px-2 py-1 text-[13px] text-foreground outline-none focus:border-ring"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") setEditId(null); }}
                    />
                    <input
                      className="w-full rounded-[4px] bg-background border border-border px-2 py-1 text-[12px] text-muted outline-none focus:border-ring"
                      value={editDesc}
                      placeholder="Description (optional)"
                      onChange={(e) => setEditDesc(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") setEditId(null); }}
                    />
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-2">
                      <span className={cn("text-[13px] font-medium", isActive ? "text-foreground" : "text-muted")}>
                        {ws.name}
                      </span>
                      {isActive && (
                        <span className="text-[10px] font-semibold px-[6px] py-[2px] rounded-full bg-green-500/20 text-green-400">
                          Active
                        </span>
                      )}
                    </div>
                    {ws.description && (
                      <p className="text-[11px] text-muted truncate mt-[1px]">{ws.description}</p>
                    )}
                  </>
                )}
              </div>

              <div className="flex items-center gap-1 shrink-0">
                {isEditing ? (
                  <Check
                    size={14}
                    className="text-muted cursor-pointer hover:text-foreground"
                    onClick={commitEdit}
                  />
                ) : (
                  <>
                    {!isActive && (
                      <button
                        className="px-2 py-[3px] text-[11px] text-muted hover:text-foreground cursor-pointer"
                        onClick={() => setActive(ws.id)}
                      >
                        Switch
                      </button>
                    )}
                    <Pencil
                      size={13}
                      className="text-muted cursor-pointer hover:text-foreground"
                      onClick={() => startEdit(ws)}
                    />
                    <Trash2
                      size={13}
                      className={cn(
                        "cursor-pointer",
                        workspaces.length === 1
                          ? "text-muted/30 cursor-not-allowed"
                          : "text-muted hover:text-red-400"
                      )}
                      onClick={() => workspaces.length > 1 && removeWorkspace(ws.id)}
                    />
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function SettingsDialog({ open, onClose }: Props) {
  const [section, setSection] = useState<Section>("workspaces");

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-[780px] h-[520px] rounded-[6px] bg-card border border-border overflow-hidden flex">
        {/* Sidebar */}
        <div
          className="w-[200px] shrink-0 flex flex-col gap-[2px] p-3 border-r border-border"
          style={{ backgroundColor: "#141414" }}
        >
          <span className="text-[10px] font-semibold text-muted uppercase tracking-[0.5px] px-2 py-1">
            Settings
          </span>
          {NAV.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={cn(
                "flex items-center gap-[8px] px-2 py-[7px] rounded-[4px] text-[13px] cursor-pointer text-left",
                section === id
                  ? "bg-secondary text-foreground font-medium"
                  : "text-muted hover:bg-secondary/50 hover:text-foreground"
              )}
              onClick={() => setSection(id)}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto relative">
          <button
            className="absolute top-3 right-3 p-1 rounded text-muted hover:text-foreground cursor-pointer"
            onClick={onClose}
          >
            <X size={16} />
          </button>

          {section === "workspaces" ? (
            <WorkspacesSection />
          ) : (
            <div className="flex items-center justify-center h-full text-muted text-[13px]">
              {NAV.find((n) => n.id === section)?.label} — coming soon
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
