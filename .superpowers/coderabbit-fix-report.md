# CodeRabbit fix report — send-history review findings

Branch: `feat/request-history`
Worktree: `/Users/juancarlos/code/witch/.worktrees/send-history-spec`

## Commit 1 — `fix(history): address review findings on error paths, a11y and lifecycle`
Hash: `783bfc8`

1. **`src-tauri/src/persistence/history.rs` — `get()`**: `map_err` now matches on
   `rusqlite::Error`: only `QueryReturnedNoRows` becomes the "history entry {id}
   not found" message; any other error is wrapped with `anyhow::Error::new(e)
   .context(...)` and propagated. No test broke (`get_missing_entry_is_an_error`
   still passes — the fixture triggers `QueryReturnedNoRows`).

2. **`src-tauri/src/commands/mod.rs` — `record_history`**: the SQLite append now
   runs in `tauri::async_runtime::spawn_blocking`, fire-and-forget (not awaited).
   Early `request_id`/`data_dir` checks stay synchronous; `result` is cloned
   (`HttpResponse: Clone` already derived) and moved into the closure along with
   `spec` and the owned `request_id`. Signature unchanged, so both call sites
   (`send_request`, `send_soap`, `send_soap_raw`) needed no edits.

3. **`src/store/requestStore.ts` — `closeRequest`**: drawer close is now scoped —
   `if (useHistoryStore.getState().openFor === id) useHistoryStore.getState().close();`
   — `backToLive(id)` stays unconditional.

4. **`src/store/historyStore.ts` — `clear()`**: guards
   `if (get().openFor !== requestId) return;` after the `await`, before clearing
   `entries` (mirrors `refresh`).

5. **Failed-entry viewing**: `viewing` is now
   `Record<string, { response: HttpResponse | null; error: string | null }>`.
   `view()` always sets both fields from the fetched entry
   (`entry.response ?? null`, `entry.error ?? null`). `ResponsePanel.tsx`:
   added a `ViewingBanner` component (extracted from the old inline banner) and
   an early return for `viewing.error != null` that renders `ErrorView` (now
   accepts an optional `banner` prop) wrapped with the banner + "Back to live"
   button. Live/response viewing path unchanged in behavior.
   `responseStore.ts` `backToLive` usage untouched (signature unchanged).
   Tests: extended `historyStore.test.ts` (`viewing` shape) and added
   `loads the entry error for viewing when the send failed`.
   `HistoryDrawer.test.tsx` didn't assert `viewing` shape directly — no changes
   needed there.

6. **`src/components/response/HistoryDrawer.tsx` — keyboard a11y**: entry rows
   get `role="button"`, `tabIndex={0}`, `onKeyDown` (Enter/Space, `preventDefault`
   on Space) calling the same view action. Restore button now also reveals on
   `focus-visible:opacity-100` in addition to hover.

7. **Scratch requests — hide clock button**: `UrlBar.tsx` and `SoapUrlBar.tsx`
   render the history button only when `req.path.length > 0`.

8. **`src/store/responseStore.ts` — refresh open drawer after send settles**:
   after the final `set` (and only when not superseded), if `historyId != null`
   and the drawer is open for that request id, fires
   `void useHistoryStore.getState().refresh(id)`.

9. **`src/store/requestStore.ts` — `applyHistorySpec` soap branch**: compares
   restored `wsdlUrl`/`inputElement` against the current `req.soap.meta`. When
   they differ, sets `schema: null` synchronously and — after the state update —
   calls `api.getOperationSchema(wsdlUrl, inputElement)`, mirroring
   `openRequest`'s fetch-and-reconcile pattern (re-checks the request is still
   open/still SOAP before writing `schema` back; logs and swallows errors on
   failure). Restored `value` (from history) is preserved rather than reset to
   `defaultFormValue(schema)`, since it was captured against the exact operation
   being re-fetched. When wsdlUrl+inputElement are unchanged (the common case),
   the existing schema is kept and no fetch happens.
   Added `getOperationSchema: vi.fn().mockResolvedValue(undefined)` to the
   `../lib/api` mock in `requestStore.test.ts`, extended the existing SOAP-form
   restore test, and added two new tests: different-operation nulls schema +
   calls the fetch with the right args; same-operation keeps the schema and
   skips the fetch.

## Commit 2 — `docs(history): send_soap_raw capture, plaintext storage note and fence language`
Hash: `d3a0c09`

10. `docs/superpowers/specs/2026-07-25-send-history-design.md`: §1 now says
    "REST (`send_request`) and both SOAP send paths (`send_soap`,
    `send_soap_raw`)"; §5 now lists all three commands as gaining
    `request_id`; §10's order line now names `send_soap_raw` alongside the
    other two. Added a **Security model** paragraph at the end of §8: history
    stores request snapshots (including auth) in plaintext SQLite, consistent
    with ADR-011's plaintext request files (local-first); keychain-backed
    storage is out of scope for MVP — a deliberate, reviewed decision.
11. `docs/superpowers/plans/2026-07-25-send-history.md`: the rusqlite Cargo.toml
    snippet in Task 7 Step 1 is now fenced with ` ```toml ` instead of a bare
    fence.

## Verification

- `cd src-tauri && cargo test`: **89 passed**, 0 failed.
- `cargo fmt --check`: clean (fmt did reflow the new `spawn_blocking` block once,
  before the commit — already reflected in the committed diff).
- `cargo clippy -- -D warnings`: clean, 0 warnings.
- `pnpm test -- --run` (repo root): **77 passed** (12 test files), 0 failed.
- `npx tsc --noEmit`: clean, 0 errors.

## Commit hashes

- `783bfc8` — `fix(history): address review findings on error paths, a11y and lifecycle`
- `d3a0c09` — `docs(history): send_soap_raw capture, plaintext storage note and fence language`
