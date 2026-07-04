import { create } from "zustand";
import { api, CollectionNode, RequestKind } from "../lib/api";

interface CollectionState {
  collections: CollectionNode[];
  activeRequestId: string | null;
  load: (workspaceId: string) => Promise<void>;
  addCollection: (workspaceId: string, name: string) => Promise<void>;
  addFolder: (workspaceId: string, parentPath: string[], name: string) => Promise<void>;
  addRequest: (workspaceId: string, parentPath: string[], name: string, kind: RequestKind) => Promise<void>;
  rename: (workspaceId: string, path: string[], name: string) => Promise<void>;
  remove: (workspaceId: string, path: string[]) => Promise<void>;
  reorder: (workspaceId: string, parentPath: string[], orderedIds: string[]) => Promise<void>;
  setActiveRequest: (id: string | null) => void;
}

export const useCollectionStore = create<CollectionState>((set) => ({
  collections: [],
  activeRequestId: null,

  async load(workspaceId) {
    const collections = await api.listCollections(workspaceId);
    set({ collections });
  },

  async addCollection(workspaceId, name) {
    const node = await api.createCollection(workspaceId, name);
    set((s) => ({ collections: [...s.collections, node] }));
  },

  async addFolder(workspaceId, parentPath, name) {
    const node = await api.createFolder(workspaceId, parentPath, name);
    set((s) => ({ collections: insertNode(s.collections, parentPath, node) }));
  },

  async addRequest(workspaceId, parentPath, name, kind) {
    const node = await api.createRequest(workspaceId, parentPath, name, kind);
    set((s) => ({ collections: insertNode(s.collections, parentPath, node) }));
  },

  async rename(workspaceId, path, name) {
    await api.renameNode(workspaceId, path, name);
    set((s) => ({ collections: renameNode(s.collections, path, name) }));
  },

  async remove(workspaceId, path) {
    await api.deleteNode(workspaceId, path);
    set((s) => ({ collections: removeNode(s.collections, path) }));
  },

  async reorder(workspaceId, parentPath, orderedIds) {
    await api.reorderChildren(workspaceId, parentPath, orderedIds);
    set((s) => ({ collections: reorderInTree(s.collections, parentPath, orderedIds) }));
  },

  setActiveRequest(id) {
    set({ activeRequestId: id });
  },
}));

// ── Tree mutation helpers ─────────────────────────────────────────────────────

function insertNode(tree: CollectionNode[], parentPath: string[], node: CollectionNode): CollectionNode[] {
  if (parentPath.length === 0) return [...tree, node];
  return tree.map((n) => {
    if (n.type !== "folder" || n.id !== parentPath[0]) return n;
    return { ...n, children: insertNode(n.children, parentPath.slice(1), node) };
  });
}

function renameNode(tree: CollectionNode[], path: string[], name: string): CollectionNode[] {
  if (path.length === 1) {
    return tree.map((n) => (n.id === path[0] ? { ...n, name } : n));
  }
  return tree.map((n) => {
    if (n.type !== "folder" || n.id !== path[0]) return n;
    return { ...n, children: renameNode(n.children, path.slice(1), name) };
  });
}

function removeNode(tree: CollectionNode[], path: string[]): CollectionNode[] {
  if (path.length === 1) return tree.filter((n) => n.id !== path[0]);
  return tree.map((n) => {
    if (n.type !== "folder" || n.id !== path[0]) return n;
    return { ...n, children: removeNode(n.children, path.slice(1)) };
  });
}

function reorderInTree(tree: CollectionNode[], parentPath: string[], orderedIds: string[]): CollectionNode[] {
  if (parentPath.length === 0) {
    return orderedIds.map((id) => tree.find((n) => n.id === id)!).filter(Boolean);
  }
  return tree.map((n) => {
    if (n.type !== "folder" || n.id !== parentPath[0]) return n;
    return { ...n, children: reorderInTree(n.children, parentPath.slice(1), orderedIds) };
  });
}
