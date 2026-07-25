# Send History per Request — Design

**Date**: 2026-07-25
**Status**: Approved
**Feature**: "Send history per request" (docs/product.md §3, 🟢 MVP)

> Supersedes the minimal implementation on the old `feat/send-history` branch
> (JSONL + History tab, metadata only). That branch is discarded; this design
> starts fresh from `main`.

## 1. Overview

Every Send of a saved request is recorded: a snapshot of what was sent, the
full response (status, headers, body, per-phase timing), or the error if the
send failed. A clock button on the request bar opens a drawer listing past
executions. Clicking an entry shows its saved response in the Response Panel;
an explicit **Restore** action loads the request snapshot back into the editor.

Applies to both REST (`send_request`) and SOAP (`send_soap`).

## 2. Goals / Non-goals

**Goals**

- Persist the last **50** executions per request (older ones pruned).
- View a past response (Body / Headers / Timing) without touching the current draft.
- Restore a past request spec into the editor, with confirmation when the draft differs.
- Failed sends are recorded too, with the error message.

**Non-goals (YAGNI)**

- Cross-request / global history search.
- Diffing two executions.
- Exporting history.
- History for unsaved (scratch) requests — no `request_id`, nothing to attach to.

## 3. Data model — SQLite

One database at `app_data_dir/history.db`, one table:

```sql
CREATE TABLE IF NOT EXISTS history (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id    TEXT NOT NULL,
  executed_at   TEXT NOT NULL,          -- ISO 8601 UTC
  spec_json     TEXT NOT NULL,          -- SendSpec snapshot (for Restore)
  response_json TEXT,                   -- HttpResponse (status, headers, body, timing)
  error         TEXT                    -- set when the send failed
);
CREATE INDEX IF NOT EXISTS idx_history_request ON history(request_id, id DESC);
```

- `response_json` and `error` are mutually exclusive; exactly one is set.
- Response bodies larger than **1 MB** are truncated before saving; the stored
  JSON carries a `truncated: true` flag so the UI can say so.
- Pruning: after each insert, delete rows for that `request_id` beyond the 50
  newest (by `id`).

## 4. Persistence layer

`src-tauri/src/persistence/history.rs`, using **`rusqlite`** (bundled feature —
rustls rule untouched, no native TLS involved).

> **Divergence from `docs/stack.md`**: stack.md lists `tauri-plugin-sql` as the
> optional history backend. That plugin exposes SQL to the *frontend*, which
> would violate the architecture rule that `persistence/` is the only layer
> touching the data filesystem, and would move persistence logic into the
> webview. We keep SQLite (per ADR-011) but drive it from Rust with `rusqlite`.
> Update stack.md in the implementing PR.

API (same shape as `collection.rs` helpers — plain functions over a data dir):

```rust
pub fn append(db: &Path, request_id: &str, entry: NewEntry) -> anyhow::Result<()>;   // insert + prune to 50
pub fn list(db: &Path, request_id: &str) -> anyhow::Result<Vec<HistoryEntrySummary>>; // newest first, no bodies
pub fn get(db: &Path, entry_id: i64) -> anyhow::Result<HistoryEntry>;                 // full row
pub fn clear(db: &Path, request_id: &str) -> anyhow::Result<()>;
```

Connections are opened per call (`Connection::open`); no pool. Volume is one
write per Send and reads on drawer open — SQLite handles this trivially.

## 5. Capture

`send_request` and `send_soap` gain an optional `request_id: Option<String>`
parameter. After the send resolves — success **or** error — the command appends
a history entry, then returns the original result. `request_id: None` (unsaved
request) skips recording. No separate "record" command; recording happens where
the send happens, in one place per protocol.

A history write failure must not fail the send: log it, return the response.

## 6. Commands (thin, tauri-specta)

| Command | Returns | Notes |
|---|---|---|
| `list_history(request_id)` | `Vec<HistoryEntrySummary>` | id, executedAt, status, durationMs, sizeBytes, error — no bodies |
| `get_history_entry(id)` | `HistoryEntry` | full spec + response, loaded on demand |
| `clear_history(request_id)` | `()` | |

Regenerate `src/bindings.ts` after adding them.

## 7. UI — history drawer

- **Trigger**: clock icon button on the request bar (next to Send).
- **Drawer**: slides over the Response Panel from the right. List of entries:
  method + status badge (or error badge) + relative timestamp + duration.
  Footer action: "Clear history" (with confirm).
- **Click an entry**: loads the saved response into the Response Panel — the
  existing Body / Headers / Timing tabs work as-is, with a visible "viewing
  history" indicator and a way back to the live response. Current editor draft
  is untouched.
- **Restore** (explicit button per entry): loads the entry's `spec_json` into
  the editor. If the current draft differs from the saved request, confirm
  before overwriting.
- State in a `useHistoryStore` (zustand): open/closed, entries, selected entry.
  Async calls via wrappers in `lib/api.ts` over the generated bindings.
- Tokens only from `styles/tokens.css`; CVA + `cn()` per component conventions.

## 8. Error handling

- Send fails before HTTP (DNS/connect): entry saved with `error`, no response.
- History DB unavailable/corrupt: sends still work (see §5); drawer shows an
  empty state with the error.
- Entry deleted between list and get: `get_history_entry` returns a not-found
  error; drawer refreshes the list.

## 9. Testing

**Rust** (`persistence/history.rs`, temp-dir DB, same pattern as `collection.rs` tests):

- append then list returns the entry, newest first
- prune: 51st insert drops the oldest
- body over 1 MB is truncated and flagged
- failed send stores `error` and no response
- clear empties only that request's history

**Vitest**:

- drawer renders entries from the store
- clicking an entry selects it and loads the saved response into the response store
- Restore with a dirty draft asks for confirmation

**E2E**: not needed for MVP; the Rust + component layers cover the flow.

## 10. Implementation order

1. `persistence/history.rs` + rusqlite dep + Rust tests
2. Capture in `send_request` / `send_soap` + new commands + regenerate bindings
3. Drawer UI + stores + wrappers + Vitest
4. stack.md update (rusqlite note) + product.md checkbox
