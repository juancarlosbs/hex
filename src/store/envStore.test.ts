import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Store } from "@tauri-apps/plugin-store";

vi.mock("../lib/api", () => ({
  api: {
    listEnvironments: vi.fn(),
    saveEnvironment: vi.fn(),
    deleteEnvironment: vi.fn(),
  },
}));

vi.mock("../lib/storage", () => ({
  getStore: vi.fn(),
}));

import { useEnvStore } from "./envStore";
import { api } from "../lib/api";
import type { Environment } from "../lib/api";
import { getStore } from "../lib/storage";

const env = (id: string, name: string, variables: Record<string, string> = {}): Environment => ({
  id,
  name,
  variables,
});

function makeMockStore(initial: Record<string, unknown> = {}) {
  const data = new Map<string, unknown>(Object.entries(initial));
  return {
    get: vi.fn((key: string) => Promise.resolve(data.get(key))),
    set: vi.fn((key: string, value: unknown) => {
      data.set(key, value);
      return Promise.resolve();
    }),
  };
}

const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));

let store: ReturnType<typeof makeMockStore>;

beforeEach(() => {
  useEnvStore.setState({ environments: [], activeId: null, loadErrors: [], workspaceId: null });
  vi.clearAllMocks();
  store = makeMockStore();
  vi.mocked(getStore).mockResolvedValue(store as unknown as Store);
});

describe("load", () => {
  it("fetches and sets environments for the workspace", async () => {
    const envs = [env("1", "Development")];
    vi.mocked(api.listEnvironments).mockResolvedValue({ environments: envs, errors: [] });

    await useEnvStore.getState().load("ws1");

    expect(useEnvStore.getState().environments).toEqual(envs);
    expect(useEnvStore.getState().loadErrors).toEqual([]);
    expect(useEnvStore.getState().workspaceId).toBe("ws1");
  });

  it("seeds Development/Staging/Production with fixed ids when the workspace is empty", async () => {
    const seeded = [
      env("development", "Development"),
      env("staging", "Staging"),
      env("production", "Production"),
    ];
    vi.mocked(api.listEnvironments)
      .mockResolvedValueOnce({ environments: [], errors: [] })
      .mockResolvedValueOnce({ environments: seeded, errors: [] });
    vi.mocked(api.saveEnvironment).mockResolvedValue(null);

    await useEnvStore.getState().load("ws1");

    expect(api.saveEnvironment).toHaveBeenCalledTimes(3);
    const saved = vi.mocked(api.saveEnvironment).mock.calls.map(([, e]) => [e.id, e.name]);
    expect(saved).toEqual([
      ["development", "Development"],
      ["staging", "Staging"],
      ["production", "Production"],
    ]);
    expect(api.listEnvironments).toHaveBeenCalledTimes(2);
    expect(useEnvStore.getState().environments).toEqual(seeded);
  });

  it("converges to 3 files when two concurrent loads both seed an empty workspace", async () => {
    // Simulates React StrictMode double-mount: two loads race against the same
    // empty workspace. Fixed seed ids mean save_environment overwrites by id,
    // so both loads' seed writes target the same 3 files, not 6.
    const seeded = [
      env("development", "Development"),
      env("staging", "Staging"),
      env("production", "Production"),
    ];
    vi.mocked(api.listEnvironments)
      .mockResolvedValueOnce({ environments: [], errors: [] })
      .mockResolvedValueOnce({ environments: [], errors: [] })
      .mockResolvedValue({ environments: seeded, errors: [] });
    vi.mocked(api.saveEnvironment).mockResolvedValue(null);

    await Promise.all([useEnvStore.getState().load("ws1"), useEnvStore.getState().load("ws1")]);

    expect(api.saveEnvironment).toHaveBeenCalledTimes(6);
    const ids = new Set(vi.mocked(api.saveEnvironment).mock.calls.map(([, e]) => e.id));
    expect(ids).toEqual(new Set(["development", "staging", "production"]));
  });

  it("discards a slow load for a stale workspace when a newer load resolves first", async () => {
    let resolveSlow!: (v: { environments: Environment[]; errors: string[] }) => void;
    vi.mocked(api.listEnvironments)
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveSlow = resolve;
        }),
      )
      .mockResolvedValueOnce({ environments: [env("2", "Staging")], errors: [] });

    const slow = useEnvStore.getState().load("wsA");
    const fast = useEnvStore.getState().load("wsB");
    await fast;
    expect(useEnvStore.getState().workspaceId).toBe("wsB");

    resolveSlow({ environments: [env("1", "Development")], errors: [] });
    await slow;

    // the slow, now-stale load for wsA must not have overwritten wsB's state
    expect(useEnvStore.getState().workspaceId).toBe("wsB");
    expect(useEnvStore.getState().environments).toEqual([env("2", "Staging")]);
  });

  it("does not seed when the workspace is empty because of load errors", async () => {
    vi.mocked(api.listEnvironments).mockResolvedValue({ environments: [], errors: ["bad.toml: parse error"] });

    await useEnvStore.getState().load("ws1");

    expect(api.saveEnvironment).not.toHaveBeenCalled();
    expect(useEnvStore.getState().loadErrors).toEqual(["bad.toml: parse error"]);
  });

  it("restores the persisted active id when it still exists", async () => {
    store = makeMockStore({ "activeEnv:ws1": "1" });
    vi.mocked(getStore).mockResolvedValue(store as unknown as Store);
    vi.mocked(api.listEnvironments).mockResolvedValue({
      environments: [env("1", "Development"), env("2", "Staging")],
      errors: [],
    });

    await useEnvStore.getState().load("ws1");

    expect(useEnvStore.getState().activeId).toBe("1");
  });

  it("resets active id to null when the persisted id no longer exists", async () => {
    store = makeMockStore({ "activeEnv:ws1": "gone" });
    vi.mocked(getStore).mockResolvedValue(store as unknown as Store);
    vi.mocked(api.listEnvironments).mockResolvedValue({
      environments: [env("1", "Development")],
      errors: [],
    });

    await useEnvStore.getState().load("ws1");

    expect(useEnvStore.getState().activeId).toBeNull();
  });
});

