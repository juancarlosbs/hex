import { create } from "zustand";
import { api, CollectionNode, RequestKind } from "../lib/api";

interface CollectionState {
  collections: CollectionNode[];
  activeRequestId: string | null;
  load: (workspaceId: string) => Promise<void>;
  addCollection: (workspaceId: string, name: string) => Promise<void>;
  addFolder: (workspaceId: string, parentPath: string[], name: string) => Promise<void>;
  addRequest: (workspaceId: string, parentPath: string[], name: string, kind: RequestKind) => Promise<CollectionNode | null>;
  rename: (workspaceId: string, path: string[], name: string) => Promise<void>;
  remove: (workspaceId: string, path: string[]) => Promise<void>;
  reorder: (workspaceId: string, parentPath: string[], orderedIds: string[]) => Promise<void>;
  updateRequestMeta: (path: string[], method: string, url: string) => void;
  setActiveRequest: (id: string | null) => void;
}

export const useCollectionStore = create<CollectionState>((set, get) => ({
  collections: [],
  activeRequestId: null,

  async load(workspaceId) {
    const collections = await api.listCollections(workspaceId);
    set({ collections });
  },

  async addCollection(workspaceId, name) {
    try {
      const node = await api.createCollection(workspaceId, name);
      set((s) => ({ collections: [...s.collections, node] }));
    } catch (e) {
      console.error("createCollection failed:", e);
    }
  },

  async addFolder(workspaceId, parentPath, name) {
    try {
      const node = await api.createFolder(workspaceId, parentPath, name);
      set((s) => ({ collections: insertNode(s.collections, parentPath, node) }));
    } catch (e) {
      console.error("createFolder failed:", e);
    }
  },

  async addRequest(workspaceId, parentPath, name, kind) {
    try {
      const node = await api.createRequest(workspaceId, parentPath, name, kind);
      set((s) => ({ collections: insertNode(s.collections, parentPath, node) }));
      return node;
    } catch (e) {
      console.error("createRequest failed:", e);
      return null;
    }
  },

  async rename(workspaceId, path, name) {
    const prev = get().collections;
    set((s) => ({ collections: renameNode(s.collections, path, name) }));
    try {
      await api.renameNode(workspaceId, path, name);
    } catch (e) {
      console.error("rename failed:", e);
      set({ collections: prev });
    }
  },

  async remove(workspaceId, path) {
    const prev = get().collections;
    set((s) => ({ collections: removeNode(s.collections, path) }));
    try {
      await api.deleteNode(workspaceId, path);
    } catch (e) {
      console.error("delete failed:", e);
      set({ collections: prev });
    }
  },

  async reorder(workspaceId, parentPath, orderedIds) {
    const prev = get().collections;
    set((s) => ({ collections: reorderInTree(s.collections, parentPath, orderedIds) }));
    try {
      await api.reorderChildren(workspaceId, parentPath, orderedIds);
    } catch (e) {
      console.error("reorder failed:", e);
      set({ collections: prev });
    }
  },

  updateRequestMeta(path, method, url) {
    set((s) => ({ collections: updateRequestNode(s.collections, path, method, url) }));
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

function updateRequestNode(tree: CollectionNode[], path: string[], method: string, url: string): CollectionNode[] {
  if (path.length === 1) {
    return tree.map((n) =>
      n.id === path[0] && n.type === "request" && n.kind === "rest" ? { ...n, method, url } : n
    );
  }
  return tree.map((n) => {
    if (n.type !== "folder" || n.id !== path[0]) return n;
    return { ...n, children: updateRequestNode(n.children, path.slice(1), method, url) };
  });
}
