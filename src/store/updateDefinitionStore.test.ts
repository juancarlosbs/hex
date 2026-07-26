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
});
