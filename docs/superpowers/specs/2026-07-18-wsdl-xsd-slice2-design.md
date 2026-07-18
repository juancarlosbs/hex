# WSDL Import — Slice 2: XSD → `SchemaNode` (`wsdl::xsd`) — Design

**Date:** 2026-07-18
**Status:** Approved
**Feature:** F2 — WSDL Import (`docs/product.md`), the domain heart (`docs/domain-model.md` §2/§4),
algorithm in `docs/soap-engine.md` §2.3

## Goal

Turn a resolved WSDL/XSD into a `SchemaNode` tree — the *shape* of a SOAP operation input.
Given the `wsdl_url` + `input_element` QName persisted by slice 1, re-resolve the schemas and
walk the XSD from that element to produce the immutable `SchemaNode`. This is the input that
slice 3's `SchemaForm` will render.

## Scope

**In:**
- Domain types in `domain/schema.rs` (per `domain-model.md` §2): `SchemaNode`, `NodeKind`,
  `Occurs`, `MaxOccurs`, `XsdType`, `Attribute`. Derive `Serialize, Deserialize, specta::Type`.
- `wsdl::xsd` (pure over the already-resolved `SchemaSet`): `build_schema(&SchemaSet,
  &QName) -> Result<SchemaNode, WsdlError>`.
- XSD coverage: base subset (§2.3 — `sequence`, `choice`, `simpleType`+enum, `attribute`,
  `xs:any`, `occurs`, `nillable`, `default`/`fixed`, type-by-QName) **plus `element ref`** and
  **`extension`/`restriction`** (complexContent + simpleContent inheritance). `xs:all` → treated
  as `Sequence`.
- `get_operation_schema(wsdl_url, input_element) -> SchemaNode` command (thin): fetch root WSDL
  → `wsdl::resolve` → `xsd::build_schema`. Regenerate `bindings.ts`.
- `WsdlError::TypeNotFound { qname }` for a dangling type/element reference.

**Out (documented future demand):**
- **`group` / `attributeGroup` refs — future demand (post-MVP backlog).** Full expansion
  (inlining the referenced particle / attribute set, like `element ref` and `extension` do here)
  is explicitly deferred to a follow-up slice. Until then this slice does NOT drop them silently:
  a `group`/`attributeGroup` ref becomes a marked `Any` node (`doc = "unsupported: edit raw"`),
  so the operation stays usable via the raw editor and the gap is visible. `xs:all` is NOT part
  of this backlog — it is handled now, as a `Sequence` (see In-scope).
- **Lazy expansion command** (`expand_schema_node`): deferred until slice 3's form needs it.
  MVP truncates recursion with a marked placeholder node (see §Recursion guard).
- **`NsRegistry` deterministic prefixes** (`soap-engine.md` §3): serialize-time concern, not
  here. `SchemaNode.namespace` carries the raw targetNamespace.
- **`SchemaForm` UI** (milestone 6): slice 3. Slice 2 ships no new UI; verification is via Rust
  tests + inspecting the returned `SchemaNode` JSON.
- Persisting the `SchemaSet` (ADR-011): the command re-resolves from `wsdl_url` on demand.

## Architecture

```
(slice 3 UI, later) ──> lib/api.ts getOperationSchema(wsdlUrl, inputElement)
                             │
                             ▼
             commands::get_operation_schema (thin, async)
                             │  fetch root (reqwest, rustls)
                             ▼
             wsdl::resolve (existing) ──> SchemaSet { docs: Vec<ResolvedDoc> }
                             │
                             ▼
             wsdl::xsd::build_schema (PURE) ──> SchemaNode
```

## Rust

### `domain/schema.rs` (new, pure)

The types exactly as specified in `docs/domain-model.md` §2: `SchemaNode { name, namespace,
occurs, nillable, doc, attributes, kind }`, `NodeKind { Leaf, Sequence, Choice, Any }`,
`Occurs { min, max }` + `MaxOccurs { Bounded, Unbounded }` (with `optional()`/`repeatable()`),
`XsdType` (subset + `Other`), `Attribute`. Derive `Serialize, Deserialize, specta::Type`.
Add to `domain/mod.rs`.

