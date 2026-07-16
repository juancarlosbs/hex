# Request CRUD with Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Full REST request lifecycle — create inline in the tree, open loading saved content from disk, edit with explicit save (Cmd+S) + dirty indicator, delete closing its tab — persisting everything in the existing one-file-per-request TOML.

**Architecture:** Extend the existing `RequestFile` TOML (Approach A from the spec) with optional `params`/`headers`/`body`/`auth` fields (`#[serde(default)]`, old files keep parsing). Two new thin Tauri commands: `get_request` and `update_request` (update never touches `name`). Frontend: `requestStore` gains `path`/`dirty` per open request, async load on open, explicit `saveRequest`; `CollectionTree` reuses the `pendingCreation` inline-creation mechanism extended with a `kind`; `Titlebar` tabs get wired to the store (they are currently static mocks) with dirty dot + discard-confirmation dialog.

**Tech Stack:** Rust (serde + toml, existing persistence module), Tauri commands, React 19 + TS, Zustand, Vitest (new dev dependency — not installed yet despite docs).

**Spec:** `docs/superpowers/specs/2026-07-08-request-crud-design.md`

## Global Constraints

- TS: no `any`. Never `invoke` with a bare string in a component — always via `lib/api.ts` wrappers.
- UI: only tokens from `styles/tokens.css` (semantic classes like `bg-card`, `text-muted`); no hardcoded hex. Named exports only. Use `cn()` for class merging.
- Rust: commands stay thin (validate + delegate to `persistence`). `cargo fmt` + `clippy` clean before commit.
- Commits: Conventional Commits, single line, no body.
- All code/comments in English.
- Do not edit `src/bindings.ts` (not used by this feature; `lib/api.ts` uses raw `invoke` wrappers, follow that pattern).

---

### Task 1: Rust — request content types + `get_request`/`update_request` (TDD)

**Files:**
- Modify: `src-tauri/src/persistence/collection.rs`

