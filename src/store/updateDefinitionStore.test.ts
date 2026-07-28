import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/api", () => ({
  api: {
    previewDefinitionUpdate: vi.fn(),
    applyDefinitionUpdate: vi.fn(),
    listCollections: vi.fn().mockResolvedValue([]),
  },
}));
vi.mock("../lib/storage", () => ({
  getStore: vi.fn().mockResolvedValue({ set: vi.fn(), get: vi.fn() }),
}));

import { useUpdateDefinitionStore } from "./updateDefinitionStore";
import { useSettingsStore } from "./settingsStore";
import { DefinitionUpdatePreview } from "../lib/api";
import { api } from "../lib/api";

const OP = {
  name: "Mul",
  endpoint: "http://x/svc",
  soapAction: "http://x/Mul",
  soapVersion: "1.1" as const,
  inputElement: { namespace: "http://x/ns", local: "Mul" },
};

const PREVIEW: DefinitionUpdatePreview = {
  serviceName: "CalcService",
  wsdlUrl: "http://x/svc?wsdl",
  diff: { new: [OP], changed: [], removed: ["Sub"], unchanged: 1 },
};

beforeEach(() => {
  useUpdateDefinitionStore.setState({ phase: { state: "idle" } });
  useSettingsStore.setState({ skipUpdatePreview: false });
  vi.clearAllMocks();
});

describe("start", () => {
  it("lands on preview with the fetched diff", async () => {
    vi.mocked(api.previewDefinitionUpdate).mockResolvedValue(PREVIEW);
    await useUpdateDefinitionStore.getState().start("w1", "c1");
    const phase = useUpdateDefinitionStore.getState().phase;
    expect(phase).toEqual({ state: "preview", collectionId: "c1", preview: PREVIEW });
    expect(api.applyDefinitionUpdate).not.toHaveBeenCalled();
  });

  it("applies directly when skipUpdatePreview is on", async () => {
    useSettingsStore.setState({ skipUpdatePreview: true });
    vi.mocked(api.previewDefinitionUpdate).mockResolvedValue(PREVIEW);
    vi.mocked(api.applyDefinitionUpdate).mockResolvedValue(null);
    await useUpdateDefinitionStore.getState().start("w1", "c1");
    expect(api.applyDefinitionUpdate).toHaveBeenCalledWith("w1", "c1", PREVIEW);
    expect(useUpdateDefinitionStore.getState().phase).toEqual({
      state: "done",
      summary: "Applied: 1 new, 0 changed, 1 orphaned",
    });
  });

  it("still previews an empty diff when skipUpdatePreview is on", async () => {
    useSettingsStore.setState({ skipUpdatePreview: true });
    const empty = { ...PREVIEW, diff: { new: [], changed: [], removed: [], unchanged: 2 } };
    vi.mocked(api.previewDefinitionUpdate).mockResolvedValue(empty);
    await useUpdateDefinitionStore.getState().start("w1", "c1");
    expect(api.applyDefinitionUpdate).not.toHaveBeenCalled();
    expect(useUpdateDefinitionStore.getState().phase.state).toBe("preview");
  });

  it("surfaces fetch errors", async () => {
    vi.mocked(api.previewDefinitionUpdate).mockRejectedValue("fetch http://x failed");
    await useUpdateDefinitionStore.getState().start("w1", "c1");
    expect(useUpdateDefinitionStore.getState().phase).toEqual({
      state: "error",
      message: "fetch http://x failed",
    });
  });

  it("discards the result when cancelled while the preview fetch is in flight", async () => {
    useSettingsStore.setState({ skipUpdatePreview: true });
    let resolvePreview!: (p: DefinitionUpdatePreview) => void;
    vi.mocked(api.previewDefinitionUpdate).mockReturnValue(
      new Promise((resolve) => {
        resolvePreview = resolve;
      }),
    );
    const startPromise = useUpdateDefinitionStore.getState().start("w1", "c1");
    useUpdateDefinitionStore.getState().reset();
    resolvePreview(PREVIEW);
    await startPromise;
    expect(useUpdateDefinitionStore.getState().phase).toEqual({ state: "idle" });
    expect(api.applyDefinitionUpdate).not.toHaveBeenCalled();
  });

  it("ignores a cancelled call's late resolution even once a new call is also loading", async () => {
    useSettingsStore.setState({ skipUpdatePreview: true });
    let resolveA!: (p: DefinitionUpdatePreview) => void;
    let resolveB!: (p: DefinitionUpdatePreview) => void;
    vi.mocked(api.previewDefinitionUpdate)
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveA = resolve;
        }),
      )
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveB = resolve;
        }),
      );
    vi.mocked(api.applyDefinitionUpdate).mockResolvedValue(null);

    const previewA: DefinitionUpdatePreview = {
      ...PREVIEW,
      diff: { ...PREVIEW.diff, new: [{ ...OP, name: "FromA" }] },
    };
    const previewB: DefinitionUpdatePreview = {
      ...PREVIEW,
      diff: { ...PREVIEW.diff, new: [{ ...OP, name: "FromB" }] },
    };

    const callA = useUpdateDefinitionStore.getState().start("w1", "c1");
    useUpdateDefinitionStore.getState().reset();
    const callB = useUpdateDefinitionStore.getState().start("w1", "c2");

    // A resolves after B has already started — both phases read "loading",
    // so a state-shaped guard would let A's stale apply through.
    resolveA(previewA);
    await callA;
    expect(api.applyDefinitionUpdate).not.toHaveBeenCalledWith("w1", "c1", previewA);
    expect(useUpdateDefinitionStore.getState().phase.state).toBe("loading"); // B still pending

    resolveB(previewB);
    await callB;
    expect(api.applyDefinitionUpdate).toHaveBeenCalledTimes(1);
    expect(api.applyDefinitionUpdate).toHaveBeenCalledWith("w1", "c2", previewB);
    expect(useUpdateDefinitionStore.getState().phase).toEqual({
      state: "done",
      summary: "Applied: 1 new, 0 changed, 1 orphaned",
    });
  });
});

describe("apply", () => {
  it("applies the previewed diff and reports a summary", async () => {
    vi.mocked(api.applyDefinitionUpdate).mockResolvedValue(null);
    useUpdateDefinitionStore.setState({
      phase: { state: "preview", collectionId: "c1", preview: PREVIEW },
    });
    await useUpdateDefinitionStore.getState().apply("w1");
    expect(api.applyDefinitionUpdate).toHaveBeenCalledWith("w1", "c1", PREVIEW);
    expect(useUpdateDefinitionStore.getState().phase).toEqual({
      state: "done",
      summary: "Applied: 1 new, 0 changed, 1 orphaned",
    });
  });

  it("is not re-entrant — a second call while applying is a no-op", async () => {
    let resolveApply!: () => void;
    vi.mocked(api.applyDefinitionUpdate).mockReturnValue(
      new Promise((resolve) => {
        resolveApply = () => resolve(null);
      }),
    );
    useUpdateDefinitionStore.setState({
      phase: { state: "preview", collectionId: "c1", preview: PREVIEW },
    });
    const first = useUpdateDefinitionStore.getState().apply("w1");
    const second = useUpdateDefinitionStore.getState().apply("w1");
    resolveApply();
    await Promise.all([first, second]);
    expect(api.applyDefinitionUpdate).toHaveBeenCalledTimes(1);
  });
});
