import { load } from "@tauri-apps/plugin-store";

const FILE = "witch.json";

// ponytail: cache the promise; re-open cost is negligible but avoids redundant round-trips
let _store: ReturnType<typeof load> | null = null;

export function getStore() {
  return (_store ??= load(FILE));
}
