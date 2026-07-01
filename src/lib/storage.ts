import { load } from "@tauri-apps/plugin-store";

const FILE = "witch.json";

export async function getStore() {
  return load(FILE);
}
