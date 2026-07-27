import { describe, it, expect, vi } from "vitest";
import type { CollectionNode } from "../lib/api";
import { moveInTree, useCollectionStore } from "./collectionStore";
import { api } from "../lib/api";

vi.mock("../lib/api", () => ({
  api: {
    moveNode: vi.fn(),
    listCollections: vi.fn(),
  },
}));

const req = (id: string): CollectionNode => ({
  type: "request",
  id,
  name: id,
  kind: "rest",
  method: "GET",
  url: "",
});
const folder = (id: string, children: CollectionNode[] = []): CollectionNode => ({
  type: "folder",
  id,
  name: id,
  children,
});

const tree: CollectionNode[] = [folder("col", [folder("f1", [req("r1"), req("r2")]), folder("f2", [req("r3")])])];

const childIds = (t: CollectionNode[], path: string[]): string[] => {
  let nodes = t;
  for (const id of path) {
    const f = nodes.find((n) => n.id === id);
    if (!f || f.type !== "folder") return [];
    nodes = f.children;
  }
  return nodes.map((n) => n.id);
};

describe("moveInTree", () => {
  it("moves a request between folders at the given index", () => {
    const out = moveInTree(tree, ["col", "f1", "r1"], ["col", "f2"], 0);
    expect(childIds(out, ["col", "f1"])).toEqual(["r2"]);
    expect(childIds(out, ["col", "f2"])).toEqual(["r1", "r3"]);
  });

  it("moves a folder with its children", () => {
    const out = moveInTree(tree, ["col", "f1"], ["col", "f2"], 1);
    expect(childIds(out, ["col"])).toEqual(["f2"]);
    expect(childIds(out, ["col", "f2"])).toEqual(["r3", "f1"]);
    expect(childIds(out, ["col", "f2", "f1"])).toEqual(["r1", "r2"]);
  });

  it("clamps an out-of-range index to the end", () => {
    const out = moveInTree(tree, ["col", "f1", "r1"], ["col", "f2"], 99);
    expect(childIds(out, ["col", "f2"])).toEqual(["r3", "r1"]);
  });

  it("returns the tree unchanged when the source does not exist", () => {
    expect(moveInTree(tree, ["col", "nope"], ["col", "f2"], 0)).toEqual(tree);
  });

  it("does not mutate the input tree", () => {
    const before = JSON.stringify(tree);
    moveInTree(tree, ["col", "f1", "r1"], ["col", "f2"], 0);
    expect(JSON.stringify(tree)).toBe(before);
  });
});

describe("move action", () => {
  it("returns false, rolls back collections, and re-fetches from disk when api.moveNode rejects", async () => {
    useCollectionStore.setState({ collections: tree });
    vi.mocked(api.moveNode).mockRejectedValueOnce(new Error("nope"));
    vi.mocked(api.listCollections).mockResolvedValueOnce(tree);

    const ok = await useCollectionStore.getState().move("ws1", ["col", "f1", "r1"], ["col", "f2"], 0);

    expect(ok).toBe(false);
    expect(useCollectionStore.getState().collections).toEqual(tree);
    expect(api.listCollections).toHaveBeenCalledWith("ws1");
  });

  it("returns true and keeps the moved tree when api.moveNode resolves", async () => {
    useCollectionStore.setState({ collections: tree });
    vi.mocked(api.moveNode).mockResolvedValueOnce(null);

    const ok = await useCollectionStore.getState().move("ws1", ["col", "f1", "r1"], ["col", "f2"], 0);

    expect(ok).toBe(true);
    const state = useCollectionStore.getState();
    expect(childIds(state.collections, ["col", "f1"])).toEqual(["r2"]);
    expect(childIds(state.collections, ["col", "f2"])).toEqual(["r1", "r3"]);
  });
});
