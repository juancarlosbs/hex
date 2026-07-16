# Request Panel — Guide

> How to use the REST request builder in Hex, and what each tab does. For the design
> tokens/layout rules see `docs/ui.md`; for the domain model behind requests see
> `docs/domain-model.md`.

Status: UI-complete (`feat/request-panel` branch). **`Send` is a no-op until the engine
plan lands.** File picker in multipart is stubbed to a fake filename.

---

## 1. Where it lives

Central pane between the fixed 264px Sidebar and the resizable Response placeholder.

```
┌─────────┬───────────────────────────┬───────────────────┐
│ Sidebar │ Request Panel             │ Response          │
│ 264px   │  UrlBar                   │  (placeholder)    │
│         │  Params · Body · Headers  │                   │
│         │       · Auth              │                   │
└─────────┴───────────────────────────┴───────────────────┘
```

- Sidebar width is fixed (`w-[264px]`). Only Request↔Response is user-resizable.
- Every open request lives in `useRequestStore` (`src/store/requestStore.ts`).

---

## 2. Opening a request

Click a REST request in the Sidebar tree. `CollectionTree` calls `openRequest(id, name, method)`
on `useRequestStore` and sets it active. The Request Panel picks it up and renders. Selecting a
SOAP operation is a no-op here — SOAP is a separate plan.

Closing / switching between multiple open requests isn't wired to the titlebar tabs yet
(follow-up in the plan). The store exposes `closeRequest(id)` when we get there.

---

## 3. UrlBar

`MethodDropdown` + URL input + Send button.

| Control | Behavior |
|---|---|
| Method | Click to open the list, pick GET/POST/PUT/DELETE/PATCH/HEAD/OPTIONS. Color per token (`--color-method-*`). |
| URL    | Free-form input; monospace. Environment interpolation (`{{var}}`) is not applied yet. |
| Send   | UI only. Wiring to Rust `send_request` command lives in the engine plan. |

---

## 4. Tabs

Counter badges show non-zero counts on **Params** and **Headers** in the tab strip.

### 4.1 Params

Query parameters appended to the URL. Three columns: KEY, VALUE, DESCRIPTION. Toggle a row
off to skip it without deleting.

Use when: you want `?page=1&limit=20`-style query on a REST call. Server-side "search
this collection" endpoints. Anything that belongs in the URL, not the body.

### 4.2 Body

Toolbar has a `ContentTypeDropdown` with three modes:

| Content-Type | Use when | Notes |
|---|---|---|
| `application/json` | Modern REST (`POST /users`, `PATCH /orders/{id}`). Default. | Editor is a plain textarea. Beautify icon runs `JSON.parse` → `stringify(_, null, 2)`; no-op on invalid JSON. |
| `application/x-www-form-urlencoded` | Legacy form endpoints, OAuth token grants (`grant_type=client_credentials`). | KEY/VALUE rows only. |
| `multipart/form-data` | File upload endpoints; mixed text + binary. | Row-level TYPE picker: `Text` or `File`. File cell shows a purple chip; clicking the empty slot sets a **stub filename** until the file picker is wired. |

Rows in the form editors are stored under `body.form` in the store; switching between
urlencoded and multipart keeps the rows.

### 4.3 Headers

KEY/VALUE table. Below the user rows, three **auto-generated headers** are shown locked
(cadeado): `Host`, `Content-Type`, `User-Agent`. They can be hidden via the eye-off toggle,
but not edited — the engine will populate them at send time.

Use when: setting `Accept`, `Authorization`, custom app headers (`X-Trace-Id`, etc.).
Don't add `Host` or `Content-Type` manually; they're derived.

### 4.4 Auth

Type dropdown at the top switches between four bodies:

| Type | Fields | When |
|---|---|---|
| **No Auth** | — | Public endpoints. |
| **Basic** | Username + Password (masked, eye toggle) | Legacy APIs, `httpauth`, some SOAP services. |
| **Bearer** | Token (masked). Preview line shows `Authorization: Bearer <first 12 chars>…`. | OAuth2 access tokens, JWTs, most modern APIs. |
| **API Key** | Key + Value + Add-to: `Header` or `Query` | Vendor-specific keys (`X-API-Key: …`, `?apiKey=…`). |

Auth config is stored as a discriminated union (`AuthConfig` in `src/lib/request-types.ts`) —
switching types resets fields on purpose.

---

## 5. What's not wired yet

| Deferred | Where it goes |
|---|---|
| `Send` → Rust engine | Engine plan (`send_request` command) |
| Multipart file picker | `@tauri-apps/plugin-dialog` in the engine plan |
| JSON syntax highlighting | Swap textarea for `@uiw/react-codemirror` + `lang-json` (polish milestone) |
| Titlebar tabs bound to `openRequests` | Titlebar refactor (currently static list in `Titlebar.tsx`) |
| SOAP `SchemaForm` (Params tab replaced by schema-driven form) | Separate plan — see `docs/soap-engine.md` |
| Env variable `{{var}}` interpolation | Domain layer (`domain/env.rs`); see `docs/domain-model.md` §6 |

Anywhere the current code makes a deliberate compromise, it's marked with `// ponytail:`
and points at the upgrade path.

---

## 6. File map (extending it)

```
src/
  lib/request-types.ts        # HttpMethod, KeyValue, RestBody, AuthConfig, OpenRequest
  store/requestStore.ts       # useRequestStore + all mutators
  components/
    CentralPanel.tsx          # 3-pane layout: fixed Sidebar + resizable Request/Response
    request/
      RequestPanel.tsx        # tab router — reads activeId + activeTab
      RequestEmpty.tsx        # empty state
      UrlBar.tsx              # method + URL + Send
      MethodBadge.tsx         # color pill (used by sidebar too)
      MethodDropdown.tsx      # method picker
      RequestTabsStrip.tsx    # Params/Body/Headers/Auth
      KeyValueTable.tsx       # shared K/V rows (Params, Headers, urlencoded body)
      ContentTypeDropdown.tsx # body-mode picker
      ParamsTab.tsx           HeadersTab.tsx
      body/
        BodyTab.tsx           BodyJsonEditor.tsx   BodyFormEditor.tsx
      auth/
        AuthTab.tsx           # None / Basic / Bearer / API Key
    response/
      ResponsePlaceholder.tsx # static empty state until Response Panel plan lands
```

To add a new body mode: extend `BodyMode` in `request-types.ts`, add an option to
`ContentTypeDropdown`, and add a branch in `BodyTab`. To add a new auth type: extend
`AuthType` + `AuthConfig`, add a body renderer in `AuthTab`, and a `defaultForType` case.
