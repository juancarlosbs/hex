# WSDL Import — Slice 1: parse + resolve (URL only) — Design

**Date:** 2026-07-17
**Status:** Approved
**Feature:** F2 — WSDL Import (`docs/product.md`), milestone 5 (`docs/architecture.md`), algorithm in `docs/soap-engine.md` §2.1–2.2

## Goal

Import a WSDL by URL: parse it, transitively resolve external `xsd:import`/`xsd:include`
schemas, show an operations preview in a modal, and on confirm persist the operations
as a collection in the sidebar. This is the first slice of the SOAP hero flow.

## Scope

**In:**
- `wsdl::parse` (pure): WSDL 1.1 → endpoint, SOAP version (1.1/1.2), soapAction per
  operation, input element QName → `Vec<OperationRef>`. Rejects rpc/encoded
  (`use="encoded"` or `style="rpc"`) with a clear error (ADR-010).
- `wsdl::resolve` (the only I/O): queue + URL dedup, fetches external
  `import`/`include` schemas (relative URLs resolved against the current document),
  produces a `SchemaSet` (namespace → schema source XML).
- Typed `WsdlError` naming WHICH url/schema failed and why. Never import partial
  results silently.
- `import_wsdl(url)` command → preview; `confirm_wsdl_import` → collection named after
  the service, one SOAP request node per operation, via existing
  `persistence::collection`.
- `ImportWsdlModal`: URL field → loading ("resolving schemas…") → operations preview →
  confirm → sidebar. Error rendered in the modal. Entry: button in the sidebar.

**Out (documented future demand):**
- **Local file as source**: WSDL from disk via the dialog plugin, with relative
  imports resolved against the file path. Slice explicitly requested for a follow-up.
- **XSD → `SchemaNode` traversal** (`wsdl::xsd`, soap-engine §2.3): slice 2. Until
  then, clicking an imported operation does NOT show its parameters — only the
  operation metadata exists. The persisted `input_element` QName + `wsdl_url` are
  the hooks slice 2 needs.
- **`SchemaForm` UI** (milestone 6): slice 3.
- **Instrumented HTTP engine**: deferred to a later phase (decided 2026-07-16;
  `product.md` waterfall entry re-marked 🔵). Fetching here uses the existing reqwest
  (rustls-only) dependency.
- **Persisting the `SchemaSet`**: slice 2 re-resolves schemas from `wsdl_url` when it
  needs them.

## Architecture

```
ImportWsdlModal ──> lib/api.ts importWsdl(url)
                        │
                        ▼
              commands::import_wsdl (thin, async)
                        │  fetch root (reqwest, rustls)
                        ▼
              wsdl::parse (pure, roxmltree) ──> Vec<OperationRef>
                        │
                        ▼
              wsdl::resolve (fetch imports/includes, dedup) ──> SchemaSet
                        │
                        ▼
              WsdlImportPreview { service_name, operations }
                        │ user confirms
                        ▼
              commands::confirm_wsdl_import ──> persistence::collection
                        │
CollectionTree <── collectionStore (new collection + SOAP request nodes)
```

## Rust

### `domain/wsdl.rs` (new, pure)

Types per `docs/domain-model.md`: `OperationRef { name, endpoint, soap_action,
soap_version, input_element: QName }`, `SoapVersion { V11, V12 }`, `QName`.

### `wsdl/` module (new)

- `parse.rs` — pure over already-fetched bytes. roxmltree: `<service>/<port>` →
  endpoint + binding name; `<binding>` → SOAP version by soap namespace prefix
  (`.../wsdl/soap/` = 1.1, `.../soap12/` = 1.2), validate doc/literal, soapAction per
  operation; portType → per-operation `<input>` → `<message>` → `<part>` → QName.
- `resolve.rs` — the ONLY place that fetches external schemas. Queue of pending
  schemas, set of already-fetched URLs (cuts include cycles), relative
  `schemaLocation` resolved against the current document URL. Fetch injected as a
  small trait/closure so tests run without network; production impl uses reqwest.
- `error.rs` — `WsdlError { Fetch { url }, InvalidXml { url }, UnsupportedStyle,
  ElementNotFound { qname }, MissingSchemaLocation }` with `thiserror`.

### Commands (thin)

- `import_wsdl(url) -> WsdlImportPreview { service_name, operations }`. No
  persistence.
- `confirm_wsdl_import(workspace_id, preview)` — creates the collection + one SOAP
  request node per operation. Node metadata: `endpoint`, `soap_action`,
  `soap_version`, `input_element`, `wsdl_url`.
- Regenerate `bindings.ts` (tauri-specta).

## Frontend

- `ImportWsdlModal.tsx` following the existing modal pattern (`AddWorkspaceModal`):
  states idle → loading → preview → error. CVA + `cn()`, tokens only.
- `lib/api.ts` wrappers `importWsdl` / `confirmWsdlImport`; result lands in
  `collectionStore` (existing `load`/insert path).
- Sidebar button opens the modal.

## Error handling

Per F2: any failure (root fetch, external schema 404/timeout, invalid XML,
rpc/encoded, missing schemaLocation) aborts the whole import and renders in the modal
with the offending URL/cause. No partial imports.

## Testing

- **Rust** (`src-tauri/tests/` fixtures): doc/literal happy path (1.1 and 1.2),
  rpc/encoded rejected, relative import resolved, external import 404 → `Fetch` with
  url, invalid XML → `InvalidXml`, include cycle terminates via dedup.
- **Vitest**: modal state transitions (loading/preview/error) following existing
  store-test patterns.

## Verification

Import a real public WSDL (e.g. dneonline calculator) end-to-end in `pnpm tauri dev`:
operations preview appears, confirm lands them in the sidebar, and a WSDL with a bad
import URL shows the failing URL in the modal.
