# Design — Bidirectional Form ↔ XML sync (SOAP request panel)

**Date:** 2026-07-21
**Status:** Approved (brainstorming) — pending implementation plan
**Branch:** `feat/wsdl-import`

## Problem

The SOAP request panel has a schema-driven **Form** view and an editable **XML**
view. Today the sync is one-directional:

- Form → XML: generated on demand via the `build_soap_envelope` command.
- XML → Form: **not implemented**. Editing the XML sets `soap.xmlDraft`; `Send`
  posts it raw; editing the form discards the draft.

We want it bidirectional: editing the form updates the XML, and editing the XML
updates the form.

## Constraint that shapes everything

The form can only represent what the operation's `SchemaNode` allows. Arbitrary
hand-edited XML (extra elements, a populated `soap:Header`, malformed markup)
cannot always map back to the form. The design must handle non-conforming XML
without silently losing the user's edits.

## Decisions (from brainstorming)

1. **Sync timing:** on **tab switch**, not live. Form → XML regenerates when the
   XML tab opens; XML → Form parses when the XML tab is left. Robust — parsing
   only runs on "finished" XML, never on half-typed intermediate markup.
2. **Non-conforming XML:** **raw fallback + warning**. If the edited XML parses
   and conforms to the schema, update the form and make it the source of truth
   again. If it does not, keep the XML as a raw draft (`Send` posts it raw),
   leave the form untouched, and show a warning. Never lose the edit.
3. **Where parsing lives:** **Rust**, reusing roxmltree + the `SchemaNode`. Never
   duplicate the schema↔XML mapping in TS — the Rust engine is the single source
   of truth (project rule: "the request engine runs in Rust").

Approach **A** (Rust deserializer) was chosen over a TS/DOMParser parser (would
fork the mapping) and a raw-only mode (not truly bidirectional).

## State model

The existing `soap.xmlDraft: string | null` is the axis:

- `xmlDraft === null` → **form is the source of truth**. Opening the XML tab
  regenerates the envelope from the form.
- `xmlDraft !== null` → hand-edited XML exists; `Send` posts it raw.

### Sync flow (tab-switch only)

1. **Form → XML** (open XML tab): if `xmlDraft === null`, regenerate from the
   form; otherwise show the stored draft so editing can continue.
2. **XML → Form** (leave XML tab, only when `xmlDraft !== null`): call
   `parse_envelope(xmlDraft, schema)`:
   - **success** → `setSoapValue(parsed)` (this already clears `xmlDraft`) → form
     is the source again; no warning.
   - **failure** → keep `xmlDraft` (raw mode) + record the error message.
3. **Edit the form** (`setSoapValue`) → clears `xmlDraft` (already implemented).
4. **Reset** (banner button) → `setSoapXmlDraft(id, null)` → form is the source;
   regenerate on next open.

A new store action `commitSoapXml(id): Promise<boolean>` orchestrates step 2
(parse, then set-value-or-keep-draft). The trigger is the `onViewChange`
handler in `RequestPanel` on the `xml → form` transition.

## Rust deserializer

New module `engine/deserialize.rs`, the inverse of `serialize.rs`. Thin command:

```rust
parse_envelope(envelope: String, schema: SchemaNode) -> Result<FormValue, String>
```

### Conformance rules (any failure → raw fallback)

- Parse with roxmltree; malformed → `Err`.
- Locate `soap:Body` by local name `Body` in the SOAP 1.1/1.2 namespace. Its
  single element child is the operation root; match it against `schema`.
- **Match by `(namespace URI, local name)`, ignoring prefixes** — robust to the
  user renaming `ns0:` / `pay:` etc.
- Walk the schema:
  - **leaf** → read element text (`xsi:nil="true"` → `nil`).
  - **sequence** → match children in the expected order.
  - **choice** → detect which branch is present.
  - **optional** (`min = 0`) → present if the element exists, else `omitted`.
  - **repeatable** → collect all same-named siblings.
- **Reject (→ `Err`, becomes raw):** missing required element, extra element not
  in the schema, structural mismatch, **or a `soap:Header` with content** (the
  form does not represent headers — do not silently drop them).

Typed `DeserializeError` (thiserror), converted to `String` at the command
boundary (project convention). Registered in the `invoke_handler`.

**Key guarantee — round-trip:** `build_envelope` → `parse_envelope` returns the
original `FormValue`. This keeps the schema↔XML mapping a single source of truth.

## UI & error handling

- **Trigger:** `RequestPanel.onViewChange` becomes async. On `xml → form` with
  `xmlDraft !== null` and a loaded `schema`, call `commitSoapXml(activeId)`. The
  view switches immediately (form shows), the parse resolves shortly after and
  updates the values (or not).
- **Banner (raw mode)** — shown only on the **Form** tab when `xmlDraft !== null`:
  > ⚠ Sending hand-edited XML{`: <error>` when the parse failed} · **[Reset to form]**

  Slim, `soap-op` / `destructive` tokens. "Reset" → `setSoapXmlDraft(id, null)`.
- On the **XML** tab there is no banner (the XML shown is the truth).
- The parse error lives in `RequestPanel` local state (`xmlSyncError`), cleared
  on success and when the form is edited.

## Components touched

| Component | Change |
|---|---|
| `engine/deserialize.rs` | **new** — `parse_envelope(schema, xml) -> FormValue` + `DeserializeError` |
| `commands/mod.rs`, `lib.rs` | thin `parse_envelope` command + registration |
| `lib/api.ts` | `parseSoapEnvelope({ envelope, schema })` wrapper |
| `store/requestStore.ts` | `commitSoapXml(id)` action |
| `components/request/RequestPanel.tsx` | async `onViewChange` trigger + raw-mode banner |

`SoapXmlBody` and `serialize.rs` are unchanged.

## Testing

- **Rust (`deserialize.rs`)**: round-trip per kind (leaf, sequence, choice,
  optional, nil, repeatable) — `build_envelope` → `parse_envelope` equals the
  original value; rejection cases (missing required, extra element, malformed,
  `soap:Header` with content) → `Err`.
- **TS (store)**: `commitSoapXml` — success clears the draft and sets the value;
  failure keeps the draft. `api.parseSoapEnvelope` mocked.
- **Regression:** existing `formatXml` / `tokenizeXml` / send-raw tests stay green.

## Out of scope

- Live (per-keystroke) sync.
- Representing `soap:Header` / WS-Security in the form (v2).
- Preserving the user's manual XML formatting after a successful parse (the form
  becomes the source and the next open re-generates via the formatter).