**Fallback convention (no new variant):** `NodeKind::Any` (= raw editor) represents all three
fallbacks — `xs:any`/`anyType`, unsupported construct (`group`/`attributeGroup`), and recursion
cutoff. They are told apart by the `doc` marker: `"unsupported: edit raw"` vs
`"recursive: expand on demand"`.

### `wsdl/xsd.rs` (new, pure)

`build_schema(set: &SchemaSet, root: &QName) -> Result<SchemaNode, WsdlError>`.

- **Indexing (no self-referential struct):** roxmltree `Document` borrows its source string, so
  parse all `set.docs` into `Document`s **locally on the stack** inside `build_schema`, then scan
  every `<xs:schema>` (including the inline ones inside `<wsdl:types>` of the root doc) and index
  global elements + named types (`complexType`/`simpleType`) by QName `(targetNamespace, name)`.
  The whole traversal runs within this scope.
- **`walk_element(el, path_types) -> SchemaNode`** (per `soap-engine.md` §2.3):
  - `occurs` from `minOccurs`/`maxOccurs` (default 1; `unbounded` → `Unbounded`), `nillable`,
    `doc` from `xs:annotation/xs:documentation`.
  - Resolve type: inline `complexType`/`simpleType`, **or** `el.type` QName lookup, **or**
    `el.ref` → referenced global element.
  - `simpleType`/built-in → `Leaf { xsd_type: map_xsd_type, enum_values (xs:enumeration),
    default, fixed }`.
  - `complexType`: `sequence`/`all` → `Sequence`; `choice` → `Choice`. For
    `complexContent`/`simpleContent` with `extension`/`restriction`: resolve `base` by QName,
    flatten inherited children/attributes, then append the derived particle.
  - `group`/`attributeGroup` ref → `Any` marked (`"unsupported: edit raw"`).
  - `xs:any`/`anyType` → `Any`.
  - `attributes` from `xs:attribute` (direct + inherited via extension). `attributeGroup` refs
    are skipped in this slice (backlog) — attributes are additive, missing some does not break
    the tree.
- **Recursion guard** (`walk_element_with_guard`): `path_types` = stack of named type QNames on
  the current path; depth cap `D = 12`. A child type already in `path_types`, or the cap, →
  emit `Any` marked `"recursive: expand on demand"` and stop. Anonymous inline types cannot
  cycle by name.
- `map_xsd_type`: subset `string/boolean/integer/decimal/double/date/dateTime/time/gYearMonth/
  base64Binary`; any other `xs:` QName → `XsdType::Other(name)`.

### `wsdl/error.rs`

Add `TypeNotFound { qname: String }`. Distinction: a genuinely absent type/element (broken WSDL)
is a **hard error** (upholds "never import partial results silently"); a known-but-unsupported
construct (`group`) is a **marked `Any` node**. Never conflate the two.

### Command (thin)

`get_operation_schema(wsdl_url: String, input_element: QName) -> Result<SchemaNode, ...>`:
fetch root WSDL (reqwest, rustls — same fetch closure as `import_wsdl`), `wsdl::resolve`,
`wsdl::xsd::build_schema`. Takes the QName directly (persisted by slice 1) — does **not** re-run
`wsdl::parse`. Regenerate `bindings.ts` (tauri-specta).

## Error handling

- Dangling type/element QName → `WsdlError::TypeNotFound { qname }` (hard fail).
- Fetch/invalid-XML during re-resolve → existing `WsdlError::Fetch`/`InvalidXml` (with the
  offending URL), same as slice 1.
- Unsupported construct / recursion cutoff → marked `Any` node, not an error.

## Testing

- **Rust** (`src-tauri/tests/` + `wsdl/testdata` fixtures): simple leaf; enum → `enum_values`;
  sequence; choice; occurs (optional / `unbounded` repeatable / nillable); attributes;
  `element ref` resolved cross-schema; `extension` (inherited fields present + derived appended);
  `restriction`; type cycle → marked `Any` (terminates, no infinite loop); depth cap; `xs:any`
  → `Any`; `group` ref → marked `Any`; `xs:all` → `Sequence`; missing type QName →
  `TypeNotFound`.

## Verification

Run `get_operation_schema` against the dneonline calculator WSDL (already used in slice 1) and
inspect the returned `SchemaNode` JSON for the `Add` operation (two `int` leaves). Then a public
WSDL with nested complex types to confirm sequence/choice/extension expansion end-to-end.
