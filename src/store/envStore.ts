import { create } from "zustand";
import { getStore } from "../lib/storage";
import { api, type Environment } from "../lib/api";
import { useWorkspaceStore } from "./workspaceStore";

export type { Environment };

interface EnvState {
  environments: Environment[];
  activeId: string | null;
  /** Loads the workspace's environments from disk, seeding the defaults once. */
  load: (workspaceId: string) => Promise<void>;
  setActive: (id: string | null) => void;
  addEnv: (name: string) => void;
  removeEnv: (id: string) => void;
  updateVariables: (id: string, vars: Record<string, string>) => void;
}

const defaultEnvs = (): Environment[] => [
  { id: "development", name: "Development", variables: {} },
  { id: "staging", name: "Staging", variables: {} },
  { id: "production", name: "Production", variables: {} },
];

function workspaceId(): string {
  return useWorkspaceStore.getState().activeId;
}

async function persistActive(activeId: string | null) {
  const store = await getStore();
  await store.set("activeEnvId", activeId);
}

export const useEnvStore = create<EnvState>((set, get) => ({
  environments: [],
  activeId: null,

  async load(wsId) {
    let environments: Environment[] = [];
    try {
      environments = await api.listEnvironments(wsId);
      if (environments.length === 0) {
        environments = defaultEnvs();
        await Promise.all(environments.map((e) => api.saveEnvironment(wsId, e)));
      }
    } catch (e) {
      console.error("listEnvironments failed:", e);
    }
    let stored: string | null | undefined;
    try {
      stored = await (await getStore()).get<string | null>("activeEnvId");
    } catch {
      stored = undefined;
    }
    const wanted = get().activeId ?? stored ?? "development";
    const activeId = environments.some((e) => e.id === wanted) ? wanted : null;
    set({ environments, activeId });
  },

  setActive(id) {
    set({ activeId: id });
    persistActive(id);
  },

  addEnv(name) {
    const env: Environment = { id: crypto.randomUUID(), name, variables: {} };
    set((s) => ({ environments: [...s.environments, env] }));
    api
      .saveEnvironment(workspaceId(), env)
      .catch((e) => console.error("saveEnvironment failed:", e));
  },

  updateVariables(id, vars) {
    const env = get().environments.find((e) => e.id === id);
    if (!env) return;
    const next = { ...env, variables: vars };
    set((s) => ({ environments: s.environments.map((e) => (e.id === id ? next : e)) }));
    api
      .saveEnvironment(workspaceId(), next)
      .catch((e) => console.error("saveEnvironment failed:", e));
  },

  removeEnv(id) {
    const environments = get().environments.filter((e) => e.id !== id);
    if (environments.length === 0) return; // never delete the last environment
    const activeId = get().activeId === id ? null : get().activeId;
    if (activeId !== get().activeId) persistActive(activeId);
    set({ environments, activeId });
    api
      .deleteEnvironment(workspaceId(), id)
      .catch((e) => console.error("deleteEnvironment failed:", e));
  },
}));

/** The environment applied to sends — Rust interpolates with it (authoritative). */
export function activeEnvironment(): Environment | null {
  const { environments, activeId } = useEnvStore.getState();
  return environments.find((e) => e.id === activeId) ?? null;
}
