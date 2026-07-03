import { useEffect, useState } from "react";
import {
  X, Layers, Globe, Palette, Keyboard, Settings,
  Plus, Pencil, Trash2, Check, ChevronLeft,
} from "lucide-react";
import { cn } from "../lib/utils";
import { useWorkspaceStore, type Workspace } from "../store/workspaceStore";
import { useEnvStore } from "../store/envStore";

const ENV_DOT_COLORS: Record<string, string> = {
  Development: "#28C840",
  Staging:     "#FEBC2E",
  Production:  "#FF5F57",
};

function envDotColor(name: string): string {
  return ENV_DOT_COLORS[name] ?? "#B8B9B6";
}

interface Props {
  open: boolean;
  onClose: () => void;
  initialSection?: Section;
}

const NAV = [
  { id: "general", label: "General", icon: Settings },
  { id: "workspaces", label: "Workspaces", icon: Layers },
  { id: "environments", label: "Environments", icon: Globe },
  { id: "themes", label: "Themes", icon: Palette },
  { id: "shortcuts", label: "Shortcuts", icon: Keyboard },
] as const;

type Section = (typeof NAV)[number]["id"];

function WorkspacesSection({ onClose }: { onClose: () => void }) {
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
        <div className="flex items-center gap-2">
          <button
            className="flex items-center gap-[6px] px-3 py-[6px] rounded-[4px] bg-accent text-accent-foreground text-[12px] font-semibold cursor-pointer hover:bg-accent/90"
            onClick={() => setAddOpen(true)}
          >
            <Plus size={13} />
            New Workspace
          </button>
          <button className="p-1 rounded text-muted hover:text-foreground cursor-pointer" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
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

function EnvironmentsSection({ onClose }: { onClose: () => void }) {
  const { environments, addEnv, removeEnv, updateVariables } = useEnvStore();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<"table" | "json">("table");
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [jsonText, setJsonText] = useState("");
  const [jsonError, setJsonError] = useState(false);

  const selected = environments.find((e) => e.id === selectedId) ?? null;

  function openEnv(id: string) {
    const env = environments.find((e) => e.id === id)!;
    setSelectedId(id);
    setJsonText(JSON.stringify(env.variables, null, 2));
    setJsonError(false);
    setView("table");
  }

  function backToList() {
    setSelectedId(null);
    setAddOpen(false);
  }

  function handleAdd() {
    if (!newName.trim()) return;
    addEnv(newName.trim());
    setNewName("");
    setAddOpen(false);
  }

  function handleVarValueChange(key: string, value: string) {
    if (!selected) return;
    const vars = { ...selected.variables, [key]: value };
    updateVariables(selected.id, vars);
    setJsonText(JSON.stringify(vars, null, 2));
  }

  function handleVarKeyRename(oldKey: string, newKey: string) {
    if (!selected || !newKey.trim() || newKey === oldKey) return;
    const entries = Object.entries(selected.variables).map(([k, v]) =>
      k === oldKey ? [newKey.trim(), v] : [k, v]
    );
    const vars = Object.fromEntries(entries);
    updateVariables(selected.id, vars);
    setJsonText(JSON.stringify(vars, null, 2));
  }

  function handleVarDelete(key: string) {
    if (!selected) return;
    const vars = Object.fromEntries(
      Object.entries(selected.variables).filter(([k]) => k !== key)
    );
    updateVariables(selected.id, vars);
    setJsonText(JSON.stringify(vars, null, 2));
  }

  function handleAddVar() {
    if (!selected) return;
    let key = "NEW_VAR";
    let i = 1;
    while (key in selected.variables) key = `NEW_VAR_${i++}`;
    handleVarValueChange(key, "");
  }

  function handleJsonBlur() {
    if (!selected) return;
    try {
      const parsed = JSON.parse(jsonText);
      if (typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      const vars = Object.fromEntries(
        Object.entries(parsed).map(([k, v]) => [k, String(v)])
      );
      updateVariables(selected.id, vars);
      setJsonError(false);
    } catch {
      setJsonError(true);
    }
  }

  function switchToJson() {
    if (selected) setJsonText(JSON.stringify(selected.variables, null, 2));
    setView("json");
    setJsonError(false);
  }

  // ── Detail mode ──
  if (selected) {
    const entries = Object.entries(selected.variables);
    return (
      <div className="flex flex-col h-full">
        {/* Header: back + dot + name + count + toggle + close */}
        <div className="flex items-center gap-2 px-5 py-[14px] border-b border-border">
          <button
            className="flex items-center gap-1 px-[6px] py-1 rounded-[6px] bg-secondary text-muted hover:text-foreground cursor-pointer"
            onClick={backToList}
          >
            <ChevronLeft size={13} />
            <span className="text-[11px]">Back</span>
          </button>
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: envDotColor(selected.name) }}
          />
          <span className="text-[13px] font-semibold text-foreground">{selected.name}</span>
          <span className="text-[11px] text-muted">
            {entries.length} variable{entries.length !== 1 ? "s" : ""}
          </span>
          <div className="flex-1" />
          {/* Toggle — estilo branch tabs */}
          <div className="flex items-center gap-0">
            {(["table", "json"] as const).map((v) => (
              <button
                key={v}
                className={cn(
                  "px-[10px] py-[7px] text-[12px] font-mono rounded-[6px] cursor-pointer border",
                  view === v
                    ? "bg-background border-border text-foreground font-semibold"
                    : "bg-transparent border-transparent text-muted hover:text-foreground"
                )}
                onClick={() => v === "json" ? switchToJson() : setView("table")}
              >
                {v === "table" ? "Key / Value" : "JSON"}
              </button>
            ))}
          </div>
          <button className="p-1 rounded text-muted hover:text-foreground cursor-pointer" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="flex flex-col flex-1 overflow-y-auto">
          {view === "table" ? (
            <div className="flex flex-col p-5 gap-[6px]">
              <div className="flex gap-2 pb-1">
                <span className="flex-1 text-[10px] font-semibold text-muted uppercase tracking-[0.5px]">Key</span>
                <span className="flex-1 text-[10px] font-semibold text-muted uppercase tracking-[0.5px]">Value</span>
                <span className="w-[13px]" />
              </div>

              {entries.length === 0 && (
                <span className="text-[12px] text-muted py-2">No variables yet.</span>
              )}

              {entries.map(([key, value]) => (
                <div key={key} className="flex items-center gap-2">
                  <input
                    className="flex-1 rounded-[4px] bg-secondary border border-border px-2 py-[6px] text-[12px] font-mono text-foreground outline-none focus:border-ring"
                    defaultValue={key}
                    onBlur={(e) => handleVarKeyRename(key, e.target.value)}
                  />
                  <input
                    className="flex-1 rounded-[4px] bg-secondary border border-border px-2 py-[6px] text-[12px] font-mono text-foreground outline-none focus:border-ring"
                    value={value}
                    onChange={(e) => handleVarValueChange(key, e.target.value)}
                  />
                  <button
                    className="text-muted hover:text-red-400 cursor-pointer shrink-0"
                    onClick={() => handleVarDelete(key)}
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}

              <button
                className="flex items-center gap-[6px] text-[12px] text-muted hover:text-foreground cursor-pointer mt-1 self-start"
                onClick={handleAddVar}
              >
                <Plus size={13} />
                Add Variable
              </button>
            </div>
          ) : (
            <div className="flex flex-col flex-1 p-5">
              <textarea
                className={cn(
                  "flex-1 w-full rounded-[4px] bg-secondary border px-3 py-2 text-[12px] font-mono text-foreground outline-none resize-none focus:border-ring",
                  jsonError ? "border-red-500" : "border-border"
                )}
                value={jsonText}
                onChange={(e) => { setJsonText(e.target.value); setJsonError(false); }}
                onBlur={handleJsonBlur}
                spellCheck={false}
              />
              {jsonError && (
                <span className="text-[11px] text-red-400 mt-1">Invalid JSON — changes not saved.</span>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── List mode ──
  return (
    <div className="flex flex-col gap-4 p-5">
      <div className="flex items-center justify-between">
        <span className="text-[14px] font-semibold text-foreground">Environments</span>
        <div className="flex items-center gap-2">
          <button
            className="flex items-center gap-[6px] px-3 py-[6px] rounded-[4px] border border-border text-[12px] text-muted hover:text-foreground cursor-pointer"
            onClick={() => setAddOpen(true)}
          >
            <Plus size={13} />
            New
          </button>
          <button className="p-1 rounded text-muted hover:text-foreground cursor-pointer" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
      </div>

      {addOpen && (
        <div className="flex items-center gap-2">
          <input
            autoFocus
            className="flex-1 rounded-[4px] bg-background border border-border px-3 py-2 text-[13px] text-foreground placeholder:text-muted outline-none focus:border-ring"
            placeholder="Environment name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAdd();
              if (e.key === "Escape") { setAddOpen(false); setNewName(""); }
            }}
          />
          <button
            className="px-3 py-[6px] text-[12px] font-medium rounded-[4px] border border-border text-foreground cursor-pointer disabled:opacity-40"
            onClick={handleAdd}
            disabled={!newName.trim()}
          >
            Create
          </button>
          <button
            className="text-[12px] text-muted cursor-pointer hover:text-foreground"
            onClick={() => { setAddOpen(false); setNewName(""); }}
          >
            Cancel
          </button>
        </div>
      )}

      <div className="flex flex-col gap-[2px]">
        {environments.map((env) => {
          const varCount = Object.keys(env.variables).length;
          return (
            <div
              key={env.id}
              className="flex items-center gap-3 px-3 py-[10px] rounded-[6px] hover:bg-secondary cursor-pointer group"
              onClick={() => openEnv(env.id)}
            >
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: envDotColor(env.name) }}
              />
              <span className="flex-1 text-[13px] font-medium text-foreground">{env.name}</span>
              <span className="text-[11px] text-muted">
                {varCount} var{varCount !== 1 ? "s" : ""}
              </span>
              <div
                className="flex items-center gap-1 opacity-0 group-hover:opacity-100"
                onClick={(e) => e.stopPropagation()}
              >
                <Trash2
                  size={13}
                  className={cn(
                    "cursor-pointer",
                    environments.length === 1
                      ? "text-muted/30 cursor-not-allowed"
                      : "text-muted hover:text-red-400"
                  )}
                  onClick={() => environments.length > 1 && removeEnv(env.id)}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function SettingsDialog({ open, onClose, initialSection }: Props) {
  const [section, setSection] = useState<Section>(initialSection ?? "workspaces");

  useEffect(() => {
    if (open) setSection(initialSection ?? "workspaces");
  }, [open, initialSection]);

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
          {section === "workspaces" ? (
            <WorkspacesSection onClose={onClose} />
          ) : section === "environments" ? (
            <EnvironmentsSection onClose={onClose} />
          ) : (
            <div className="relative flex items-center justify-center h-full text-muted text-[13px]">
              <button
                className="absolute top-3 right-3 p-1 rounded text-muted hover:text-foreground cursor-pointer"
                onClick={onClose}
              >
                <X size={16} />
              </button>
              {NAV.find((n) => n.id === section)?.label} — coming soon
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
