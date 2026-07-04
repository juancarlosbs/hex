# Workspace Functional Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make workspaces fully functional — create, rename, delete, switch, and persist across sessions.

**Architecture:** Zustand store (`src/store/workspaceStore.ts`) is the single source of truth for workspace state. Persistence is handled by `tauri-plugin-store` (JSON file on disk, loaded at startup). Components read/write the store directly; no prop-drilling for workspace data.

**Tech Stack:** React 19, Zustand, tauri-plugin-store v2, CVA + tailwind-merge (existing pattern), lucide-react.

---

## Visual Reference (from Pencil design)

- **WorkspaceSwitcher dropdown** — trigger with `Layers` icon, 162px wide in titlebar; dropdown 220px with search, list, and "Manage Workspaces" footer
- **Add Workspace modal** — 440px dialog: "Workspace Name" text input + optional "Description" textarea + Cancel / "Create Workspace" buttons
- **Settings — Workspaces panel** — 780×520 dialog; left sidebar with sections (General, Workspaces, Environments, Themes, Shortcuts); right content shows workspace list with name, description, "Active" badge, edit pencil, trash icon; "+ New Workspace" button top-right

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/store/workspaceStore.ts` | **CREATE** | Zustand store: workspaces list, active ID, CRUD actions |
| `src/lib/storage.ts` | **CREATE** | Thin async wrapper over tauri-plugin-store |
| `src/components/WorkspaceSwitcher.tsx` | **MODIFY** | Remove props; read/write store directly; wire "+" to open modal |
| `src/components/Titlebar.tsx` | **MODIFY** | Remove workspace local state; pass `onManage` to open settings |
| `src/components/AddWorkspaceModal.tsx` | **CREATE** | Modal: name + description form → `addWorkspace()` action |
| `src/components/SettingsDialog.tsx` | **CREATE** | Dialog with sidebar nav; Workspaces section: list with rename/delete; other sections stubbed |
| `src-tauri/Cargo.toml` | **MODIFY** | Add `tauri-plugin-store = "2"` |
| `src-tauri/src/lib.rs` | **MODIFY** | Register `tauri_plugin_store::Builder::new().build()` |
| `package.json` | **MODIFY** | Add `@tauri-apps/plugin-store`, `clsx`, `zustand` |

---

## Task 1: Install frontend dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install packages**

```bash
cd /Users/juancarlos/code/witch
npm install zustand @tauri-apps/plugin-store clsx
```

Expected output: `added N packages` — no errors.

- [ ] **Step 2: Verify**

```bash
grep -E '"zustand"|"clsx"|"plugin-store"' package.json
```

Expected: all three appear in dependencies.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add zustand, clsx, tauri-plugin-store"
```

---

## Task 2: Register tauri-plugin-store in Rust

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add Cargo dependency**

In `src-tauri/Cargo.toml`, add under `[dependencies]`:

```toml
tauri-plugin-store = "2"
```

- [ ] **Step 2: Register plugin in lib.rs**

Replace the full content of `src-tauri/src/lib.rs`:

```rust
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 3: Verify it compiles**

```bash
cd /Users/juancarlos/code/witch
npm run tauri dev -- --no-watch 2>&1 | head -40
```

Expected: Rust compiles without errors (Vite starts, window opens).

- [ ] **Step 4: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/lib.rs
git commit -m "chore: register tauri-plugin-store"
```

---

## Task 3: Workspace types + store

**Files:**
- Create: `src/store/workspaceStore.ts`
- Create: `src/lib/storage.ts`

- [ ] **Step 1: Create storage wrapper** at `src/lib/storage.ts`

```ts
import { load } from "@tauri-apps/plugin-store";

const FILE = "witch.json";

export async function getStore() {
  return load(FILE, { autoSave: true });
}
```

- [ ] **Step 2: Create workspace store** at `src/store/workspaceStore.ts`

