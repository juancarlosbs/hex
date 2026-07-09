import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/api", () => ({
  api: {
    getRequest: vi.fn(),
    updateRequest: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock("./workspaceStore", () => ({
  useWorkspaceStore: { getState: () => ({ activeId: "ws1" }) },
}));
vi.mock("./collectionStore", () => ({
  useCollectionStore: { getState: () => ({ updateRequestMeta: vi.fn() }) },
}));

import { useRequestStore } from "./requestStore";
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
});
