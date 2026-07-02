import { create } from "zustand";
import { getStore } from "../lib/storage";

export interface Environment {
  id: string;
  name: string;
  variables: Record<string, string>;
}

interface EnvState {
  environments: Environment[];
  activeId: string | null;
  setActive: (id: string | null) => void;
  addEnv: (name: string) => void;
  removeEnv: (id: string) => void;
  updateVariables: (id: string, vars: Record<string, string>) => void;
}

const DEFAULT: Environment[] = [
  { id: "development", name: "Development", variables: {} },
  { id: "staging", name: "Staging", variables: {} },
  { id: "production", name: "Production", variables: {} },
];

async function persist(environments: Environment[], activeId: string | null) {
  const store = await getStore();
  await store.set("environments", environments);
  await store.set("activeEnvId", activeId);
}

export const useEnvStore = create<EnvState>((set, get) => ({
  environments: DEFAULT,
  activeId: "development",

  setActive(id) {
    set({ activeId: id });
    persist(get().environments, id);
  },

  addEnv(name) {
    const env: Environment = { id: crypto.randomUUID(), name, variables: {} };
    const environments = [...get().environments, env];
    set({ environments });
    persist(environments, get().activeId);
  },

  updateVariables(id, vars) {
    const environments = get().environments.map((e) =>
      e.id === id ? { ...e, variables: vars } : e
    );
    set({ environments });
    persist(environments, get().activeId);
  },

  removeEnv(id) {
    const environments = get().environments.filter((e) => e.id !== id);
    if (environments.length === 0) return;
    const activeId = get().activeId === id ? null : get().activeId;
    set({ environments, activeId });
    persist(environments, activeId);
  },
}));

export async function initEnvStore() {
  const store = await getStore();
  const environments = await store.get<Environment[]>("environments");
  const activeId = await store.get<string | null>("activeEnvId");
  if (environments && environments.length > 0) {
    useEnvStore.setState({ environments, activeId: activeId ?? null });
  }
}
