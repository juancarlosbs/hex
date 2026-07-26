import { create } from "zustand";
import { getStore } from "../lib/storage";

interface SettingsState {
  /** F6: skip the diff preview modal and apply definition updates directly. */
  skipUpdatePreview: boolean;
  setSkipUpdatePreview: (v: boolean) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  skipUpdatePreview: false,

  setSkipUpdatePreview(v) {
    set({ skipUpdatePreview: v });
    getStore().then((s) => s.set("skipUpdatePreview", v));
  },
}));

export async function initSettingsStore() {
  const store = await getStore();
  const v = await store.get<boolean>("skipUpdatePreview");
  if (v !== undefined) useSettingsStore.setState({ skipUpdatePreview: v ?? false });
}
