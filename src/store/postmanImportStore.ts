import { create } from "zustand";
import { api, type PostmanImportPreview } from "../lib/api";
import { useCollectionStore } from "./collectionStore";
import { useEnvStore } from "./envStore";

type Phase =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "preview"; preview: PostmanImportPreview }
  | { state: "error"; message: string };

interface PostmanImportState {
  phase: Phase;
  importCollection: (collectionJson: string, environmentJson: string | null) => Promise<void>;
  confirm: (workspaceId: string) => Promise<void>;
  setError: (message: string) => void;
  reset: () => void;
}

export const usePostmanImportStore = create<PostmanImportState>((set, get) => ({
  phase: { state: "idle" },

  async importCollection(collectionJson, environmentJson) {
    set({ phase: { state: "loading" } });
    try {
      const preview = await api.importPostmanCollection(collectionJson, environmentJson);
      set({ phase: { state: "preview", preview } });
    } catch (e) {
      set({ phase: { state: "error", message: String(e) } });
    }
  },

  async confirm(workspaceId) {
    const phase = get().phase;
    if (phase.state !== "preview") return;
    try {
      await api.confirmPostmanImport(workspaceId, phase.preview);
      await useCollectionStore.getState().load(workspaceId);
      if (phase.preview.environment) {
        await useEnvStore.getState().load(workspaceId);
      }
      set({ phase: { state: "idle" } });
    } catch (e) {
      set({ phase: { state: "error", message: String(e) } });
    }
  },

  setError(message) {
    set({ phase: { state: "error", message } });
  },

  reset() {
    set({ phase: { state: "idle" } });
  },
}));
