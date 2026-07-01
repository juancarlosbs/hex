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
