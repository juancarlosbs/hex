# F6 — Update Definition (design)

Re-fetch a service's WSDL, diff its operations against the imported collection,
and apply the changes. Saved requests whose operations were removed are never
deleted — they become orphans (product.md F6).

## UX flow

- Context-menu item **Update Definition** on a root collection that contains
  SOAP requests (an imported service).
- Default: a **diff preview modal** — loading state → three sections (new /
  changed / removed → orphaned) → Confirm / Cancel. Fetch or parse errors render
  in the modal with the same clarity rules as F2 (which URL failed and why).
  "Nothing changed" renders a message with only an OK button.
- Settings toggle **"Apply definition updates without preview"** (default off).
  When on, preview + apply run chained and the same modal opens directly in a
  summary state ("applied: X new, Y changed, Z orphaned"). No toast dependency.

## Backend (Rust)

### Domain — pure diff

`domain/wsdl.rs`: `diff_operations(existing, fresh) -> DefinitionDiff`.
Operations match by name. `changed` means any difference in endpoint,
soapAction, soapVersion, or inputElement.

```rust
DefinitionDiff {
    new: Vec<OperationRef>,
    changed: Vec<ChangedOperation>, // { name, fresh: OperationRef }
    removed: Vec<String>,
    unchanged: u32,
}
```

### Commands — preview/apply pair (mirrors import_wsdl → confirm_wsdl_import)

- `preview_definition_update(workspace_id, collection_id) -> DefinitionUpdatePreview`
  — finds the `wsdlUrl` on the first SOAP request inside the collection (zero
  migration; works for collections imported before this feature), re-fetches
  through the same fetch → parse → resolve pipeline as import, returns
  `{ service_name, wsdl_url, diff }`.
- `apply_definition_update(workspace_id, collection_id, preview)` — applies the
  previewed diff (persistence layer does the work; command stays thin).

### Persistence — apply (`persistence/collection.rs`)

- **New** operations → create a request at the collection root. If an orphan
  with the same operation name exists in the Orphans folder, restore it instead
  (move back to the root, clear the orphan flag) — never duplicate.
- **Changed** operations → rewrite only the SOAP metadata fields in the request
  TOML (endpoint, soapAction, soapVersion, inputElement), preserving params,
  headers, body, auth, and the request name.
- **Removed** operations → ensure an `Orphans` folder exists in the collection,
  move the request file into it, and set `orphan = true` on the request.
- Orphan marker: `orphan: Option<bool>` on the `Soap` variant of `RequestKind`
  (serde default + skip-if-none — existing files stay valid, no migration).

## Frontend

- `CollectionTree.tsx`: context-menu action on root collections containing SOAP
  requests.
- New `UpdateDefinitionModal.tsx`: loading → diff sections → confirm/cancel;
  error and summary states as described in UX flow.
- `SettingsDialog.tsx`: the skip-preview toggle.
- Sidebar: `orphan` badge on orphaned requests; the Orphans folder is a normal
  folder. Orphaned requests still open and send normally.
- `bindings.ts` regenerated with tauri-specta.

## Testing

- Rust: unit tests for `diff_operations` (new / changed / removed / unchanged)
  and for apply with a tempdir (create, metadata rewrite preserving user data,
  move to Orphans, restore from Orphans), following the existing collection.rs
  test style.
- Vitest: render `UpdateDefinitionModal` with a mocked diff (sections, empty
  diff, error state).

## Out of scope

- Migrating or regenerating saved form values when a schema changes — the form
  already reloads the fresh schema when opened.
- Blocking orphaned requests from sending.
- Updating multiple collections at once.
