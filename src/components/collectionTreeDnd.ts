// Pure helpers for the flattened-tree drag-and-drop (dnd-kit SortableTree pattern).
import { arrayMove } from "@dnd-kit/sortable";
import type { CollectionNode } from "../lib/api";

export const INDENT = 16;

export interface FlatItem {
  id: string;
  node: CollectionNode;
  depth: number; // 0 = collection (root level)
  parentPath: string[];
}

export interface Projection {
  depth: number;
  parentPath: string[];
  index: number; // insertion index among the parent's direct children
}

export const arraysEqual = (a: string[], b: string[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

export function flattenTree(
  nodes: CollectionNode[],
  hidden: Set<string>,
  parentPath: string[] = [],
  depth = 0
): FlatItem[] {
  const out: FlatItem[] = [];
  for (const node of nodes) {
    out.push({ id: node.id, node, depth, parentPath });
    if (node.type === "folder" && !hidden.has(node.id)) {
      out.push(...flattenTree(node.children, hidden, [...parentPath, node.id], depth + 1));
    }
  }
  return out;
}

export function childrenOf(tree: CollectionNode[], parentPath: string[]): CollectionNode[] {
  let nodes = tree;
  for (const id of parentPath) {
    const f = nodes.find((n) => n.id === id);
    if (!f || f.type !== "folder") return [];
    nodes = f.children;
  }
  return nodes;
}

/** Flat index where the pending-creation input row renders: after the parent's last descendant. */
export function pendingInsertIndex(items: FlatItem[], parentPath: string[]): number {
  if (parentPath.length === 0) return items.length;
  const parentId = parentPath[parentPath.length - 1];
  let idx = items.findIndex((i) => i.id === parentId);
  if (idx < 0) return items.length;
  idx++;
  const isWithin = (i: FlatItem) =>
    i.parentPath.length >= parentPath.length && parentPath.every((v, k) => i.parentPath[k] === v);
  while (idx < items.length && isWithin(items[idx])) idx++;
  return idx;
}

/**
 * Project the drop target from the flat list (with the dragged folder's subtree
 * hidden), the hovered row, and the horizontal pointer offset. Returns null when
 * there is no valid target (e.g. a request hovered above the first collection).
 */
export function getProjection(
  items: FlatItem[],
  activeId: string,
  overId: string,
  offsetX: number
): Projection | null {
  const overIndex = items.findIndex((i) => i.id === overId);
  const activeIndex = items.findIndex((i) => i.id === activeId);
  if (overIndex < 0 || activeIndex < 0) return null;
  const active = items[activeIndex];
  const newItems = arrayMove(items, activeIndex, overIndex);

  // collections only reorder among themselves at root
  if (active.parentPath.length === 0) {
    let index = 0;
    for (let j = 0; j < overIndex; j++) if (newItems[j].depth === 0) index++;
    return { depth: 0, parentPath: [], index };
  }

  const prev = newItems[overIndex - 1];
  if (!prev) return null; // non-collection above the first row: no valid parent
  const next = newItems[overIndex + 1];

  const dragDepth = active.depth + Math.round(offsetX / INDENT);
  const maxDepth = prev.depth + (prev.node.type === "folder" ? 1 : 0);
  const minDepth = Math.max(next ? next.depth : 1, 1);
  const depth = Math.max(Math.min(dragDepth, maxDepth), minDepth);

  // nearest item above at depth-1 is the parent; everything between it and the
  // drop position at `depth` is a direct child of it (flatten guarantees contiguity)
  for (let i = overIndex - 1; i >= 0; i--) {
    const it = newItems[i];
    if (it.depth === depth - 1) {
      if (it.node.type !== "folder") return null;
      const parentPath = [...it.parentPath, it.id];
      let index = 0;
      for (let j = i + 1; j < overIndex; j++) {
        if (newItems[j].depth === depth) index++;
      }
      return { depth, parentPath, index };
    }
    if (it.depth < depth - 1) return null;
  }
  return null;
}

export type DropResolution =
  | { kind: "reorder"; parentPath: string[]; ids: string[] }
  | { kind: "move"; fromPath: string[]; toParentPath: string[]; index: number };

/** Decide whether a drop is a same-parent reorder or a cross-parent move. */
export function resolveDrop(
  item: FlatItem,
  proj: Projection,
  collections: CollectionNode[]
): DropResolution {
  if (arraysEqual(item.parentPath, proj.parentPath)) {
    const ids = childrenOf(collections, proj.parentPath)
      .map((n) => n.id)
      .filter((id) => id !== item.id);
    ids.splice(proj.index, 0, item.id);
    return { kind: "reorder", parentPath: proj.parentPath, ids };
  }
  return {
    kind: "move",
    fromPath: [...item.parentPath, item.id],
    toParentPath: proj.parentPath,
    index: proj.index,
  };
}
