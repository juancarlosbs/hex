import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/api", () => ({
  api: { importWsdl: vi.fn(), confirmWsdlImport: vi.fn(), listCollections: vi.fn() },
}));

import { useWsdlImportStore } from "./wsdlImportStore";
import { WsdlImportPreview } from "../lib/api";
import { api } from "../lib/api";

const PREVIEW: WsdlImportPreview = {
  serviceName: "CalcService",
  wsdlUrl: "http://x/svc?wsdl",
  operations: [
    {
      name: "Add",
      endpoint: "http://x/svc",
      soapAction: "http://x/Add",
      soapVersion: "1.1",
      inputElement: { namespace: "http://x/ns", local: "Add" },
    },
  ],
};

beforeEach(() => {
  useWsdlImportStore.setState({ phase: { state: "idle" } });
  vi.clearAllMocks();
});

describe("importWsdl", () => {
  it("goes loading then preview on success", async () => {
    let resolve!: (p: WsdlImportPreview) => void;
    vi.mocked(api.importWsdl).mockReturnValue(new Promise((res) => { resolve = res; }));
    const p = useWsdlImportStore.getState().importWsdl("http://x/svc?wsdl");
    expect(useWsdlImportStore.getState().phase).toEqual({ state: "loading" });
    resolve(PREVIEW);
    await p;
    expect(useWsdlImportStore.getState().phase).toEqual({ state: "preview", preview: PREVIEW });
  });

  it("stores the error message on failure", async () => {
    vi.mocked(api.importWsdl).mockRejectedValue("failed to fetch http://x/a.xsd: HTTP 404");
    await useWsdlImportStore.getState().importWsdl("http://x/svc?wsdl");
    expect(useWsdlImportStore.getState().phase).toEqual({
      state: "error",
      message: "failed to fetch http://x/a.xsd: HTTP 404",
    });
  });
});

describe("confirm", () => {
  it("confirms, reloads collections and resets to idle", async () => {
    vi.mocked(api.confirmWsdlImport).mockResolvedValue(undefined);
    vi.mocked(api.listCollections).mockResolvedValue([]);
    useWsdlImportStore.setState({ phase: { state: "preview", preview: PREVIEW } });
    await useWsdlImportStore.getState().confirm("w1");
    expect(api.confirmWsdlImport).toHaveBeenCalledWith("w1", PREVIEW);
    expect(api.listCollections).toHaveBeenCalledWith("w1");
    expect(useWsdlImportStore.getState().phase).toEqual({ state: "idle" });
  });

  it("does nothing when not in preview", async () => {
    await useWsdlImportStore.getState().confirm("w1");
    expect(api.confirmWsdlImport).not.toHaveBeenCalled();
  });

  it("stores the error message when confirm fails", async () => {
    vi.mocked(api.confirmWsdlImport).mockRejectedValue("disk full");
    useWsdlImportStore.setState({ phase: { state: "preview", preview: PREVIEW } });
    await useWsdlImportStore.getState().confirm("w1");
    expect(useWsdlImportStore.getState().phase).toEqual({ state: "error", message: "disk full" });
  });
});