describe("setActive", () => {
  it("persists the active id under activeEnv:<workspaceId>", async () => {
    vi.mocked(api.listEnvironments).mockResolvedValue({ environments: [env("1", "Development")], errors: [] });
    await useEnvStore.getState().load("ws1");

    useEnvStore.getState().setActive("1");
    await flushPromises();

    expect(useEnvStore.getState().activeId).toBe("1");
    expect(store.set).toHaveBeenCalledWith("activeEnv:ws1", "1");
  });
});

describe("addEnv", () => {
  it("saves the new environment then reloads", async () => {
    vi.mocked(api.listEnvironments).mockResolvedValue({ environments: [env("1", "Development")], errors: [] });
    await useEnvStore.getState().load("ws1");

    vi.mocked(api.saveEnvironment).mockResolvedValue(null);
    const reloaded = [env("1", "Development"), env("2", "Staging")];
    vi.mocked(api.listEnvironments).mockResolvedValue({ environments: reloaded, errors: [] });

    await useEnvStore.getState().addEnv("Staging");

    expect(api.saveEnvironment).toHaveBeenCalledWith(
      "ws1",
      expect.objectContaining({ name: "Staging", variables: {} }),
    );
    expect(useEnvStore.getState().environments).toEqual(reloaded);
  });
});

describe("removeEnv", () => {
  it("refuses to remove the last remaining environment", async () => {
    vi.mocked(api.listEnvironments).mockResolvedValue({ environments: [env("1", "Development")], errors: [] });
    await useEnvStore.getState().load("ws1");

    await useEnvStore.getState().removeEnv("1");

    expect(api.deleteEnvironment).not.toHaveBeenCalled();
    expect(useEnvStore.getState().environments).toEqual([env("1", "Development")]);
  });

  it("resets activeId to null when removing the active environment", async () => {
    vi.mocked(api.listEnvironments).mockResolvedValue({
      environments: [env("1", "Development"), env("2", "Staging")],
      errors: [],
    });
    await useEnvStore.getState().load("ws1");
    useEnvStore.setState({ activeId: "1" });

    vi.mocked(api.deleteEnvironment).mockResolvedValue(null);
    vi.mocked(api.listEnvironments).mockResolvedValue({ environments: [env("2", "Staging")], errors: [] });

    await useEnvStore.getState().removeEnv("1");

    expect(api.deleteEnvironment).toHaveBeenCalledWith("ws1", "1");
    expect(useEnvStore.getState().activeId).toBeNull();
  });
});

describe("updateVariables", () => {
  it("saves the merged environment then reloads", async () => {
    const existing = env("1", "Development", { A: "1" });
    vi.mocked(api.listEnvironments).mockResolvedValue({ environments: [existing], errors: [] });
    await useEnvStore.getState().load("ws1");

    vi.mocked(api.saveEnvironment).mockResolvedValue(null);
    const updated = env("1", "Development", { A: "1", B: "2" });
    vi.mocked(api.listEnvironments).mockResolvedValue({ environments: [updated], errors: [] });

    await useEnvStore.getState().updateVariables("1", { A: "1", B: "2" });

    expect(api.saveEnvironment).toHaveBeenCalledWith("ws1", updated);
    expect(useEnvStore.getState().environments).toEqual([updated]);
  });
});