```ts
import { create } from "zustand";
import { getStore } from "../lib/storage";

export interface Workspace {
  id: string;
  name: string;
  description: string;
  createdAt: number;
}

interface WorkspaceState {
  workspaces: Workspace[];
  activeId: string;
  addWorkspace: (name: string, description: string) => void;
  removeWorkspace: (id: string) => void;
  renameWorkspace: (id: string, name: string, description: string) => void;
  setActive: (id: string) => void;
}

const DEFAULT: Workspace[] = [
  { id: "default", name: "API Workspace", description: "Main workspace for REST & SOAP APIs", createdAt: Date.now() },
];

async function persist(workspaces: Workspace[], activeId: string) {
  const store = await getStore();
  await store.set("workspaces", workspaces);
  await store.set("activeId", activeId);
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  workspaces: DEFAULT,
  activeId: DEFAULT[0].id,

  addWorkspace(name, description) {
    const ws: Workspace = { id: crypto.randomUUID(), name, description, createdAt: Date.now() };
    set((s) => ({ workspaces: [...s.workspaces, ws] }));
    persist(get().workspaces, get().activeId);
  },

  removeWorkspace(id) {
    const next = get().workspaces.filter((w) => w.id !== id);
    // ponytail: never delete the last workspace
    if (next.length === 0) return;
    const activeId = get().activeId === id ? next[0].id : get().activeId;
    set({ workspaces: next, activeId });
    persist(next, activeId);
  },

  renameWorkspace(id, name, description) {
    const workspaces = get().workspaces.map((w) =>
      w.id === id ? { ...w, name, description } : w
    );
    set({ workspaces });
    persist(workspaces, get().activeId);
  },

  setActive(id) {
    set({ activeId: id });
    persist(get().workspaces, id);
  },
}));

export async function initWorkspaceStore() {
  const store = await getStore();
  const workspaces = await store.get<Workspace[]>("workspaces");
  const activeId = await store.get<string>("activeId");
  if (workspaces && workspaces.length > 0) {
    useWorkspaceStore.setState({
      workspaces,
      activeId: activeId ?? workspaces[0].id,
    });
  }
}
```

- [ ] **Step 3: Call init in main.tsx**

Replace `src/main.tsx`:

```tsx
import "./App.css";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { initWorkspaceStore } from "./store/workspaceStore";

initWorkspaceStore().then(() => {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
});
```

- [ ] **Step 4: Commit**

```bash
git add src/store/workspaceStore.ts src/lib/storage.ts src/main.tsx
git commit -m "feat: workspace zustand store with tauri-plugin-store persistence"
```

---

## Task 4: Refactor WorkspaceSwitcher to use store

**Files:**
- Modify: `src/components/WorkspaceSwitcher.tsx`
- Modify: `src/components/Titlebar.tsx`

- [ ] **Step 1: Rewrite WorkspaceSwitcher to use store**

Replace the full content of `src/components/WorkspaceSwitcher.tsx`:

```tsx
import React, { useEffect, useRef, useState } from "react";
import { ChevronDown, Check, Layers, Plus, Search, Settings2 } from "lucide-react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/utils";
import { useWorkspaceStore } from "../store/workspaceStore";

const triggerVariants = cva(
  "flex items-center justify-between gap-2 w-[162px] rounded-[4px] cursor-pointer shrink-0 border transition-colors select-none px-[10px] py-[6px]",
  {
    variants: {
      state: {
        idle: "bg-secondary border-border hover:bg-secondary/80",
        open: "bg-secondary border-border",
      },
    },
    defaultVariants: { state: "idle" },
  }
);

interface WorkspaceSwitcherProps extends VariantProps<typeof triggerVariants> {
  onAddWorkspace: () => void;
  onManageWorkspaces: () => void;
  className?: string;
}

export function WorkspaceSwitcher({ onAddWorkspace, onManageWorkspaces, className }: WorkspaceSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  const { workspaces, activeId, setActive } = useWorkspaceStore();
  const active = workspaces.find((w) => w.id === activeId) ?? workspaces[0];
  const filtered = workspaces.filter((w) => w.name.toLowerCase().includes(search.toLowerCase()));

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  return (
    <div
      ref={ref}
      className="relative"
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
    >
      <div
        className={cn(triggerVariants({ state: open ? "open" : "idle" }), className)}
        onClick={() => setOpen((v) => !v)}
      >
        <div className="flex items-center gap-2 min-w-0">
          <Layers size={14} className="text-muted shrink-0" />
          <span className="text-[13px] font-medium text-foreground truncate">
            {active?.name ?? "No Workspace"}
          </span>
        </div>
        <ChevronDown
          size={14}
          className={cn("text-muted shrink-0 transition-transform", open && "rotate-180")}
        />
      </div>

      {open && (
        <div className="absolute top-full left-0 mt-1 w-[220px] rounded-md bg-[#1A1A1A] border border-[#2E2E2E] shadow-lg z-50 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-[10px]">
            <span className="text-[11px] font-semibold text-muted uppercase tracking-[0.5px]">
              Workspaces
            </span>
            <Plus
              size={14}
              className="text-muted cursor-pointer hover:text-foreground"
              onClick={(e) => { e.stopPropagation(); setOpen(false); onAddWorkspace(); }}
            />
          </div>

          <div className="px-3 pb-2">
            <div className="flex items-center gap-[6px] bg-[#2E2E2E] border border-[#2E2E2E] rounded-md px-2 py-[6px]">
              <Search size={12} className="text-muted shrink-0" />
              <input
                className="flex-1 bg-transparent text-[12px] text-foreground placeholder:text-muted outline-none"
                placeholder="Search workspaces…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-px px-[6px] pb-[6px]">
            {filtered.map((ws) => {
              const isActive = ws.id === activeId;
              return (
                <div
                  key={ws.id}
                  className={cn(
                    "flex items-center justify-between gap-2 px-2 py-[7px] rounded-md cursor-pointer",
                    isActive ? "bg-[#2a2a30]" : "hover:bg-[#2E2E2E]"
                  )}
                  onClick={() => { setActive(ws.id); setOpen(false); setSearch(""); }}
                >
                  <div className="flex items-center gap-2">
                    <Layers size={14} className={isActive ? "text-foreground" : "text-muted"} />
                    <span className={cn("text-[12px]", isActive ? "text-foreground font-semibold" : "text-muted font-normal")}>
                      {ws.name}
                    </span>
                  </div>
                  {isActive && <Check size={13} className="text-foreground shrink-0" />}
                </div>
              );
            })}
          </div>

          <div
            className="flex items-center gap-[6px] px-3 py-2 border-t border-[#2E2E2E] cursor-pointer hover:bg-[#2E2E2E]"
            onClick={() => { setOpen(false); onManageWorkspaces(); }}
          >
            <Settings2 size={13} className="text-muted" />
            <span className="text-[12px] text-muted">Manage Workspaces</span>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Update Titlebar to remove workspace local state and add modal/settings state**

Replace `src/components/Titlebar.tsx`:

```tsx
import React, { useState } from "react";
import { Search, Settings, X, Hexagon } from "lucide-react";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";
import { EnvSelector } from "./EnvSelector";
import { AddWorkspaceModal } from "./AddWorkspaceModal";
import { SettingsDialog } from "./SettingsDialog";

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
        <span className={`text-[10px] font-bold ${METHOD_COLORS[tab.method] ?? "text-muted"}`}>
          {tab.method}
        </span>
      ) : (
        <Hexagon size={13} className="text-soap-op" />
      )}
      <span className={`text-[12px] ${active ? "text-foreground font-semibold" : "text-muted"}`}>
        {tab.kind === "rest" ? tab.path : tab.operation}
      </span>
      <X
        size={12}
        className={`text-muted ${active ? "opacity-100" : "opacity-50"} hover:opacity-100`}
        onClick={(e) => { e.stopPropagation(); onClose(); }}
      />
    </div>
  );
}

