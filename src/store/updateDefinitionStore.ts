import { create } from "zustand";
import { api, DefinitionUpdatePreview } from "../lib/api";
import { useCollectionStore } from "./collectionStore";
import { useSettingsStore } from "./settingsStore";

type Phase =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "preview"; collectionId: string; preview: DefinitionUpdatePreview }
  | { state: "done"; summary: string }
  | { state: "error"; message: string };

interface UpdateDefinitionState {
  phase: Phase;
  start: (workspaceId: string, collectionId: string) => Promise<void>;
  apply: (workspaceId: string) => Promise<void>;
  reset: () => void;
}

type Diff = DefinitionUpdatePreview["diff"];

const isEmpty = (d: Diff) => d.new.length === 0 && d.changed.length === 0 && d.removed.length === 0;

const summary = (d: Diff) =>
  `Applied: ${d.new.length} new, ${d.changed.length} changed, ${d.removed.length} orphaned`;

export const useUpdateDefinitionStore = create<UpdateDefinitionState>((set, get) => ({
  phase: { state: "idle" },

  async start(workspaceId, collectionId) {
    set({ phase: { state: "loading" } });
    try {
      const preview = await api.previewDefinitionUpdate(workspaceId, collectionId);
      // Settings can skip the preview — but an empty diff still just informs.
      if (useSettingsStore.getState().skipUpdatePreview && !isEmpty(preview.diff)) {
        await api.applyDefinitionUpdate(workspaceId, collectionId, preview);
        await useCollectionStore.getState().load(workspaceId);
        set({ phase: { state: "done", summary: summary(preview.diff) } });
        return;
      }
      set({ phase: { state: "preview", collectionId, preview } });
    } catch (e) {
      set({ phase: { state: "error", message: String(e) } });
    }
  },

  async apply(workspaceId) {
    const phase = get().phase;
    if (phase.state !== "preview") return;
    try {
      await api.applyDefinitionUpdate(workspaceId, phase.collectionId, phase.preview);
      await useCollectionStore.getState().load(workspaceId);
      set({ phase: { state: "done", summary: summary(phase.preview.diff) } });
    } catch (e) {
      set({ phase: { state: "error", message: String(e) } });
    }
  },

  reset() {
    set({ phase: { state: "idle" } });
  },
}));
