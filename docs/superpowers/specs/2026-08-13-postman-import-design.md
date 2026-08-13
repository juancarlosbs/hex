# Postman Collection Import — Design

**Date**: 2026-08-13
**Status**: Approved
**Feature**: "Import OpenAPI / Postman / cURL [R]" (docs/product.md, 🔵 v2) —
scope narrowed to Postman only, per explicit user confirmation to build
ahead of the documented roadmap priority.

## 1. Overview

Import a Postman Collection v2.1 JSON export (plus an optional Postman
Environment export) into a Hex collection: folders become `CollectionNode`
folders, requests become `RequestFile`s of kind `Rest`, and environment
variables become a Hex `Environment`. The flow mirrors the existing WSDL
import pattern: parse → preview (with a summary of anything that couldn't be
mapped) → user confirms → written to disk.

## 2. Goals / Non-goals

**Goals**

- Import a Postman v2.1 collection JSON file (local file picker) into a new
  Hex collection, preserving folder nesting 1:1, no depth limit.
- Optionally import a Postman Environment JSON file alongside it into a Hex
  `Environment`.
- Map headers, query params, and the three supported auth types
  (Basic/Bearer/API Key) faithfully.
- Map body: `urlencoded`/`formdata` → existing `form-urlencoded`/
  `form-multipart` modes; `raw` (any raw language) and `graphql` → new `raw`
  body mode reusing the existing text/JSON editor.
- Show the user a plain-language summary of anything skipped (unsupported
  auth type, unsupported body mode, scripts) before they confirm the import.

**Non-goals (YAGNI)**

- Postman Collection v1 or v2.0 — only v2.1.
- Importing via URL — file picker only (no fetch-by-URL step like WSDL has).
- OAuth2, AWS Signature, Digest, Hawk, NTLM auth — unsupported, reported as
  skipped.
- Pre-request / test scripts — unsupported, reported as skipped.
- `file` body mode — unsupported, reported as skipped.
- A generic pluggable "importer" abstraction for future formats
  (OpenAPI, cURL) — only Postman is being built now; do not generalize ahead
  of a second concrete need.
- Re-sync / diff-based update of an already-imported Postman collection
  (WSDL has this via `preview_definition_update`/`apply_definition_update`;
  Postman collections don't carry a stable "definition URL" to diff against
  in this flow, since import is file-based, not URL-based).

## 3. Backend — `src-tauri/src/postman/`

Mirrors `wsdl/`'s `parse` → `resolve`/`xsd` pipeline shape, minus the network
fetch/import-resolution step (a Postman export is a single self-contained
JSON file, no cross-file `$ref`s to resolve).

### `parse.rs`

Deserializes the raw JSON (via `serde`) into internal structs matching the
Postman v2.1 schema subset needed:

```rust
struct PostmanCollection {
    info: PostmanInfo,          // name
    item: Vec<PostmanItem>,     // recursive: request or nested folder
}

enum PostmanItem {
    Folder { name: String, item: Vec<PostmanItem> },
    Request { name: String, request: PostmanRequest },
}

struct PostmanRequest {
    method: String,
    url: PostmanUrl,            // raw string or {raw, query: [...]}
    header: Vec<PostmanKeyValue>,
    body: Option<PostmanBody>,
    auth: Option<PostmanAuth>,
}

struct PostmanBody {
    mode: String,                // "raw" | "urlencoded" | "formdata" | "graphql" | "file"
    raw: Option<String>,
    options: Option<PostmanRawOptions>, // raw.language, for informational use only
    urlencoded: Option<Vec<PostmanKeyValue>>,
    formdata: Option<Vec<PostmanKeyValue>>,
    graphql: Option<PostmanGraphql>,     // { query, variables }
}

struct PostmanAuth {
    kind: String,                 // "basic" | "bearer" | "apikey" | anything else
    // per-type fields extracted from Postman's key/value array shape
}
```

Parse errors (malformed JSON, missing `info`/`item`) surface as a single
`String` error to the command layer — same convention as `wsdl::parse`.

### `map.rs`

Pure transform, no I/O:

