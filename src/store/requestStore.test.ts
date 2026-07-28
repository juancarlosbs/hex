import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/api", () => ({
  api: {
    getRequest: vi.fn(),
    updateRequest: vi.fn().mockResolvedValue(undefined),
    sendRequest: vi.fn(),
    parseSoapEnvelope: vi.fn(),
    getOperationSchema: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock("./workspaceStore", () => ({
  useWorkspaceStore: { getState: () => ({ activeId: "ws1" }), subscribe: vi.fn() },
}));
vi.mock("./collectionStore", () => ({
  useCollectionStore: { getState: () => ({ updateRequestMeta: vi.fn() }) },
}));

import { useRequestStore } from "./requestStore";
import { useResponseStore } from "./responseStore";
import { RestBody, makeEmptyRequest } from "../lib/request-types";
import { api } from "../lib/api";

beforeEach(() => {
  useRequestStore.setState({
    openRequests: { r1: makeEmptyRequest("r1", "R1", "GET", ["c1", "r1"]) },
    order: ["r1"],
    activeId: "r1",
  });
  vi.clearAllMocks();
});

describe("dirty tracking", () => {
  it("content edit marks the request dirty", () => {
    useRequestStore.getState().setUrl("r1", "https://api.dev");
    expect(useRequestStore.getState().openRequests.r1.dirty).toBe(true);
  });

  it("switching the active tab does not mark dirty", () => {
    useRequestStore.getState().setActiveTab("r1", "headers");
    expect(useRequestStore.getState().openRequests.r1.dirty).toBe(false);
  });

  it("saveRequest persists content and clears dirty", async () => {
    useRequestStore.getState().setUrl("r1", "https://api.dev");
    await useRequestStore.getState().saveRequest("r1");
    expect(api.updateRequest).toHaveBeenCalledWith(
      "ws1",
      ["c1", "r1"],
      expect.objectContaining({ kind: "rest", method: "GET", url: "https://api.dev" })
    );
    expect(useRequestStore.getState().openRequests.r1.dirty).toBe(false);
  });

  it("keeps dirty when the request is edited during an in-flight save", async () => {
    let resolveUpdate!: () => void;
    vi.mocked(api.updateRequest).mockReturnValue(
      new Promise((resolve) => { resolveUpdate = () => resolve(null); })
    );

    const savePromise = useRequestStore.getState().saveRequest("r1");
    useRequestStore.getState().setUrl("r1", "changed");
    resolveUpdate();
    await savePromise;

    expect(useRequestStore.getState().openRequests.r1.dirty).toBe(true);
  });

  it("closeRequestsUnder closes only tabs whose path is under the given prefix", () => {
    useRequestStore.setState({
      openRequests: {
        rA: makeEmptyRequest("rA", "RA", "GET", ["c1", "f1", "rA"]),
        rB: makeEmptyRequest("rB", "RB", "GET", ["c2", "rB"]),
      },
      order: ["rA", "rB"],
      activeId: "rA",
    });

    useRequestStore.getState().closeRequestsUnder(["c1", "f1"]);

    const s = useRequestStore.getState();
    expect(s.openRequests.rA).toBeUndefined();
    expect(s.openRequests.rB).toBeDefined();
    expect(s.order).toEqual(["rB"]);
    expect(s.activeId).toBe("rB");
  });

  it("normalizes a loaded body without form to an empty array", async () => {
    // the Rust side omits `form` when empty (skip_serializing_if), so the wire
    // shape of a saved json body has no form key at all
    vi.mocked(api.getRequest).mockResolvedValue({
      id: "r2",
      name: "teste",
      kind: "rest",
      method: "POST",
      url: "https://api.dev",
      params: [],
      headers: [],
      body: { mode: "json", json: "{}" } as RestBody,
    });
    await useRequestStore.getState().openRequest("r2", "teste", ["c1", "r2"]);
    expect(useRequestStore.getState().openRequests.r2.body.form).toEqual([]);
  });

  it("concurrent openRequest calls for the same id do not duplicate the tab", async () => {
    vi.mocked(api.getRequest).mockResolvedValue({
      id: "r2",
      name: "R2",
      kind: "rest",
      method: "GET",
      url: "https://api.dev/r2",
      params: [],
      headers: [],
    });
    const first = useRequestStore.getState().openRequest("r2", "R2", ["c1", "r2"]);
    const second = useRequestStore.getState().openRequest("r2", "R2", ["c1", "r2"]);
    await Promise.all([first, second]);
    expect(api.getRequest).toHaveBeenCalledTimes(2);
    const s = useRequestStore.getState();
    expect(s.order.filter((x) => x === "r2")).toHaveLength(1);
    expect(s.openRequests.r2).toBeDefined();
  });
});

describe("response cleanup", () => {
  it("closing a request clears its response entry", () => {
    useResponseStore.setState({
      responses: { r1: { state: "error", error: "x" } },
      seq: { r1: 1 },
    });
    useRequestStore.getState().closeRequest("r1");
    expect(useResponseStore.getState().responses.r1).toBeUndefined();
  });

  it("closeAll clears all response entries", () => {
    useResponseStore.setState({
      responses: { r1: { state: "error", error: "x" } },
      seq: { r1: 1 },
    });
    useRequestStore.getState().closeAll();
    expect(useResponseStore.getState().responses).toEqual({});
  });
});

describe("commitSoapXml", () => {
  const leafSchema = {
    name: "Op", namespace: null, occurs: { min: 1, max: { bounded: 1 } }, nillable: false,
    doc: null, attributes: [], kind: { leaf: { xsdType: "string", enumValues: [], default: null, fixed: null } },
  };

  function seedSoap(xmlDraft: string | null) {
    useRequestStore.setState({
      openRequests: {
        s1: {
          ...makeEmptyRequest("s1", "S1", "POST", ["c1", "s1"]),
          soap: {
            meta: { wsdlUrl: "", inputElement: { namespace: "", local: "Op" }, endpoint: "", soapAction: "", soapVersion: "1.2" },
            schema: leafSchema as never,
            value: { leaf: "old" },
            xmlDraft,
          },
        },
      },
      order: ["s1"],
      activeId: "s1",
    });
  }

  it("on success sets the parsed value, clears the draft, returns null", async () => {
    seedSoap("<x/>");
    vi.mocked(api.parseSoapEnvelope).mockResolvedValue({ leaf: "new" } as never);
    const err = await useRequestStore.getState().commitSoapXml("s1");
    expect(err).toBeNull();
    const soap = useRequestStore.getState().openRequests.s1.soap!;
    expect(soap.value).toEqual({ leaf: "new" });
    expect(soap.xmlDraft).toBeNull();
  });

  it("on failure keeps the draft and returns the error message", async () => {
    seedSoap("<bad/>");
    vi.mocked(api.parseSoapEnvelope).mockRejectedValue("does not match schema");
    const err = await useRequestStore.getState().commitSoapXml("s1");
    expect(err).toBe("does not match schema");
    const soap = useRequestStore.getState().openRequests.s1.soap!;
    expect(soap.xmlDraft).toBe("<bad/>");
    expect(soap.value).toEqual({ leaf: "old" });
  });
});

describe("updatePathsUnder", () => {
  it("rewrites the path prefix of open requests under the moved node", () => {
    useRequestStore.setState({
      openRequests: { r1: makeEmptyRequest("r1", "R1", "GET", ["c1", "f1", "r1"]) },
      order: ["r1"],
      activeId: "r1",
    });
    useRequestStore.getState().updatePathsUnder(["c1", "f1"], ["c1", "f2", "f1"]);
    expect(useRequestStore.getState().openRequests.r1.path).toEqual(["c1", "f2", "f1", "r1"]);
  });

  it("leaves requests outside the prefix untouched", () => {
    useRequestStore.setState({
      openRequests: { r1: makeEmptyRequest("r1", "R1", "GET", ["c1", "other", "r1"]) },
      order: ["r1"],
      activeId: "r1",
    });
    useRequestStore.getState().updatePathsUnder(["c1", "f1"], ["c1", "f2", "f1"]);
    expect(useRequestStore.getState().openRequests.r1.path).toEqual(["c1", "other", "r1"]);
  });
});

describe("applyHistorySpec", () => {
  const leafSchema = {
    name: "Op", namespace: null, occurs: { min: 1, max: { bounded: 1 } }, nillable: false,
    doc: null, attributes: [], kind: { leaf: { xsdType: "string", enumValues: [], default: null, fixed: null } },
  };

  function seedSoap() {
    useRequestStore.setState({
      openRequests: {
        s1: {
          ...makeEmptyRequest("s1", "S1", "POST", ["c1", "s1"]),
          soap: {
            meta: {
              wsdlUrl: "https://old.dev?wsdl",
              inputElement: { namespace: "", local: "Op" },
              endpoint: "https://old.dev/svc",
              soapAction: "urn:old",
              soapVersion: "1.1",
            },
            schema: leafSchema as never,
            value: { leaf: "old" },
            xmlDraft: "old",
          },
        },
      },
      order: ["s1"],
      activeId: "s1",
    });
  }

  it("restores a REST spec into the open request", () => {
    useRequestStore.getState().applyHistorySpec("r1", {
      kind: "rest",
      spec: {
        method: "POST",
        url: "https://restored.dev",
        params: [{ id: "p1", key: "a", value: "1", enabled: true }],
        headers: [],
        body: { mode: "json", json: "{\"x\":1}", form: [] },
        auth: { type: "bearer", token: "tok" },
      },
    });
    const req = useRequestStore.getState().openRequests.r1;
    expect(req.method).toBe("POST");
    expect(req.url).toBe("https://restored.dev");
    expect(req.params[0].key).toBe("a");
    expect(req.body.json).toBe("{\"x\":1}");
    expect(req.auth).toEqual({ type: "bearer", token: "tok" });
    expect(req.dirty).toBe(true);
  });

  it("restores a SOAP form spec and clears the xml draft", () => {
    seedSoap();
    useRequestStore.getState().applyHistorySpec("s1", {
      kind: "soap",
      wsdlUrl: "https://w.dev?wsdl",
      inputElement: { namespace: "ns", local: "Op" },
      endpoint: "https://w.dev/svc",
      soapAction: "urn:op",
      soapVersion: "1.1",
      value: { sequence: [] },
    });
    const req = useRequestStore.getState().openRequests.s1;
    expect(req.soap?.meta.endpoint).toBe("https://w.dev/svc");
    expect(req.soap?.value).toEqual({ sequence: [] });
    expect(req.soap?.xmlDraft).toBeNull();
    expect(req.dirty).toBe(true);
  });

  it("restoring a different operation (different inputElement) nulls the schema and refetches it", async () => {
    seedSoap();
    const refetchedSchema = { ...leafSchema, name: "OtherOp" };
    vi.mocked(api.getOperationSchema).mockResolvedValue(refetchedSchema as never);
    useRequestStore.getState().applyHistorySpec("s1", {
      kind: "soap",
      wsdlUrl: "https://old.dev?wsdl",
      inputElement: { namespace: "", local: "OtherOp" },
      endpoint: "https://old.dev/svc",
      soapAction: "urn:other",
      soapVersion: "1.1",
      value: { sequence: [] },
    });
    expect(useRequestStore.getState().openRequests.s1.soap?.schema).toBeNull();
    expect(api.getOperationSchema).toHaveBeenCalledWith("https://old.dev?wsdl", {
      namespace: "",
      local: "OtherOp",
    });
    await vi.waitFor(() => {
      const req = useRequestStore.getState().openRequests.s1;
      expect(req.soap?.schema).toEqual(refetchedSchema);
      // the restored value must survive the schema refetch
      expect(req.soap?.value).toEqual({ sequence: [] });
    });
  });

  it("restoring the same operation keeps the existing schema and does not refetch", () => {
    seedSoap();
    useRequestStore.getState().applyHistorySpec("s1", {
      kind: "soap",
      wsdlUrl: "https://old.dev?wsdl",
      inputElement: { namespace: "", local: "Op" },
      endpoint: "https://old.dev/svc",
      soapAction: "urn:old",
      soapVersion: "1.1",
      value: { sequence: [] },
    });
    const req = useRequestStore.getState().openRequests.s1;
    expect(req.soap?.schema).toBe(leafSchema);
    expect(api.getOperationSchema).not.toHaveBeenCalled();
  });

  it("restores a raw SOAP envelope as the xml draft", () => {
    seedSoap();
    useRequestStore.getState().applyHistorySpec("s1", {
      kind: "soapRaw",
      endpoint: "https://w.dev/svc",
      envelope: "<Envelope/>",
      soapAction: "urn:op",
      soapVersion: "1.2",
    });
    const req = useRequestStore.getState().openRequests.s1;
    expect(req.soap?.xmlDraft).toBe("<Envelope/>");
    expect(req.soap?.meta.soapVersion).toBe("1.2");
    expect(req.dirty).toBe(true);
  });
});
