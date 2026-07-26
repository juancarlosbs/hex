import { create } from "zustand";
import { api, type Environment } from "../lib/api";
import { getStore } from "../lib/storage";

export type { Environment };

interface EnvState {
  environments: Environment[];
  activeId: string | null;
  loadErrors: string[];
  workspaceId: string | null;
  load: (workspaceId: string) => Promise<void>;
  setActive: (id: string | null) => void;
  addEnv: (name: string) => Promise<void>;
  removeEnv: (id: string) => Promise<void>;
  updateVariables: (id: string, vars: Record<string, string>) => Promise<void>;
}

const SEED_NAMES = ["Development", "Staging", "Production"];

export const useEnvStore = create<EnvState>((set, get) => ({
  environments: [],
  activeId: null,
  loadErrors: [],
  workspaceId: null,

  async load(workspaceId) {
    let { environments, errors } = await api.listEnvironments(workspaceId);
    if (environments.length === 0 && errors.length === 0) {
      // first run in this workspace: seed the standard three
      for (const name of SEED_NAMES) {
        await api.saveEnvironment(workspaceId, { id: crypto.randomUUID(), name, variables: {} });
      }
      ({ environments, errors } = await api.listEnvironments(workspaceId));
    }
    const store = await getStore();
    const saved = await store.get<string | null>(`activeEnv:${workspaceId}`);
    const activeId = environments.some((e) => e.id === saved) ? (saved as string) : null;
    set({ environments, loadErrors: errors, workspaceId, activeId });
  },

  setActive(id) {
    set({ activeId: id });
    const ws = get().workspaceId;
    if (ws) getStore().then((s) => s.set(`activeEnv:${ws}`, id));
  },

  async addEnv(name) {
    const ws = get().workspaceId;
    if (!ws) return;
    await api.saveEnvironment(ws, { id: crypto.randomUUID(), name, variables: {} });
    await get().load(ws);
  },

  async removeEnv(id) {
    const ws = get().workspaceId;
    // ponytail: never delete the last environment (mirrors workspaceStore)
    if (!ws || get().environments.length <= 1) return;
    await api.deleteEnvironment(ws, id);
    if (get().activeId === id) get().setActive(null);
    await get().load(ws);
  },

  async updateVariables(id, vars) {
    const ws = get().workspaceId;
    const env = get().environments.find((e) => e.id === id);
    if (!ws || !env) return;
    await api.saveEnvironment(ws, { ...env, variables: vars });
    await get().load(ws);
  },
}));