const INITIAL_TABS: Tab[] = [
  { kind: "rest", method: "GET", path: "/users" },
  { kind: "soap", operation: "GetBalance" },
  { kind: "rest", method: "POST", path: "/auth/token", active: true },
];

const ENVS = [
  { name: "Development" },
  { name: "Staging" },
  { name: "Production" },
];

export function Titlebar() {
  const [env, setEnv] = useState<string | null>("Development");
  const [addOpen, setAddOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <>
      <header
        className="flex items-center h-11 px-3 gap-[18px] bg-card border-b border-border"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      >
        <div className="w-17 shrink-0" />

        <WorkspaceSwitcher
          onAddWorkspace={() => setAddOpen(true)}
          onManageWorkspaces={() => setSettingsOpen(true)}
        />

        <div
          className="flex items-center gap-[6px]"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          {INITIAL_TABS.map((tab, i) => (
            <TabItem key={i} tab={tab} onClose={() => {}} />
          ))}
        </div>

        <div className="flex-1" />

        <div
          className="flex items-center gap-2"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          <EnvSelector env={env} envs={ENVS} onSelect={setEnv} />

          <div className="flex items-center gap-2 px-2 py-[6px] w-[260px] rounded-[4px] bg-secondary border border-border cursor-text">
            <Search size={13} className="text-muted shrink-0" />
            <span className="flex-1 text-[12px] text-muted">Search</span>
            <span className="text-[11px] text-muted">⌘K</span>
          </div>

          <div
            className="p-[6px] rounded-[4px] cursor-pointer hover:bg-secondary"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings size={15} className="text-muted" />
          </div>
        </div>
      </header>

      <AddWorkspaceModal open={addOpen} onClose={() => setAddOpen(false)} />
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  );
}
```

- [ ] **Step 3: Commit (TypeScript will error until AddWorkspaceModal and SettingsDialog exist — hold off)**

Hold this commit until Tasks 5 and 6 are done.

---

## Task 5: AddWorkspaceModal

**Files:**
- Create: `src/components/AddWorkspaceModal.tsx`

- [ ] **Step 1: Create the modal** at `src/components/AddWorkspaceModal.tsx`

```tsx
import { useState } from "react";
import { X } from "lucide-react";
import { cn } from "../lib/utils";
import { useWorkspaceStore } from "../store/workspaceStore";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function AddWorkspaceModal({ open, onClose }: Props) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const addWorkspace = useWorkspaceStore((s) => s.addWorkspace);

  if (!open) return null;

  function handleCreate() {
    const trimmed = name.trim();
    if (!trimmed) return;
    addWorkspace(trimmed, description.trim());
    setName("");
    setDescription("");
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-[440px] rounded-[6px] bg-card border border-border overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4">
          <span className="text-[15px] font-semibold text-foreground">New Workspace</span>
          <X size={16} className="text-muted cursor-pointer hover:text-foreground" onClick={onClose} />
        </div>

        <div className="h-px bg-border" />

        {/* Body */}
        <div className="flex flex-col gap-4 px-5 py-5">
          <div className="flex flex-col gap-[6px]">
            <label className="text-[12px] font-semibold text-foreground">Workspace Name</label>
            <input
              autoFocus
              className="w-full rounded-[4px] bg-secondary border border-border px-3 py-2 text-[13px] text-foreground placeholder:text-muted outline-none focus:border-ring"
              placeholder="e.g. API Workspace"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); if (e.key === "Escape") onClose(); }}
            />
          </div>

          <div className="flex flex-col gap-[6px]">
            <label className="text-[12px] font-semibold text-foreground">
              Description <span className="text-muted font-normal">Optional</span>
            </label>
            <textarea
              className="w-full rounded-[4px] bg-secondary border border-border px-3 py-2 text-[13px] text-foreground placeholder:text-muted outline-none resize-none focus:border-ring"
              placeholder="Describe this workspace…"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
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
              name.trim()
                ? "bg-accent text-accent-foreground hover:bg-accent/90"
                : "bg-accent/40 text-accent-foreground/50 cursor-not-allowed"
            )}
            onClick={handleCreate}
            disabled={!name.trim()}
          >
            Create Workspace
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit (still waiting on SettingsDialog)**

