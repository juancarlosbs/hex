import { describe, it, expect, vi, beforeEach } from "vitest";
import { useCollectionStore } from "./collectionStore";
import { api } from "../lib/api";
import type { CollectionNode } from "../lib/api";

vi.mock("../lib/api", () => ({
  api: { duplicateNode: vi.fn() },
}));

const reqA: CollectionNode = {
  type: "request",
  id: "a",
  name: "A",
  kind: "rest",
  method: "GET",
  url: "http://a",
};
const reqB: CollectionNode = {
  type: "request",
  id: "b",
  name: "B",
  kind: "rest",
  method: "GET",
  url: "http://b",
};
const folder = (children: CollectionNode[]): CollectionNode => ({
  type: "folder",
  id: "col",
  name: "Col",
  children,
});

beforeEach(() => {
  vi.clearAllMocks();
  useCollectionStore.setState({ collections: [], activeRequestId: null });
});

describe("collectionStore.duplicate", () => {
  it("inserts the returned copy right after the original inside a folder", async () => {
    const copy: CollectionNode = { ...reqA, id: "a2", name: "A copy" };
    vi.mocked(api.duplicateNode).mockResolvedValue(copy);
    useCollectionStore.setState({ collections: [folder([reqA, reqB])] });

    await useCollectionStore.getState().duplicate("w1", ["col", "a"]);

    const col = useCollectionStore.getState().collections[0];
    if (col.type !== "folder") throw new Error("expected folder");
    expect(col.children.map((n) => n.id)).toEqual(["a", "a2", "b"]);
    expect(api.duplicateNode).toHaveBeenCalledWith("w1", ["col", "a"]);
  });

  it("inserts a duplicated collection after the original at root", async () => {
    const copy: CollectionNode = { type: "folder", id: "col2", name: "Col copy", children: [] };
    vi.mocked(api.duplicateNode).mockResolvedValue(copy);
    useCollectionStore.setState({ collections: [folder([]), { type: "folder", id: "z", name: "Z", children: [] }] });

    await useCollectionStore.getState().duplicate("w1", ["col"]);

    expect(useCollectionStore.getState().collections.map((n) => n.id)).toEqual(["col", "col2", "z"]);
  });

  it("leaves the tree unchanged when the api call fails", async () => {
    vi.mocked(api.duplicateNode).mockRejectedValue("boom");
    useCollectionStore.setState({ collections: [folder([reqA])] });

    await useCollectionStore.getState().duplicate("w1", ["col", "a"]);

    const col = useCollectionStore.getState().collections[0];
    if (col.type !== "folder") throw new Error("expected folder");
    expect(col.children.map((n) => n.id)).toEqual(["a"]);
  });
});
