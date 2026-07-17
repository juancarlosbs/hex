# GET/HEAD requests must not use a body

Date: 2026-07-16 · Branch: `feat/send-request`

## Problem

The request panel lets the user edit and send a body regardless of HTTP method. GET and HEAD must not carry a body.

## Decision

Frontend-only enforcement (approach A). The Rust engine stays untouched — its only caller is the frontend, which filters before invoking. No redundant engine guard (see commit `3fc7a1e`).

## Behavior

- When the method is **GET or HEAD**, the **Body tab is disabled**: dimmed, not clickable, `title="GET/HEAD requests don't use a body"`.
- Switching the method to GET/HEAD while the Body tab is active falls back to the **Params** tab view.
- On **Send**, the body is replaced with `{ mode: "json", json: "", form: [] }` for GET/HEAD — the engine attaches nothing when `json` is empty, so nothing goes on the wire even if the store holds body content. (`BodyMode` has no `"none"` variant and the engine rejects unknown modes; an empty json body is the existing no-body representation.)
- Body content in the store is **preserved**; switching back to POST/PUT/etc. restores the tab and content untouched.

## Changes

| File | Change |
|---|---|
| `src/lib/request-types.ts` | `export const methodAllowsBody = (m: HttpMethod) => m !== "GET" && m !== "HEAD";` |
| `src/components/request/RequestTabsStrip.tsx` | Body button gets `disabled` + dimmed style when `!methodAllowsBody(method)` |
| `src/components/request/RequestPanel.tsx` | Render guard: `activeTab === "body" && !methodAllowsBody(method)` → render ParamsTab (and strip shows Params as active) |
| `src/store/responseStore.ts` | `body: methodAllowsBody(request.method) ? request.body : { mode: "json", json: "", form: [] }` |

## Testing

- `responseStore.test.ts`: sending a GET with json body content passes an empty json body to `api.sendRequest`.
- No component tests exist for the strip/panel today; none added (no new test infra).

## Out of scope

- Engine-side (Rust) guard.
- OPTIONS/DELETE body restrictions (spec-ambiguous; both keep allowing body).
- Warning banners or stripping stored body content.