Hold — commit after Task 6.

---

## Task 6: SettingsDialog — Workspaces section

**Files:**
- Create: `src/components/SettingsDialog.tsx`

- [ ] **Step 1: Create the settings dialog** at `src/components/SettingsDialog.tsx`

```tsx
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
```

- [ ] **Step 2: Now commit Tasks 4, 5, 6 together**

```bash
git add src/components/WorkspaceSwitcher.tsx src/components/Titlebar.tsx src/components/AddWorkspaceModal.tsx src/components/SettingsDialog.tsx
git commit -m "feat: workspace functional — switcher, add modal, settings dialog"
```

---

## Task 7: Verify end-to-end

- [ ] **Step 1: Start dev server**

```bash
npm run tauri dev
```

- [ ] **Step 2: Test workspace switcher**

1. Click the WorkspaceSwitcher in the titlebar
2. Verify dropdown shows 3 workspaces (API Workspace active with ✓)
3. Click "Mobile Backend" — verify title updates, dropdown closes

- [ ] **Step 3: Test add workspace**

1. Click "+" in the dropdown header → "New Workspace" modal appears
2. Type "Test WS" in name field, press Enter → modal closes, workspace appears in list
3. Verify switching to the new workspace works

- [ ] **Step 4: Test persistence**

1. Create a new workspace
2. Close and reopen the app (`npm run tauri dev`)
3. Verify the workspace still exists in the list

- [ ] **Step 5: Test settings dialog**

1. Click the gear icon (⚙) in the titlebar → Settings dialog opens at Workspaces section
2. Click "Manage Workspaces" in dropdown → same dialog opens
3. Edit a workspace name inline (pencil icon) → confirm with Enter
4. Delete a non-active workspace (trash icon) → it disappears
5. Verify you cannot delete the last workspace (trash is dimmed)

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "feat: workspace persistence verified"
```

---

## Self-Review

**Spec coverage:**
- ✅ Create workspace (modal + settings inline form)
- ✅ Switch workspace (switcher dropdown → store)
- ✅ Rename workspace (settings dialog inline edit)
- ✅ Delete workspace (settings dialog, guarded against last-workspace)
- ✅ Persist across sessions (tauri-plugin-store)
- ✅ Search workspaces (switcher search input)
- ✅ "Manage Workspaces" footer → opens settings
- ✅ Settings dialog shell with stubbed sections

**Ponytail notes:**
- `ponytail:` Env selector stays local state in Titlebar — add to store when env-per-workspace is needed
- `ponytail:` Settings sections (General, Environments, Themes, Shortcuts) render "coming soon" — implement when feature is built
- `ponytail:` No optimistic rollback on persist failure — add if users report data loss
