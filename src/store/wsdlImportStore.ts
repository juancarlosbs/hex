import { create } from "zustand";
import { api, WsdlImportPreview } from "../lib/api";
import { useCollectionStore } from "./collectionStore";

type Phase =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "preview"; preview: WsdlImportPreview }
  | { state: "error"; message: string };

interface WsdlImportState {
  phase: Phase;
  importWsdl: (url: string) => Promise<void>;
  confirm: (workspaceId: string) => Promise<void>;
  reset: () => void;
}

export const useWsdlImportStore = create<WsdlImportState>((set, get) => ({
  phase: { state: "idle" },

  async importWsdl(url) {
    set({ phase: { state: "loading" } });
    try {
      const preview = await api.importWsdl(url);
      set({ phase: { state: "preview", preview } });
    } catch (e) {
      set({ phase: { state: "error", message: String(e) } });
    }
  },

  async confirm(workspaceId) {
    const phase = get().phase;
    if (phase.state !== "preview") return;
    try {
      await api.confirmWsdlImport(workspaceId, phase.preview);
      await useCollectionStore.getState().load(workspaceId);
      set({ phase: { state: "idle" } });
    } catch (e) {
      set({ phase: { state: "error", message: String(e) } });
    }
  },

  reset() {
    set({ phase: { state: "idle" } });
  },
}));
