import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/api", () => ({
  api: {
    getRequest: vi.fn(),
    updateRequest: vi.fn().mockResolvedValue(undefined),
    sendRequest: vi.fn(),
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
import { makeEmptyRequest } from "../lib/request-types";
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
      new Promise((resolve) => { resolveUpdate = () => resolve(undefined); })
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

  it("concurrent openRequest calls for the same id do not duplicate the tab", async () => {
    vi.mocked(api.getRequest).mockResolvedValue({
      id: "r2",
      name: "R2",
      kind: "rest",
      method: "GET",
      url: "https://api.dev/r2",
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