**Interfaces:**
- Produces (used by Task 2's commands):
  - `pub struct RequestFile { pub id: String, pub name: String, pub kind: RequestKind, pub params: Vec<KeyValueEntry>, pub headers: Vec<KeyValueEntry>, pub body: Option<BodyData>, pub auth: Option<AuthData> }`
  - `pub struct RequestContent { pub kind: RequestKind, pub params: Vec<KeyValueEntry>, pub headers: Vec<KeyValueEntry>, pub body: Option<BodyData>, pub auth: Option<AuthData> }`
  - `pub fn get_request(data_dir: &Path, workspace_id: &str, path: Vec<String>) -> anyhow::Result<RequestFile>`
  - `pub fn update_request(data_dir: &Path, workspace_id: &str, path: Vec<String>, content: RequestContent) -> anyhow::Result<()>`

- [ ] **Step 1: Write the failing tests**

Append inside the existing `mod tests` in `src-tauri/src/persistence/collection.rs`:

```rust
    #[test]
    fn update_and_get_request_roundtrip() {
        let dir = tmp("update-req");
        let col = create_collection(&dir, "ws1", "Col").unwrap();
        let CollectionNode::Folder { id: col_id, .. } = col else { panic!() };
        let req = create_request(
            &dir,
            "ws1",
            vec![col_id.clone()],
            "Get Users",
            RequestKind::Rest { method: "GET".into(), url: "".into() },
        )
        .unwrap();
        let CollectionNode::Request { id: req_id, .. } = req else { panic!() };
        let path = vec![col_id, req_id];

        let content = RequestContent {
            kind: RequestKind::Rest { method: "POST".into(), url: "https://api.dev/users".into() },
            params: vec![KeyValueEntry {
                id: "p1".into(),
                key: "page".into(),
                value: "1".into(),
                description: None,
                enabled: true,
                entry_type: None,
            }],
            headers: vec![],
            body: Some(BodyData { mode: "json".into(), json: "{\"a\":1}".into(), form: vec![] }),
            auth: Some(AuthData::Bearer { token: "tok".into() }),
        };
        update_request(&dir, "ws1", path.clone(), content).unwrap();

        let rf = get_request(&dir, "ws1", path).unwrap();
        // name must be preserved (update_request never touches it)
        assert_eq!(rf.name, "Get Users");
        let RequestKind::Rest { method, url } = &rf.kind else { panic!() };
        assert_eq!(method, "POST");
        assert_eq!(url, "https://api.dev/users");
        assert_eq!(rf.params.len(), 1);
        assert_eq!(rf.params[0].key, "page");
        assert!(rf.headers.is_empty());
        assert_eq!(rf.body.as_ref().unwrap().json, "{\"a\":1}");
        assert!(matches!(rf.auth, Some(AuthData::Bearer { .. })));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn get_request_on_minimal_file_defaults_empty() {
        // create_request writes the pre-existing minimal shape (no content fields)
        let dir = tmp("get-minimal");
        let col = create_collection(&dir, "ws1", "Col").unwrap();
        let CollectionNode::Folder { id: col_id, .. } = col else { panic!() };
        let req = create_request(
            &dir,
            "ws1",
            vec![col_id.clone()],
            "Old",
            RequestKind::Rest { method: "GET".into(), url: "u".into() },
        )
        .unwrap();
        let CollectionNode::Request { id: req_id, .. } = req else { panic!() };

        let rf = get_request(&dir, "ws1", vec![col_id, req_id]).unwrap();
        assert!(rf.params.is_empty());
        assert!(rf.headers.is_empty());
        assert!(rf.body.is_none());
        assert!(rf.auth.is_none());
        fs::remove_dir_all(dir).unwrap();
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run (inside `src-tauri/`): `cargo test persistence::collection`
Expected: compile error — `RequestContent`, `KeyValueEntry`, `BodyData`, `AuthData`, `get_request`, `update_request` not found.

- [ ] **Step 3: Implement the types**

In `src-tauri/src/persistence/collection.rs`, replace the private `RequestFile` struct:

```rust
#[derive(Serialize, Deserialize)]
struct RequestFile {
    id: String,
    name: String,
    #[serde(flatten)]
    kind: RequestKind,
}
```

With (note: scalar fields stay before array/table fields — TOML requires values before tables):

```rust
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct KeyValueEntry {
    pub id: String,
    pub key: String,
    pub value: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "type")]
    pub entry_type: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BodyData {
    pub mode: String,
    pub json: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub form: Vec<KeyValueEntry>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum AuthData {
    None,
    Basic { username: String, password: String },
    Bearer { token: String },
    #[serde(rename_all = "camelCase")]
    Apikey { key: String, value: String, add_to: String },
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RequestFile {
    pub id: String,
    pub name: String,
    #[serde(flatten)]
    pub kind: RequestKind,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub params: Vec<KeyValueEntry>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub headers: Vec<KeyValueEntry>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body: Option<BodyData>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auth: Option<AuthData>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct RequestContent {
    #[serde(flatten)]
    pub kind: RequestKind,
    #[serde(default)]
    pub params: Vec<KeyValueEntry>,
    #[serde(default)]
    pub headers: Vec<KeyValueEntry>,
    #[serde(default)]
    pub body: Option<BodyData>,
    #[serde(default)]
    pub auth: Option<AuthData>,
}
```

Then update `create_request` (line ~182) — the `RequestFile` literal now needs the new fields:

```rust
    let rf = RequestFile {
        id: id.clone(),
        name: name.to_string(),
        kind: kind.clone(),
        params: vec![],
        headers: vec![],
        body: None,
        auth: None,
    };
```

- [ ] **Step 4: Implement `get_request` and `update_request`**

Add after `create_request`:

```rust
fn request_file_path(root: &Path, path: &[String]) -> anyhow::Result<PathBuf> {
    let id = path.last().ok_or_else(|| anyhow::anyhow!("empty path"))?;
    let parent = resolve_path(root, &path[..path.len() - 1]);
    Ok(parent.join(format!("{}.toml", id)))
}

pub fn get_request(data_dir: &Path, workspace_id: &str, path: Vec<String>) -> anyhow::Result<RequestFile> {
    validate_ids(&path)?;
    let root = collections_root(data_dir, workspace_id);
    let file = request_file_path(&root, &path)?;
    Ok(toml::from_str(&std::fs::read_to_string(file)?)?)
}

pub fn update_request(data_dir: &Path, workspace_id: &str, path: Vec<String>, content: RequestContent) -> anyhow::Result<()> {
    validate_ids(&path)?;
    let root = collections_root(data_dir, workspace_id);
    let file = request_file_path(&root, &path)?;
    // read first so `name` (owned by rename_node) is never clobbered by a stale save
    let mut rf: RequestFile = toml::from_str(&std::fs::read_to_string(&file)?)?;
    rf.kind = content.kind;
    rf.params = content.params;
    rf.headers = content.headers;
    rf.body = content.body;
    rf.auth = content.auth;
    std::fs::write(file, toml::to_string(&rf)?)?;
    Ok(())
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run (inside `src-tauri/`): `cargo test persistence::collection`
Expected: all tests PASS, including the pre-existing ones.

- [ ] **Step 6: Lint and commit**

```bash
cd src-tauri && cargo fmt && cargo clippy -- -D warnings && cd ..
git add src-tauri/src/persistence/collection.rs
git commit -m "feat(persistence): store full request content in request TOML with get/update"
```

---

### Task 2: Tauri commands + `lib/api.ts` wrappers

**Files:**
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs:9-17`
- Modify: `src/lib/api.ts`

**Interfaces:**
- Consumes: `collection::{get_request, update_request, RequestFile, RequestContent}` from Task 1.
- Produces (used by Task 3):
  - `api.getRequest(workspaceId: string, path: string[]): Promise<RequestFileData>`
  - `api.updateRequest(workspaceId: string, path: string[], content: RequestContent): Promise<void>`
  - TS types `RequestFileData` and `RequestContent` exported from `lib/api.ts`.

- [ ] **Step 1: Add commands**

Append to `src-tauri/src/commands/mod.rs`:

```rust
#[tauri::command]
pub fn get_request(app: tauri::AppHandle, workspace_id: String, path: Vec<String>) -> Result<collection::RequestFile, String> {
    let dir = data_dir(&app)?;
    collection::get_request(&dir, &workspace_id, path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_request(app: tauri::AppHandle, workspace_id: String, path: Vec<String>, content: collection::RequestContent) -> Result<(), String> {
    let dir = data_dir(&app)?;
    collection::update_request(&dir, &workspace_id, path, content).map_err(|e| e.to_string())
}
```

Note: the `use crate::persistence::collection::{self, ...}` import at the top already brings `collection` into scope — no import change needed.

- [ ] **Step 2: Register commands**

In `src-tauri/src/lib.rs`, add to the `generate_handler!` list after `commands::reorder_children`:

```rust
            commands::get_request,
            commands::update_request,
```

- [ ] **Step 3: Verify Rust compiles**

Run (inside `src-tauri/`): `cargo build`
Expected: success, no warnings about the new commands.

- [ ] **Step 4: Add frontend wrappers**

In `src/lib/api.ts`, add after the existing imports:

```ts
import { KeyValue, RestBody, AuthConfig } from "./request-types";
```

Add after the `CollectionNode` type:

```ts
export interface RequestContent {
  kind: "rest";
  method: string;
  url: string;
  params: KeyValue[];
  headers: KeyValue[];
  body: RestBody;
  auth: AuthConfig;
}

export interface RequestFileData {
  id: string;
  name: string;
  kind: "rest" | "soap";
  method?: string;
  url?: string;
  params?: KeyValue[];
  headers?: KeyValue[];
  body?: RestBody;
  auth?: AuthConfig;
}
```

Add inside the `api` object after `reorderChildren`:

```ts
  getRequest: (workspaceId: string, path: string[]) =>
    invoke<RequestFileData>("get_request", { workspaceId, path }),

  updateRequest: (workspaceId: string, path: string[], content: RequestContent) =>
    invoke<void>("update_request", { workspaceId, path, content }),
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `pnpm build 2>&1 | tail -5`
Expected: success.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/commands/mod.rs src-tauri/src/lib.rs src/lib/api.ts
git commit -m "feat(commands): expose get_request/update_request with api.ts wrappers"
```

---

### Task 3: `requestStore` load/save/dirty + Vitest setup (TDD)

**Files:**
- Modify: `src/lib/request-types.ts`
- Modify: `src/store/requestStore.ts`
- Modify: `src/store/collectionStore.ts`
- Modify: `package.json`
- Test: `src/store/requestStore.test.ts` (create)

**Interfaces:**
- Consumes: `api.getRequest` / `api.updateRequest` / `RequestFileData` / `RequestContent` from Task 2.
- Produces (used by Tasks 4–6):
  - `OpenRequest` gains `path: string[]` and `dirty: boolean`.
  - `useRequestStore` — `openRequest(id: string, name: string, path: string[]): Promise<void>` (replaces the old `(id, name, method?)` signature), `saveRequest(id: string): Promise<void>`.
  - `useCollectionStore` — `updateRequestMeta(path: string[], method: string, url: string): void` (local tree patch only, no I/O).
  - `makeEmptyRequest(id, name, method?, path?)` — adds optional `path` param, returns `dirty: false`.

- [ ] **Step 1: Install Vitest and add the test script**

```bash
pnpm add -D vitest
```

In `package.json` scripts, add:

```json
    "test": "vitest run",
```

- [ ] **Step 2: Write the failing tests**

Create `src/store/requestStore.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/api", () => ({
  api: {
    getRequest: vi.fn(),
    updateRequest: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock("./workspaceStore", () => ({
  useWorkspaceStore: { getState: () => ({ activeId: "ws1" }) },
}));
vi.mock("./collectionStore", () => ({
  useCollectionStore: { getState: () => ({ updateRequestMeta: vi.fn() }) },
}));

import { useRequestStore } from "./requestStore";
import { makeEmptyRequest } from "../lib/request-types";
import { api } from "../lib/api";

beforeEach(() => {
  useRequestStore.setState({
    openRequests: { r1: makeEmptyRequest("r1", "R1", "GET", ["c1", "r1"]) },
    order: ["r1"],
    activeId: "r1",
  });
  vi.clearAllMocks();
});

describe("dirty tracking", () => {
  it("content edit marks the request dirty", () => {
    useRequestStore.getState().setUrl("r1", "https://api.dev");
    expect(useRequestStore.getState().openRequests.r1.dirty).toBe(true);
  });

  it("switching the active tab does not mark dirty", () => {
    useRequestStore.getState().setActiveTab("r1", "headers");
    expect(useRequestStore.getState().openRequests.r1.dirty).toBe(false);
  });

  it("saveRequest persists content and clears dirty", async () => {
    useRequestStore.getState().setUrl("r1", "https://api.dev");
    await useRequestStore.getState().saveRequest("r1");
    expect(api.updateRequest).toHaveBeenCalledWith(
      "ws1",
      ["c1", "r1"],
      expect.objectContaining({ kind: "rest", method: "GET", url: "https://api.dev" })
    );
    expect(useRequestStore.getState().openRequests.r1.dirty).toBe(false);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm test`
Expected: FAIL — `makeEmptyRequest` doesn't accept a `path` argument / `dirty` undefined / `saveRequest` not a function.

- [ ] **Step 4: Update `request-types.ts`**

In `src/lib/request-types.ts`, add to the `OpenRequest` interface after `auth: AuthConfig;`:

```ts
  /** collection-tree path to the request file (ids from root to the request) */
  path: string[];
  dirty: boolean;
```

Replace `makeEmptyRequest` with:

```ts
export function makeEmptyRequest(
  id: string,
  name: string,
  method: HttpMethod = "GET",
  path: string[] = [],
): OpenRequest {
  return {
    id,
    name,
    method,
    url: "",
    activeTab: "params",
    params: [],
    headers: [],
    body: { mode: "json", json: "", form: [] },
    auth: { type: "none" },
    path,
    dirty: false,
  };
}
```

- [ ] **Step 5: Update `requestStore.ts`**

Replace the imports at the top of `src/store/requestStore.ts`:

```ts
// src/store/requestStore.ts
import { create } from "zustand";
import {
  AuthConfig,
  BodyMode,
  HTTP_METHODS,
  HttpMethod,
  KeyValue,
  OpenRequest,
  RequestTab,
  makeEmptyRequest,
} from "../lib/request-types";
import { api, RequestFileData } from "../lib/api";
import { useWorkspaceStore } from "./workspaceStore";
import { useCollectionStore } from "./collectionStore";
```

In the `RequestState` interface, replace:

```ts
  openRequest(id: string, name: string, method?: HttpMethod): void;
```

With:

```ts
  openRequest(id: string, name: string, path: string[]): Promise<void>;
  saveRequest(id: string): Promise<void>;
```

Replace the `openRequest` implementation:

```ts
  async openRequest(id, name, path) {
    if (get().openRequests[id]) {
      set({ activeId: id });
      return;
    }
    const workspaceId = useWorkspaceStore.getState().activeId;
    let req: OpenRequest;
    try {
      const data = await api.getRequest(workspaceId, path);
      req = fromFile(data, path);
    } catch (e) {
      console.error("getRequest failed:", e);
      req = makeEmptyRequest(id, name, "GET", path);
    }
    set((s) => ({
      openRequests: { ...s.openRequests, [id]: req },
      order: s.order.includes(id) ? s.order : [...s.order, id],
      activeId: id,
    }));
  },

  async saveRequest(id) {
    const r = get().openRequests[id];
    if (!r) return;
    const workspaceId = useWorkspaceStore.getState().activeId;
    try {
      await api.updateRequest(workspaceId, r.path, {
        kind: "rest",
        method: r.method,
        url: r.url,
        params: r.params,
        headers: r.headers,
        body: r.body,
        auth: r.auth,
      });
      set((s) => ({ openRequests: patch(s.openRequests, id, { dirty: false }) }));
      useCollectionStore.getState().updateRequestMeta(r.path, r.method, r.url);
    } catch (e) {
      console.error("saveRequest failed:", e);
    }
  },
```

Note: `create<RequestState>((set, get) => ...)` — the existing factory only takes `set`; change it to `(set, get)`.

Mark every content mutation dirty by adding `dirty: true` to the patched fields. The affected setters and their new patch payloads:

```ts
  setUrl(id, url) {
    set((s) => ({ openRequests: patch(s.openRequests, id, { url, dirty: true }) }));
  },
  setMethod(id, method) {
    set((s) => ({ openRequests: patch(s.openRequests, id, { method, dirty: true }) }));
  },
```

`setActiveTab` stays exactly as it is (no `dirty`). For the remaining setters, add `dirty: true` to the object passed to `patch` in each: `setKV`, `addKV`, `removeKV` (`{ [section]: list, dirty: true }`), `setBodyMode`, `setBodyJson`, `setFormRow`, `addFormRow`, `removeFormRow` (`{ body: { ... }, dirty: true }`), `setAuth` (`{ auth, dirty: true }`).

Add the file-mapping helper at the bottom of the file, next to `patch`:

```ts
function fromFile(data: RequestFileData, path: string[]): OpenRequest {
  const method: HttpMethod = (HTTP_METHODS as readonly string[]).includes(data.method ?? "")
    ? (data.method as HttpMethod)
    : "GET";
  return {
    id: data.id,
    name: data.name,
    method,
    url: data.url ?? "",
    activeTab: "params",
    params: data.params ?? [],
    headers: data.headers ?? [],
    body: data.body ?? { mode: "json", json: "", form: [] },
    auth: data.auth ?? { type: "none" },
    path,
    dirty: false,
  };
}
```

- [ ] **Step 6: Add `updateRequestMeta` to `collectionStore.ts`**

In the `CollectionState` interface, after `reorder`:

```ts
  updateRequestMeta: (path: string[], method: string, url: string) => void;
```

In the store object, after `reorder`:

```ts
  updateRequestMeta(path, method, url) {
    set((s) => ({ collections: updateRequestNode(s.collections, path, method, url) }));
  },
```

And the tree helper at the bottom, next to the others:

```ts
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
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm test`
Expected: 3 tests PASS.

Note: `pnpm build` will fail at this point — `CollectionTree.tsx` still calls the old `openRequest(id, name, method)` signature. That's fixed in Task 4; do not "fix" it here by keeping the old signature.

- [ ] **Step 8: Commit**

```bash
git add package.json pnpm-lock.yaml src/lib/request-types.ts src/store/requestStore.ts src/store/collectionStore.ts src/store/requestStore.test.ts
git commit -m "feat(request): load/save request content with dirty tracking in requestStore"
```

---

### Task 4: CollectionTree — open from disk, inline request creation, Sidebar `+`, delete closes tab

**Files:**
- Modify: `src/components/CollectionTree.tsx`
- Modify: `src/components/Sidebar.tsx:24-29`
- Modify: `src/store/collectionStore.ts` (change `addRequest` return type)

**Interfaces:**
- Consumes: `openRequest(id, name, path)` / `closeRequest(id)` from Task 3.
- Produces (used by Sidebar): `CollectionTreeHandle` gains `startCreateRequest(): void`.
- Changes: `collectionStore.addRequest` now returns `Promise<CollectionNode | null>` (the created node, or null on failure).

- [ ] **Step 1: Make `addRequest` return the created node**

In `src/store/collectionStore.ts`, change the interface line:

```ts
  addRequest: (workspaceId: string, parentPath: string[], name: string, kind: RequestKind) => Promise<CollectionNode | null>;
```

And the implementation:

```ts
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
```

- [ ] **Step 2: Extend `pendingCreation` with a `kind`**

In `src/components/CollectionTree.tsx`, this type appears in four places (root component state, `SortableList` props, `SortableFolderItem` props). Change every occurrence of:

```ts
pendingCreation: { parentPath: string[] } | null;
```

to:

```ts
pendingCreation: { parentPath: string[]; kind: "folder" | "request" } | null;
```

and every occurrence of:

```ts
onPendingCreate: (parentPath: string[]) => void;
```

to:

```ts
onPendingCreate: (parentPath: string[], kind: "folder" | "request") => void;
```

In the root `CollectionTree` component at the bottom of the file, update state + handle:

```tsx
export interface CollectionTreeHandle {
  startCreate: () => void;
  startCreateRequest: () => void;
}

export const CollectionTree = forwardRef<CollectionTreeHandle, { workspaceId: string }>(
  function CollectionTree({ workspaceId }, ref) {
    const collections = useCollectionStore((s) => s.collections);
    const [pendingCreation, setPendingCreation] = useState<{
      parentPath: string[];
      kind: "folder" | "request";
    } | null>(null);

    useImperativeHandle(ref, () => ({
      startCreate: () => setPendingCreation({ parentPath: [], kind: "folder" }),
      startCreateRequest: () => {
        const first = collections[0];
        if (first) setPendingCreation({ parentPath: [first.id], kind: "request" });
      },
    }));

    return (
      <SortableList
        nodes={collections}
        parentPath={[]}
        workspaceId={workspaceId}
        pendingCreation={pendingCreation}
        onPendingCreate={(parentPath, kind) => setPendingCreation({ parentPath, kind })}
        onCreationDone={() => setPendingCreation(null)}
      />
    );
  }
);
```

- [ ] **Step 3: Rewrite `PendingCreationRow` to support requests**

Replace the whole `PendingCreationRow` component:

```tsx
function PendingCreationRow({
  parentPath,
  kind,
  workspaceId,
  onCreationDone,
}: {
  parentPath: string[];
  kind: "folder" | "request";
  workspaceId: string;
  onCreationDone: () => void;
}) {
  const addCollection = useCollectionStore((s) => s.addCollection);
  const addFolder = useCollectionStore((s) => s.addFolder);
  const addRequest = useCollectionStore((s) => s.addRequest);
  const setActiveRequest = useCollectionStore((s) => s.setActiveRequest);
  const openRequest = useRequestStore((s) => s.openRequest);
  const isRoot = parentPath.length === 0;
  const isRequest = kind === "request";
  const defaultName = isRequest ? "New Request" : isRoot ? "New Collection" : "New Folder";

  async function handleCommit(name: string) {
    if (isRequest) {
      const node = await addRequest(workspaceId, parentPath, name, {
        kind: "rest",
        method: "GET",
        url: "",
      });
      if (node) {
        setActiveRequest(node.id);
        openRequest(node.id, name, [...parentPath, node.id]);
      }
    } else if (isRoot) {
      addCollection(workspaceId, name);
    } else {
      addFolder(workspaceId, parentPath, name);
    }
    onCreationDone();
  }

  return (
    <div className="flex items-center gap-[6px] rounded-[6px] px-2 py-[7px]" style={{ paddingLeft: isRoot ? 8 : 28 }}>
      {isRequest ? (
        <span className="w-10 text-right text-[10px] font-bold font-mono shrink-0 text-method-get">GET</span>
      ) : (
        <Folder size={14} className="text-sidebar-muted shrink-0" />
      )}
      <RenameInput initial={defaultName} onCommit={handleCommit} onCancel={onCreationDone} />
    </div>
  );
}
```

And in `SortableList`, pass the kind through:

```tsx
      {showPending && (
        <PendingCreationRow
          parentPath={parentPath}
          kind={pendingCreation!.kind}
          workspaceId={workspaceId}
          onCreationDone={onCreationDone}
        />
      )}
```

- [ ] **Step 4: Route the context-menu "New Request" through pending creation**

In `SortableFolderItem`:
- Remove the line `const addRequest = useCollectionStore((s) => s.addRequest);` (no longer used here).
- Replace `handleAction`:

```tsx
  function handleAction(a: MenuAction) {
    if (a.type === "rename") setRenaming(true);
    if (a.type === "delete") remove(workspaceId, path);
    if (a.type === "newFolder") { setOpen(true); onPendingCreate(path, "folder"); }
    if (a.type === "newRequest") { setOpen(true); onPendingCreate(path, "request"); }
  }
```

Remove the now-unused `RequestKind` import from the top of the file if nothing else uses it (check — it's only used by the old `addRequest` call).

- [ ] **Step 5: Open requests with their tree path; delete closes the tab**

In `SortableRequestItem`:
- Add: `const closeInStore = useRequestStore((s) => s.closeRequest);`
- Remove: `const setActiveInStore = useRequestStore((s) => s.setActive);`
- Replace `handleActivate`:

```tsx
  function handleActivate() {
    setActive(node.id);
    if (node.kind === "rest") {
      openInStore(node.id, node.name, path);
    }
  }
```

- Replace `handleAction`:

```tsx
  function handleAction(a: MenuAction) {
    if (a.type === "rename") setRenaming(true);
    if (a.type === "delete") {
      remove(workspaceId, path);
      closeInStore(node.id);
    }
  }
```

Remove the now-unused imports `HTTP_METHODS, HttpMethod` from `../lib/request-types` (only used by the old `handleActivate` method mapping) — keep the file's `METHOD_COLORS` map untouched.

- [ ] **Step 6: Wire the Sidebar `+` icon**

In `src/components/Sidebar.tsx`, replace the `Plus` element:

```tsx
          <Plus
            size={14}
            className="text-sidebar-muted cursor-pointer hover:text-foreground"
            onClick={() => treeRef.current?.startCreateRequest()}
          />
```

- [ ] **Step 7: Verify TypeScript compiles and tests still pass**

Run: `pnpm build 2>&1 | tail -5` — Expected: success (this fixes the Task 3 breakage).
Run: `pnpm test` — Expected: 3 tests PASS.

- [ ] **Step 8: Commit**

```bash
git add src/components/CollectionTree.tsx src/components/Sidebar.tsx src/store/collectionStore.ts
git commit -m "feat(collections): inline request creation, open with path, delete closes tab"
```

---

### Task 5: Titlebar — real tabs from the store, dirty dot, discard-confirmation dialog

**Files:**
- Modify: `src/components/Titlebar.tsx`

**Interfaces:**
- Consumes: `useRequestStore` (`order`, `openRequests`, `activeId`, `setActive`, `closeRequest`) and `useCollectionStore.setActiveRequest` from Task 3/4.

The Titlebar currently renders hardcoded mock tabs (`INITIAL_TABS`). Replace them with real open requests.

- [ ] **Step 1: Rewrite the tabs section**

In `src/components/Titlebar.tsx`:

Remove: the `RestTab`/`SoapTab`/`Tab` types, the `TabItem` component, and the `INITIAL_TABS` constant. Keep `METHOD_COLORS`.

Update imports:

```tsx
import React, { useState } from "react";
import { Search, Settings, X } from "lucide-react";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";
import { EnvSelector } from "./EnvSelector";
import { AddWorkspaceModal } from "./AddWorkspaceModal";
import { SettingsDialog } from "./SettingsDialog";
import { useRequestStore } from "../store/requestStore";
import { useCollectionStore } from "../store/collectionStore";
```

(`Hexagon` is dropped — open tabs are REST-only for now; the SOAP mock tab goes away with `INITIAL_TABS`.)

Add these components above `Titlebar`:

```tsx
function RequestTabs() {
  const order = useRequestStore((s) => s.order);
  const openRequests = useRequestStore((s) => s.openRequests);
  const activeId = useRequestStore((s) => s.activeId);
  const setActive = useRequestStore((s) => s.setActive);
  const closeRequest = useRequestStore((s) => s.closeRequest);
  const setActiveRequest = useCollectionStore((s) => s.setActiveRequest);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  function activate(id: string) {
    setActive(id);
    setActiveRequest(id);
  }

  function requestClose(id: string) {
    if (openRequests[id]?.dirty) setConfirmId(id);
    else doClose(id);
  }

  function doClose(id: string) {
    closeRequest(id);
    setActiveRequest(useRequestStore.getState().activeId);
  }

  return (
    <>
      <div
        className="flex items-center gap-[6px]"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        {order.map((id) => {
          const req = openRequests[id];
          if (!req) return null;
          const active = id === activeId;
          return (
            <div
              key={id}
              onClick={() => activate(id)}
              className={`flex items-center gap-[7px] px-[10px] py-[7px] rounded-[4px] cursor-pointer select-none
                ${active ? "bg-background border border-border" : "bg-transparent border border-transparent"}`}
            >
              <span className={`text-[10px] font-bold ${METHOD_COLORS[req.method] ?? "text-muted"}`}>
                {req.method}
              </span>
              <span className={`text-[12px] ${active ? "text-foreground font-semibold" : "text-muted"}`}>
                {req.name}
              </span>
              {req.dirty && <span className="w-[6px] h-[6px] rounded-full bg-accent shrink-0" />}
              <X
                size={12}
                className={`text-muted ${active ? "opacity-100" : "opacity-50"} hover:opacity-100`}
                onClick={(e) => { e.stopPropagation(); requestClose(id); }}
              />
            </div>
          );
        })}
      </div>
      {confirmId && (
        <DiscardChangesDialog
          onCancel={() => setConfirmId(null)}
          onDiscard={() => { doClose(confirmId); setConfirmId(null); }}
        />
      )}
    </>
  );
}

function DiscardChangesDialog({ onCancel, onDiscard }: { onCancel: () => void; onDiscard: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onPointerDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="w-[360px] rounded-[6px] bg-card border border-border overflow-hidden">
        <div className="px-5 py-4">
          <span className="text-[15px] font-semibold text-foreground">Discard changes?</span>
          <p className="mt-2 text-[13px] text-muted">
            This request has unsaved changes. Closing the tab will discard them.
          </p>
        </div>
        <div className="h-px bg-border" />
        <div className="flex items-center justify-end gap-[10px] px-5 py-[14px]">
          <button
            className="px-4 py-[7px] rounded-[4px] text-[13px] font-medium text-foreground bg-secondary border border-border hover:bg-secondary/80 cursor-pointer"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className="px-4 py-[7px] rounded-[4px] text-[13px] font-semibold cursor-pointer bg-accent text-accent-foreground hover:bg-accent/90"
            onClick={onDiscard}
          >
            Discard
          </button>
        </div>
      </div>
    </div>
  );
}
```

In the `Titlebar` body, replace the tabs block:

```tsx
        <div
          className="flex items-center gap-[6px]"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          {INITIAL_TABS.map((tab, i) => (
            <TabItem key={i} tab={tab} onClose={() => {}} />
          ))}
        </div>
```

With:

```tsx
        <RequestTabs />
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `pnpm build 2>&1 | tail -5`
Expected: success, no unused-import errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/Titlebar.tsx
git commit -m "feat(titlebar): wire tabs to requestStore with dirty dot and discard dialog"
```

---

### Task 6: Cmd+S saves the active request

**Files:**
- Modify: `src/components/request/RequestPanel.tsx`

**Interfaces:**
- Consumes: `saveRequest(id)` from Task 3.

- [ ] **Step 1: Add the keydown listener**

Replace `src/components/request/RequestPanel.tsx` imports and component head:

```tsx
import { useEffect } from "react";
import { useRequestStore } from "../../store/requestStore";
import { UrlBar } from "./UrlBar";
import { RequestTabsStrip } from "./RequestTabsStrip";
import { ParamsTab } from "./ParamsTab";
import { HeadersTab } from "./HeadersTab";
import { BodyTab } from "./body/BodyTab";
import { AuthTab } from "./auth/AuthTab";
import { RequestEmpty } from "./RequestEmpty";

export function RequestPanel() {
  const activeId = useRequestStore((s) => s.activeId);
  const activeTab = useRequestStore((s) => (activeId ? s.openRequests[activeId]?.activeTab : null));
  const saveRequest = useRequestStore((s) => s.saveRequest);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        if (activeId) saveRequest(activeId);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeId, saveRequest]);

  if (!activeId) return <RequestEmpty />;
```

The rest of the component body is unchanged.

- [ ] **Step 2: Verify TypeScript compiles**

Run: `pnpm build 2>&1 | tail -5`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add src/components/request/RequestPanel.tsx
git commit -m "feat(request): save active request with Cmd+S"
```

---

### Task 7: Manual verification

- [ ] **Step 1: Run all automated checks**

```bash
pnpm test
pnpm build
cd src-tauri && cargo test && cargo clippy -- -D warnings && cd ..
```

Expected: everything green.

- [ ] **Step 2: Start the app**

Run: `pnpm tauri dev`

- [ ] **Step 3: Create**

1. Right-click a collection → "New Request" → inline input appears with a `GET` badge, prefilled "New Request" selected.
2. Type a name → Enter → request is created, appears in the tree, and opens as the active tab in the titlebar with the request panel showing it.
3. Right-click → "New Request" → Esc → nothing created.
4. Click the Sidebar `+` icon → inline request input appears inside the first collection.

- [ ] **Step 4: Edit + save (persistence)**

1. Change method to POST, type a URL, add a param and a header, set a JSON body, set Bearer auth.
2. Tab shows the dirty dot.
3. Press Cmd+S → dot disappears; sidebar method badge updates to POST.
4. Close the tab, click the request again → panel shows POST, URL, params, headers, body, and auth loaded from disk.
5. Fully restart the app (`Ctrl+C`, `pnpm tauri dev` again) → open the request → content still there.

- [ ] **Step 5: Dirty close confirmation**

1. Edit the URL (dirty dot appears) → click the tab's X → "Discard changes?" dialog.
2. Cancel → tab stays open, edits intact.
3. X again → Discard → tab closes; reopen → saved (pre-edit) content loads.

- [ ] **Step 6: Delete**

1. Open a request in a tab → right-click it in the tree → Delete → node disappears AND its tab closes.

- [ ] **Step 7: Rename safety**

1. Open a request, edit the URL (don't save), rename it in the sidebar → tree shows the new name.
2. Cmd+S → reopen after closing the tab → name is still the renamed one (save didn't clobber it).
