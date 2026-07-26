import { describe, it, expect } from "vitest";
import type { CollectionNode } from "../lib/api";
import {
  flattenTree,
  getProjection,
  childrenOf,
  pendingInsertIndex,
} from "./collectionTreeDnd";

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

// col > [f1 > [r1, r2], f2 > [r3]]
const tree: CollectionNode[] = [folder("col", [folder("f1", [req("r1"), req("r2")]), folder("f2", [req("r3")])])];

describe("flattenTree", () => {
  it("flattens depth-first with depth and parentPath", () => {
    const flat = flattenTree(tree, new Set());
    expect(flat.map((i) => i.id)).toEqual(["col", "f1", "r1", "r2", "f2", "r3"]);
    expect(flat.map((i) => i.depth)).toEqual([0, 1, 2, 2, 1, 2]);
    expect(flat[2].parentPath).toEqual(["col", "f1"]);
  });

  it("skips children of hidden folders", () => {
    const flat = flattenTree(tree, new Set(["f1"]));
    expect(flat.map((i) => i.id)).toEqual(["col", "f1", "f2", "r3"]);
  });
});

describe("getProjection", () => {
  const flat = flattenTree(tree, new Set());

  it("moves a request into another folder at an exact index", () => {
    // drag r1 below r3, no horizontal offset -> last child of f2
    const p = getProjection(flat, "r1", "r3", 0);
    expect(p).toEqual({ depth: 2, parentPath: ["col", "f2"], index: 1 });
  });

  it("drops as first child when hovering just under a folder row", () => {
    // drag r3 over r1 (first slot of f1)
    const p = getProjection(flat, "r3", "r1", 0);
    expect(p).toEqual({ depth: 2, parentPath: ["col", "f1"], index: 0 });
  });

  it("dedents to the parent level with negative offset", () => {
    // drag r2 at the end of f1's children, pulled left -> sibling of f1 (child of col)
    const p = getProjection(flat, "r2", "r2", -16);
    expect(p).toEqual({ depth: 1, parentPath: ["col"], index: 1 });
  });

  it("clamps depth so a request cannot land at root", () => {
    const p = getProjection(flat, "r2", "r2", -64);
    expect(p!.depth).toBe(1);
    expect(p!.parentPath).toEqual(["col"]);
  });

  it("reorders same-parent siblings", () => {
    // drag f2 above f1; real usage hides the dragged folder's subtree
    const hiddenFlat = flattenTree(tree, new Set(["f2"]));
    const p = getProjection(hiddenFlat, "f2", "f1", 0);
    expect(p).toEqual({ depth: 1, parentPath: ["col"], index: 0 });
  });

  it("forces a folder dropped above a nested row to become its sibling's child", () => {
    // f1 dropped between f2 and f2's child r3: depth clamps to r3's depth
    const hiddenFlat = flattenTree(tree, new Set(["f1"]));
    const p = getProjection(hiddenFlat, "f1", "f2", 0);
    expect(p).toEqual({ depth: 2, parentPath: ["col", "f2"], index: 0 });
  });

  it("keeps collections at root depth regardless of offset", () => {
    const two = [...tree, folder("col2")];
    const flat2 = flattenTree(two, new Set());
    const p = getProjection(flat2, "col2", "col", 32);
    expect(p).toEqual({ depth: 0, parentPath: [], index: 0 });
  });

  it("returns null when hovering above the first row", () => {
    // a non-collection can never be projected above the first collection
    expect(getProjection(flat, "r1", "col", 0)).toBeNull();
  });
});

describe("childrenOf", () => {
  it("resolves nested children", () => {
    expect(childrenOf(tree, ["col", "f1"]).map((n) => n.id)).toEqual(["r1", "r2"]);
  });
  it("returns root list for empty path", () => {
    expect(childrenOf(tree, []).map((n) => n.id)).toEqual(["col"]);
  });
});

describe("pendingInsertIndex", () => {
  const flat = flattenTree(tree, new Set());
  it("inserts after the last descendant of the parent", () => {
    // f1's block is [f1, r1, r2] at indices 1..3 -> insert at 4
    expect(pendingInsertIndex(flat, ["col", "f1"])).toBe(4);
  });
  it("appends at the end for root", () => {
    expect(pendingInsertIndex(flat, [])).toBe(flat.length);
  });
});
