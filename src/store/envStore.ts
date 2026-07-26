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

// Fixed ids (not crypto.randomUUID()) so a double-seed — e.g. React StrictMode
// mounting the loading effect twice — converges to the same 3 files instead of 6:
// save_environment overwrites by id.
const SEEDS = [
  { id: "development", name: "Development" },
  { id: "staging", name: "Staging" },
  { id: "production", name: "Production" },
];

// Bumped on every load() call; a load only commits its result if it is still
// the most recent one when its async work finishes, so a slow load for a
// stale workspace can never clobber a newer one.
let loadToken = 0;

export const useEnvStore = create<EnvState>((set, get) => ({
  environments: [],
  activeId: null,
  loadErrors: [],
  workspaceId: null,

  async load(workspaceId) {
    const token = ++loadToken;
    let { environments, errors } = await api.listEnvironments(workspaceId);
    if (environments.length === 0 && errors.length === 0) {
      // first run in this workspace: seed the standard three
      for (const { id, name } of SEEDS) {
        await api.saveEnvironment(workspaceId, { id, name, variables: {} });
      }
      ({ environments, errors } = await api.listEnvironments(workspaceId));
    }
    const store = await getStore();
    const saved = await store.get<string | null>(`activeEnv:${workspaceId}`);
    const activeId = environments.some((e) => e.id === saved) ? (saved as string) : null;
    if (token !== loadToken) return; // superseded by a newer load
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