```rust
pub fn map_collection(pc: PostmanCollection) -> (String, Vec<CollectionNode>, Vec<RequestFile>, ImportSummary);

pub struct ImportSummary {
    pub skipped: Vec<String>, // human-readable lines, e.g.
                               // "Request \"Get Token\": OAuth2 auth not supported, imported without auth"
                               // "Request \"Upload\": file body not supported, body left empty"
}
```

Mapping rules:

- **Folders**: `PostmanItem::Folder` → `CollectionNode::Folder { id: new_uuid, name, children }`, recursively, no depth limit.
- **Requests**: `PostmanItem::Request` → `CollectionNode::Request(...)` + a `RequestFile { kind: RequestKind::Rest { method, url }, params, headers, body, auth }`.
- **URL**: Postman's `url.raw` used as-is (including any `{{variable}}` placeholders — imported literally, resolved later if the user creates a matching Hex environment variable with the same name). Query params from `url.query` merge into `params: Vec<KeyValueEntry>`.
- **Headers**: `header[]` → `headers: Vec<KeyValueEntry>`, `disabled` → `enabled: !disabled`.
- **Auth**:
  - `basic` → `AuthData::Basic { username, password }`
  - `bearer` → `AuthData::Bearer { token }`
  - `apikey` → `AuthData::Apikey { key, value, add_to }` (Postman's `in: "header" | "query"` maps to `add_to`)
  - anything else (including absent/`noauth`) → `AuthData::None`; if it was a recognized-but-unsupported type, add a line to `ImportSummary.skipped`
- **Body**:
  - `urlencoded` → `BodyData { mode: "form-urlencoded", form: [...] }`
  - `formdata` → `BodyData { mode: "form-multipart", form: [...] }`
  - `raw` → `BodyData { mode: "raw", json: raw_text }` (the `json` field is reused as the generic text payload field; see §4 for the `raw` mode addition)
  - `graphql` → `BodyData { mode: "raw", json: graphql.query }` (variables, if present, appended below the query as a comment block — simplest faithful representation; GraphQL isn't a first-class body type in Hex)
  - `file` → `BodyData { mode: "raw", json: "" }`, add a skipped line
  - absent → `None`

### `map_environment.rs`

```rust
pub fn map_environment(pe: PostmanEnvironment) -> Environment;
```

Postman Environment JSON is `{ name, values: [{ key, value, enabled }] }`.
Hex's `Environment` (`domain/env.rs`) is `{ id, name, variables: BTreeMap<String, String> }`
— no per-variable enabled flag. Mapping: `id: new_uuid`, `name` copied as-is,
`variables` built from `values` keeping only `enabled: true` entries
(`key` → map key, `value` → map value). Disabled entries are dropped —
Hex has no equivalent flag, and adding one just for this import is out of
scope.

## 4. Domain change — `raw` body mode

Postman's `raw` (any language: json/text/xml/html/javascript) and `graphql`
bodies don't fit the existing `json` / `form-urlencoded` / `form-multipart`
modes, all of which are meaningfully structured. Rather than force raw XML
or plain text through the JSON editor (wrong syntax highlighting, and
semantically misleading), add a fourth mode:

- **Rust**: no change needed — `BodyData.mode` is already a plain `String`.
- **`src/lib/request-types.ts`**: extend `BodyMode` to `"json" | "form-urlencoded" | "form-multipart" | "raw"`.
- **`ContentTypeDropdown.tsx`**: add a `raw` option (generic "Text" label/icon — Hex doesn't track Postman's original sub-language, so this isn't "XML" or "HTML" specifically, just raw text).
- **`BodyTab.tsx`**: add a render branch for `mode === "raw"` — reuse the existing plain-text editor component used for JSON (no JSON-specific validation/formatting applied).
- **`requestStore.ts:452`**: add `"raw"` to the normalization allow-list so it isn't coerced down to `"json"`.

This is the only domain/frontend change outside the new `postman/` module
and the import UI itself.

## 5. Commands (thin, tauri-specta)

Mirrors WSDL's preview/confirm pair:

| Command | Signature | Notes |
|---|---|---|
| `import_postman_collection` | `(collection_json: String, environment_json: Option<String>) -> Result<PostmanImportPreview, String>` | Parses + maps in memory. Nothing written to disk. |
| `confirm_postman_import` | `(workspace_id: String, preview: PostmanImportPreview) -> Result<(), String>` | Creates the collection, writes folders/requests, writes the environment if present. |

```rust
pub struct PostmanImportPreview {
    pub collection_name: String,
    pub nodes: Vec<CollectionNode>,
    pub requests: Vec<RequestFile>,
    pub environment: Option<Environment>,
    pub summary: ImportSummary,
}
```

Commands stay thin: read file content (frontend passes it as a string, see
§6 — no `fs` access inside the command beyond what `confirm` needs to
persist via `persistence::collection`), delegate to `postman::parse` +
`postman::map`, map errors to `String`. `confirm_postman_import` delegates
to the same `persistence::collection::create_collection` /
`create_request` helpers WSDL import already uses.

Regenerate `src/bindings.ts` after adding these.

## 6. Frontend

- **Entry point**: wherever the WSDL import action lives today (sidebar
  import menu/button), add a sibling "Postman Collection" option.
- **`ImportPostmanModal.tsx`** (mirrors `ImportWsdlModal.tsx`): two file
  pickers via the Tauri `dialog` + `fs` plugins — collection file
  (required), environment file (optional). Reads file content into strings
  client-side, no path crosses IPC as a path (matches the "no filesystem
  paths cross IPC" storage rule) — content strings are passed instead.
- **`postmanImportStore.ts`** (mirrors `wsdlImportStore.ts`): phase state
  machine `idle → loading → preview → error`. On file selection, calls
  `api.importPostmanCollection(collectionJson, environmentJson)`; on
  confirm, calls `api.confirmPostmanImport(workspaceId, preview)`, then
  reloads `collectionStore` (and the environment list, if one was imported).
- **Preview screen**: collection name, counts (X requests, Y folders,
  environment imported: yes/no), and the `summary.skipped` list rendered as
  plain text lines — this is the only UI surface for skipped items, no
  per-item interactive resolution.
- Async calls via wrappers in `lib/api.ts`, tokens only from
  `src/App.css`, CVA + `cn()` per component conventions.

## 7. Error handling

- Malformed/non-Postman JSON: `import_postman_collection` returns an error
  string; modal shows it inline, no preview shown.
- Environment file provided but malformed: the whole import fails with an
  error (don't partially import the collection without the environment the
  user asked for) — simpler than a partial-success state for a v2 feature.
- Empty collection (`item: []`): valid, imports a collection with zero
  requests — no special-cased error.
- `confirm_postman_import` failing partway through (disk write): same
  failure mode as WSDL's `confirm_wsdl_import` today — not idempotent, no
  rollback. Out of scope for this feature to solve what WSDL import doesn't
  solve either.

## 8. Testing

**Rust** (`postman/parse.rs`, `postman/map.rs`, temp-dir for any
persistence-touching test):

- fixture: a small hand-written Postman v2.1 collection JSON
  (`postman/testdata/sample_collection.json`, analogous to
  `wsdl/testdata/calculator.wsdl`) covering: nested folders, all three
  supported auth types, `raw`/`urlencoded`/`formdata`/`graphql`/`file` body
  modes, disabled headers.
- `parse` deserializes the fixture without error.
- `map_collection` produces the expected folder nesting, request count, and
  auth/body mappings.
- unsupported auth/body produces the expected `ImportSummary.skipped` lines.
- `map_environment` maps a sample environment fixture, drops disabled vars.

**Vitest**: not planned for MVP of this feature — the modal mirrors
`ImportWsdlModal`'s existing (untested or lightly tested) pattern; verify
manually via `pnpm tauri dev` per project convention for frontend changes.

**E2E**: not needed — Rust unit tests cover the parsing/mapping logic, which
is where the real risk is.

## 9. Implementation order

1. `postman/parse.rs` + `postman/map.rs` + `postman/map_environment.rs` + Rust tests + fixtures
2. `raw` body mode: `request-types.ts`, `ContentTypeDropdown.tsx`, `BodyTab.tsx`, `requestStore.ts` normalization
3. Commands (`import_postman_collection`, `confirm_postman_import`) + regenerate bindings
4. `ImportPostmanModal.tsx` + `postmanImportStore.ts` + entry point in the import menu
5. Manual verification via `pnpm tauri dev` with a real Postman export
