import { create } from "zustand";
import { api } from "../lib/api";
import type { HistoryEntrySummary, HttpResponse } from "../lib/api";

interface HistoryState {
  /** Request id the drawer is open for; null = closed. */
  openFor: string | null;
  entries: HistoryEntrySummary[];
  loading: boolean;
  /** Per request: a saved response being viewed instead of the live one. */
  viewing: Record<string, HttpResponse>;

  toggle(requestId: string): Promise<void>;
  close(): void;
  refresh(requestId: string): Promise<void>;
  view(requestId: string, entryId: number): Promise<void>;
  backToLive(requestId: string): void;
  clear(requestId: string): Promise<void>;
}

export const useHistoryStore = create<HistoryState>((set, get) => ({
  openFor: null,
  entries: [],
  loading: false,
  viewing: {},

  async toggle(requestId) {
    if (get().openFor === requestId) {
      set({ openFor: null, entries: [] });
      return;
    }
    set({ openFor: requestId, entries: [], loading: true });
    await get().refresh(requestId);
  },

  close() {
    set({ openFor: null, entries: [] });
  },

  async refresh(requestId) {
    set({ loading: true });
    try {
      const entries = await api.listHistory(requestId);
      if (get().openFor !== requestId) return; // drawer moved on meanwhile
      set({ entries, loading: false });
    } catch {
      if (get().openFor !== requestId) return;
      set({ entries: [], loading: false });
    }
  },

  async view(requestId, entryId) {
    const entry = await api.getHistoryEntry(entryId);
    if (entry.response) {
      set((s) => ({ viewing: { ...s.viewing, [requestId]: entry.response! } }));
    }
  },

  backToLive(requestId) {
    set((s) => {
      const { [requestId]: _dropped, ...viewing } = s.viewing;
      return { viewing };
    });
  },

  async clear(requestId) {
    await api.clearHistory(requestId);
    set({ entries: [] });
  },
}));
