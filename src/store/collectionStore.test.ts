import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/api", () => ({
  api: { updateWsdlDefinition: vi.fn(), listCollections: vi.fn() },
}));

import { findWsdlUrl, useCollectionStore } from "./collectionStore";
import { api } from "../lib/api";
import type { CollectionNode, OperationDiff } from "../lib/api";

const soapReq: CollectionNode = {
  type: "request",
  id: "op1",
  name: "Add",
  kind: "soap",
  wsdlUrl: "http://x?wsdl",
  operation: "Add",
};

const service: CollectionNode = {
  type: "folder",
  id: "col1",
  name: "CalcService",
  children: [soapReq],
};

const restOnly: CollectionNode = {
  type: "folder",
  id: "col2",
  name: "Plain",
  children: [{ type: "request", id: "r1", name: "Get", kind: "rest", method: "GET", url: "u" }],
};

const DIFF: OperationDiff = {
  added: [],
  removed: ["Sub"],
  changed: [],
};

beforeEach(() => {
  useCollectionStore.setState({
    collections: [],
    activeRequestId: null,
    updateStatus: { state: "idle" },
  });
  vi.clearAllMocks();
});

describe("findWsdlUrl", () => {
  it("finds the WSDL URL of a nested SOAP request", () => {
    const nested: CollectionNode = { type: "folder", id: "f", name: "Deep", children: [soapReq] };
    expect(findWsdlUrl({ ...service, children: [nested] })).toBe("http://x?wsdl");
  });

  it("returns null for collections without SOAP requests", () => {
    expect(findWsdlUrl(restOnly)).toBeNull();
  });
});

describe("updateDefinition", () => {
  it("re-fetches the WSDL, reloads the tree and reports the diff summary", async () => {
    vi.mocked(api.updateWsdlDefinition).mockResolvedValue(DIFF);
    vi.mocked(api.listCollections).mockResolvedValue([service]);
    useCollectionStore.setState({ collections: [service] });

    await useCollectionStore.getState().updateDefinition("w1", "col1");

    expect(api.updateWsdlDefinition).toHaveBeenCalledWith("w1", "col1", "http://x?wsdl");
    expect(api.listCollections).toHaveBeenCalledWith("w1");
    expect(useCollectionStore.getState().updateStatus).toEqual({
      state: "done",
      summary: "0 added · 1 removed · 0 changed",
    });
  });

  it("reports 'Up to date' on an empty diff", async () => {
    vi.mocked(api.updateWsdlDefinition).mockResolvedValue({ added: [], removed: [], changed: [] });
    vi.mocked(api.listCollections).mockResolvedValue([service]);
    useCollectionStore.setState({ collections: [service] });

    await useCollectionStore.getState().updateDefinition("w1", "col1");

    expect(useCollectionStore.getState().updateStatus).toEqual({
      state: "done",
      summary: "Up to date",
    });
  });

  it("stores the error message on failure (F2 error path preserved)", async () => {
    vi.mocked(api.updateWsdlDefinition).mockRejectedValue(
      "failed to fetch http://x/a.xsd: HTTP 404",
    );
    useCollectionStore.setState({ collections: [service] });

    await useCollectionStore.getState().updateDefinition("w1", "col1");

    expect(useCollectionStore.getState().updateStatus).toEqual({
      state: "error",
      message: "failed to fetch http://x/a.xsd: HTTP 404",
    });
  });

  it("does nothing for a collection without SOAP requests", async () => {
    useCollectionStore.setState({ collections: [restOnly] });
    await useCollectionStore.getState().updateDefinition("w1", "col2");
    expect(api.updateWsdlDefinition).not.toHaveBeenCalled();
  });
});

describe("updateAllDefinitions", () => {
  it("updates every collection that has SOAP requests", async () => {
    const service2: CollectionNode = {
      type: "folder",
      id: "col3",
      name: "Other",
      children: [{ ...soapReq, id: "op2", wsdlUrl: "http://y?wsdl" }],
    };
    vi.mocked(api.updateWsdlDefinition).mockResolvedValue(DIFF);
    vi.mocked(api.listCollections).mockResolvedValue([service, restOnly, service2]);
    useCollectionStore.setState({ collections: [service, restOnly, service2] });

    await useCollectionStore.getState().updateAllDefinitions("w1");

    expect(api.updateWsdlDefinition).toHaveBeenCalledTimes(2);
    expect(api.updateWsdlDefinition).toHaveBeenCalledWith("w1", "col1", "http://x?wsdl");
    expect(api.updateWsdlDefinition).toHaveBeenCalledWith("w1", "col3", "http://y?wsdl");
  });
});
