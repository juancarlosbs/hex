# Request CRUD with Persistence — Design

**Date:** 2026-07-08
**Status:** Approved
**Scope:** Create, delete, edit (persist), and view REST requests end-to-end. Request execution (Send) and the response panel are explicitly out of scope for this stage.

## Context

Requests already exist as tree nodes persisted one-file-per-request (`{id}.toml`), but the file only stores `id`, `name`, `method`, `url`. Clicking a request opens an **empty** in-memory request (`makeEmptyRequest`) — edits to url/params/headers/body/auth live only in the `requestStore` and are never written to disk. Creation via context menu is hardcoded ("New Request", GET) with no inline input, unlike the inline-creation UX already shipped for collections/folders. The Sidebar `+` icon is unwired.

## Decisions (user-approved)

1. **Scope:** full CRUD with persistence — open loads saved content, explicit save writes it back.
2. **Save model:** explicit save (Cmd+S), with a per-tab dirty indicator.
3. **Create UX:** inline input in the tree (same mechanism as collections/folders); creates as GET with empty url and opens in the panel.
4. **Unsaved close:** confirmation dialog ("Discard changes?") when closing a dirty tab.
5. **Sidebar `+`:** starts inline request creation inside the first collection (no-op if no collection exists).
6. **Persistence shape (Approach A):** extend the existing `{id}.toml` — one file per request stays true (git-friendly differentiator). Rejected Approach B (separate content file): doubles files/writes with no gain since the tree read already parses the whole file.

## 1. Persistence (Rust — `persistence/collection.rs`)

Extend `RequestFile` with optional content fields, all `#[serde(default)]` so existing files keep parsing:

- `params: Vec<KeyValueEntry>` and `headers: Vec<KeyValueEntry>` — `{ id, key, value, enabled, description?, type? }`, mirroring the TS `KeyValue`.
- `body: Option<BodyData>` — `{ mode, json, form: Vec<KeyValueEntry> }`, mirroring `RestBody`.
- `auth: Option<AuthData>` — enum tagged by `type`: `none | basic | bearer | apikey`, mirroring `AuthConfig`.

TOML constraint: scalar fields must precede table/array fields in struct order. Use `skip_serializing_if` for `None`/empty so untouched requests keep minimal files.

Two new thin commands in `commands/mod.rs` (validate + delegate, matching existing style):

- `get_request(workspace_id, path) -> RequestFile` — full file contents.
- `update_request(workspace_id, path, content)` — reads the file, applies method/url/params/headers/body/auth, rewrites. **Never touches `name`** — rename stays exclusive to `rename_node`, so a sidebar rename can't be clobbered by a stale save from an open tab.

## 2. Frontend — load/save/dirty (`requestStore`, `lib/api.ts`)

- `api.ts` gains `getRequest` and `updateRequest` wrappers (same `invoke` pattern as the rest).
- `OpenRequest` gains `path: string[]` (needed to address the file) and `dirty: boolean`.
- **View/open:** clicking a request in the tree calls `api.getRequest` and populates the panel with saved content. If the tab is already open, just activate it (in-memory edits preserved).
- **Save:** `saveRequest(id)` calls `api.updateRequest`, clears `dirty`, and patches method/url on the matching `collectionStore` node so the sidebar method badge updates. **Cmd+S** saves the active request (keydown listener at panel level).
- **Dirty tracking:** the central `patch()` helper in `requestStore` sets `dirty: true` on any content mutation; `activeTab` changes are excluded.

## 3. Create — inline UX in the tree (`CollectionTree.tsx`, `Sidebar.tsx`)

Reuse the existing `pendingCreation` mechanism, extended with `kind: "folder" | "request"`:

- Context menu "New Request" → inline input inside the folder, prefilled "New Request" (text preselected), with a `GET` method badge instead of the folder icon. Enter commits → `addRequest` (GET, empty url) → opens the new request in the panel. Esc cancels with no creation.
- Sidebar `+` icon → same inline creation targeting the first collection's root; no-op when there are no collections.

## 4. Delete + dirty-tab close

- Delete (existing context-menu action) additionally closes the request's tab if it is open.
- Closing a dirty tab shows a confirmation dialog — "Discard changes?" with Cancel / Discard. Dirty tabs show a dot indicator in the tab strip.

## 5. Testing

- **Rust:** roundtrip test (`create_request → update_request → get_request` returns the saved content); backward-compat test (old minimal file without new fields still parses and lists).
- **Vitest:** `requestStore` dirty semantics — content mutation sets dirty, save clears it, `activeTab` change does not set it.
- **Manual:** full flow in `pnpm tauri dev` — create inline (Enter/Esc), edit + Cmd+S, reopen loads saved data, delete closes tab, dirty-close confirmation.

## Out of scope

- Sending requests / response panel wiring.
- SOAP request content persistence beyond what exists today.
- Auto-save, save-all, or "Save & Close" in the discard dialog.
