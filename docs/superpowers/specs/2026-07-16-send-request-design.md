# Send Request (MVP, reqwest shortcut) — Design

**Date:** 2026-07-16
**Status:** Approved
**Feature:** F3 — Send request (`docs/product.md`), build step 3 (`docs/architecture.md`), ADR-005 MVP shortcut

## Goal

Make the Send button work: fire the active request from the request panel through a
Rust HTTP engine and render the real response in the response panel. This is the first
end-to-end request flow in the app.

## Scope

**In:**
- Method + URL + enabled params + enabled headers.
- Body modes: `json` (raw string) and `form-urlencoded`.
- Auth: `basic`, `bearer`, `apikey` (header or query).
- Loading state, manual cancel, fixed 30s timeout.
- Response: status, status text, total time, size, headers, body — rendered by the
  existing `ResponsePanel` components.

**Out (documented future demand):**
- **Instrumented hyper engine** (ADR-005 full decision): hyper + hickory-resolver +
  tokio-rustls with connector decorator stamping DNS/TCP/TLS/TTFB/download. Replaces
  the reqwest engine behind the same `send_request` command and response shape.
  Delivers the real waterfall and phase-precise errors required by F3's error paths.
- **Multipart file upload** (`form-multipart` with file parts): needs a file picker and
  fs plumbing that don't exist yet. Sending a multipart body returns a clear
  "not supported yet" error.
- **`{{var}}` interpolation** from the active environment (F4): its own follow-up.
- **Rust-side cancellation**: MVP cancel discards the result on the frontend; the 30s
  timeout bounds the worst case. A real abort token arrives with the instrumented engine.

## Architecture

```
UrlBar (Send/Cancel) ──> responseStore.send(request)
                              │  lib/api.ts sendRequest(spec)
                              ▼
                    commands::send_request (thin, async)
                              │
                              ▼
                    engine::send (reqwest, rustls only)
                              │
                              ▼
                    HttpResponse { status, statusText, timeMs, sizeBytes, headers, body }
                              │
ResponsePanel <── responseStore.responses[requestId]
```

## Rust — `engine/` module (new)

- `src-tauri/src/engine/mod.rs`. The only place that speaks HTTP.
- Input `SendSpec` (serde): `method`, `url`, `params: Vec<KeyValue>`,
  `headers: Vec<KeyValue>`, `body: RestBody`, `auth: AuthConfig` — mirroring the
  existing TS types in `src/lib/request-types.ts`.
- Output `HttpResponse` (serde, camelCase): `status`, `status_text`, `time_ms`,
  `size_bytes`, `headers: HashMap<String, String>`, `body: String` — matching
  `src/lib/response-types.ts` exactly.
- Request building:
  - Enabled params merged into the URL query (preserving any query already typed in
    the URL).
  - Enabled headers set verbatim.
  - Auth applied: basic → `Authorization: Basic <b64>`, bearer →
    `Authorization: Bearer <token>`, apikey → header or query per `addTo`.
  - Body: `json` → raw string with `Content-Type: application/json` unless the user
    set a Content-Type header; `form-urlencoded` → encoded enabled pairs;
    `form-multipart` → `Err("multipart is not supported yet")`.
- reqwest with `default-features = false`, features `rustls-tls`, `gzip`, `json`.
  Redirects follow reqwest's default policy (up to 10). **Never native-tls/OpenSSL.**
- 30s total timeout. Errors mapped to a user-readable `String` (DNS/connect/TLS/timeout
  as reqwest reports them; phase-precise attribution comes with the real engine).
- `time_ms` measured with `Instant` around the call; `size_bytes` = response body length.

## Rust — command

- `commands::send_request(spec: SendSpec) -> Result<HttpResponse, String>`, `async`,
  thin: delegates to `engine::send`. Registered in `lib.rs`.

## Frontend

- `lib/api.ts`: `sendRequest(spec): Promise<HttpResponse>` wrapper (existing pattern:
  hand-typed `invoke`).
- **New `store/responseStore.ts`** (zustand):
  - `responses: Record<string, ResponseEntry>` keyed by request id.
  - `ResponseEntry`: `{ state: "loading" | "done" | "error"; response?: HttpResponse; error?: string }`.
  - `send(request: OpenRequest)`: builds the spec from the open request, sets
    `loading`, invokes, writes `done`/`error`. A per-request send sequence number
    guards against stale results: a response from an older or cancelled send never
    overwrites a newer entry.
  - `cancel(id)`: bumps the sequence number and clears the loading entry; the late
    result is discarded on arrival.
  - `clear(id)`: removes the entry (called when a tab closes).
- `UrlBar`/`RequestPanel`: Send button dispatches `send(activeRequest)`; while that
  request is loading it renders as Cancel and dispatches `cancel(id)`.
- `ResponsePanel`: drop `STATIC_FIXTURE`; read the entry for the active request id.
  - no entry → existing `ResponsePlaceholder`
  - `loading` → spinner state
  - `error` → error panel (message in error tone, same layout family as placeholder)
  - `done` → existing status bar + body/headers tabs. Timing tab shows total time only
    with a note that the per-phase waterfall is coming.
- Closing a tab (existing `requestStore` close path) also calls `clear(id)`.

## Error handling

- Engine/network errors surface as the `error` entry state with the reqwest message.
- Multipart body → error entry with the explicit "not supported yet" message.
- Timeout → error entry ("request timed out after 30s").
- Invalid URL → error entry before/at send.

## Testing (TDD — tests first for every step)

- **Rust** (`cargo test`): request building — params merged with existing query,
  disabled rows skipped, each auth type applied, each body mode (incl. multipart
  rejection), header override of default Content-Type. Assert on the built
  `reqwest::Request`; an end-to-end test against a local listener for
  status/headers/body/timing plumbing.
- **Vitest**: `responseStore` — loading→done, loading→error, cancel discards late
  result, stale-response guard (older send resolving after newer), `clear` on tab
  close.
