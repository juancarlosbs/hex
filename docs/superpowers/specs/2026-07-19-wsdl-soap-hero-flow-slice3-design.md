# Slice 3 — SOAP Hero Flow (design)

> Import WSDL → click operation → **schema-generated form** → Send → **XML response + real
> per-phase waterfall**. Completes the hero flow (differentiators #1, #2, #3).
> Types come from `docs/domain-model.md`; the algorithm from `docs/soap-engine.md`. This spec
> is the *slice plan*: what we build, in what order, and the decisions settled while brainstorming.

## Decisions locked (brainstorming)

1. **Scope = full hero flow, all-in-one.** Form + envelope serializer + SOAP Send + XML response +
   the instrumented hyper engine + real waterfall — one slice.
2. **The instrumented engine replaces reqwest for BOTH REST and SOAP** (ADR-005). REST gets the
   real waterfall too. Blast radius: rewrites the working REST send path + its tests.
3. **SOAP response = full XML tree + copy-leaf** (differentiator #2 works on SOAP responses).
4. **Form values are in-memory only** this slice — no persistence of filled values.

## Divergences from docs (flagged per CLAUDE.md)

- **`soap-engine.md §6` says Rust parses the response body into a `ResponseNode` tree.** The actual
  codebase already diverged: the REST viewer passes `body: string` and parses JSON in the frontend
  (`JsonTree`). We follow the codebase's real pattern — XML is parsed in the frontend with the
  native `DOMParser` (`XmlTree`), reusing the existing copy-leaf `LeafNode`. `HttpResponse.body`
  stays a `String`. Rust does the SOAP-specific bit only: **fault detection** (mandatory, §6/F3).
  If we later want server-side response typing, that's its own change; §6 should be updated then.

## Architecture / data flow

```
click SOAP operation node
  └─► api.getOperationSchema(wsdlUrl, inputElement) ─► SchemaNode   (re-resolved, not persisted; ADR-011)
        └─► SchemaForm renders the tree, user fills ─► builds FormValue (mirrors §3)
              └─► api.sendSoap({ wsdlUrl, inputElement, endpoint, soapAction, soapVersion, value })
                    └─► [Rust] re-resolve schema ─► engine::serialize(schema, value) ─► envelope XML
                          └─► engine (hyper) POST ─► HttpResponse{ body, timing, fault? }
                                └─► ResponsePanel: XmlTree (copy-leaf) + Waterfall + Fault-as-error
```

---

## Part A — Backend (Rust)

### A0. `schema_tns` — honor `elementFormDefault` (blocker)

Slice 2 deferred bug (`docs/soap-engine.md §3` known gap). `wsdl::xsd::schema_tns` assigns every node
the enclosing schema's `targetNamespace`. Local (non-global) elements are namespaced only when
`elementFormDefault="qualified"`; the XSD default is `unqualified` (no namespace). Global elements
(root / via `ref`) stay qualified. **Fix before the serializer reads `SchemaNode.namespace`** — else
default-`unqualified` schemas emit wrong prefixes and servers reject the envelope.

Verify: unit test — a local element under a default (unqualified) schema gets `namespace: None`;
under `elementFormDefault="qualified"`, it gets the tns; a global/`ref` element always gets the tns.

### A1. `domain/value.rs` — `FormValue` (pure)

The `FormValue` enum exactly as `domain-model.md §3`. `#[serde(rename_all = "camelCase")]`, externally
tagged (serde default). Serialized shape the frontend must mirror:

```
Leaf(Option<String>)  → { "leaf": "v" } | { "leaf": null }
Sequence(Vec)         → { "sequence": [ ... ] }
Choice{branch,value}  → { "choice": { "branch": 0, "value": {...} } }
Repeated(Vec)         → { "repeated": [ ... ] }
Nil                   → "nil"
Omitted               → "omitted"
Raw(String)           → { "raw": "<xml/>" }
```

No logic here beyond the type — pure domain.

### A2. `engine::serialize` — envelope writer

Walks the pair `(SchemaNode, FormValue)` per the §3 pairing contract, writing with **`quick-xml`**
(new dep). Follows `soap-engine.md §4`:

- **`NsRegistry`** (`uri → prefix`, stable discovery order `ns0, ns1, …`). Collected from the subtree,
  declared once at the envelope root; each element emitted with its prefix.
- **SOAP 1.1 vs 1.2** — envelope ns, and the Action mechanism differ (§4 table). The serializer
  returns the body + the metadata the engine needs for headers (Content-Type / SOAPAction).
- `xsi:nil="true"` for `Nil`; skip `Omitted`; attributes from `node.attributes`; `Raw` inserted
  verbatim; `_ → DomainError::ValueMismatch{ path }` on a pairing mismatch.

New: `DomainError` (shape/value errors, `thiserror`). Verify: golden-ish unit tests — a small schema +
FormValue → expected envelope string (sequence, choice, optional-omitted, repeated, nil, attribute,
namespaced element), plus a 1.1-vs-1.2 header/ns diff test.

### A3. `engine::{connector, client}` — instrumented HTTP engine (replaces reqwest)

Per `soap-engine.md §5`. New deps: `hyper` (client/http1/http2), `hyper-util`, `http-body-util`,
`hickory-resolver`, `tokio-rustls`, `rustls`, `rustls-native-certs`, `tokio` (net/rt/macros).
**Remove `reqwest`.**

Phase stamping into `TimingBreakdown { dns_ms, tcp_ms, tls_ms: Option, ttfb_ms, download_ms, total_ms }`
(phases `Option` — MVP is one new connection per request so all are `Some`; pooling is v2). rustls
throughout (ADR-006), `rustls-native-certs` CA store. `EngineError { Dns, Connect, Tls, Send, Timeout,
BodyRead }` (`thiserror`).

**Both REST and SOAP route through this.** `build_request` (method/params/auth/body/headers) is
preserved; only the transport underneath changes from reqwest to hyper. Redirects/gzip we implement
only as needed (ADR-005) — MVP: no auto-redirect, no decompression unless a test target needs it
(noted as a follow-up if a real endpoint requires it).

Verify: the existing REST send tests stay green (guard against regression); add a timing test
asserting all phases populated against a local http server; a TLS-path test if feasible in CI.

> **Risk:** this is the bulk of the slice and the highest-regression piece. Keep REST tests as the
> contract. If gzip/redirect turns out to be needed by the REST smoke target, that's a scoped add.

### A4. Response: `HttpResponse` gains `timing` + `fault`

- Add `timing: TimingBreakdown` (all responses) and `fault: Option<SoapFault>` (SOAP).
- `SoapFault { code, reason, detail: Option, actor: Option }`.
- **Fault detection** (roxmltree, already a dep): on a `text/xml | application/soap+xml` body, look
  for `soap:Body/soap:Fault` (1.1: `faultcode`/`faultstring`) or `env:Body/env:Fault`
  (1.2: `Code`/`Reason`). A Fault is an **error even on HTTP 200** (F3). `body` stays the raw string.

Verify: unit tests — 1.1 fault XML → `Some(SoapFault{...})`; 1.2 fault → parsed; a success body → `None`.

### A5. Command `send_soap` (thin)

```
send_soap(wsdl_url, input_element: QName, endpoint, soap_action, soap_version, value: FormValue)
  -> HttpResponse
```

Re-resolve schema (reuse the shared fetch helper from commit 26f23f5), `engine::serialize`, POST via
the instrumented engine with the version-correct Content-Type/SOAPAction, return `HttpResponse`.
Thin handler — validate + delegate only (CLAUDE.md).

---

## Part B — Frontend types + state

### B1. `src/lib/api.ts` (hand-written; no `bindings.ts`, ADR-007)

Add TS types mirroring the Rust serde shapes (camelCase; note `xsdType`/`enumValues` struct-variant
renames on `Leaf`):

- `SchemaNode`, `NodeKind` (`leaf`/`sequence`/`choice`/`any`), `XsdType`, `Occurs`, `MaxOccurs`,
  `Attribute`.
- `FormValue` (the externally-tagged union from A1).
- `TimingBreakdown`, `SoapFault`; extend `HttpResponse` with `timing` + optional `fault`.

Wrappers: `getOperationSchema(wsdlUrl, inputElement)`, `sendSoap(spec)`.

### B2. SOAP request state

The store is REST-only (`OpenRequest`, `openRequest`, `saveRequest` hardcode `kind:"rest"`). Add an
optional `soap` branch to `OpenRequest`:

```
soap?: {
  meta: { wsdlUrl, inputElement, endpoint, soapAction, soapVersion }   // from the persisted node (slice 1)
  schema: SchemaNode | null      // fetched on open (loading state while null)
  value: FormValue               // the form instance, in-memory only
}
```

On `openRequest`, if the node is SOAP → `getOperationSchema` and seed a default `FormValue` from the
schema (required leaves present/empty, optionals `Omitted`, choice → branch 0, defaults prefilled).
`saveRequest` is a no-op for SOAP this slice (values not persisted). `RequestPanel` branches: SOAP →
`SchemaForm`; REST → existing tabs.

*(ponytail: skipped persisting `value`; add a `save_soap_values` path when the user asks to keep
filled SOAP requests. Schema stays re-resolved on demand per ADR-011.)*

---

## Part C — Frontend form + response

### C1. `SchemaForm` — recursive renderer (differentiator #1)

Renders `SchemaNode`, writes into `FormValue`. Per node:

- **Leaf**: typed input by `xsdType` (native inputs — `type=date/datetime-local/number/checkbox`;
  ADR: prefer native over pickers). Non-empty `enumValues` → `<select>`. `fixed` → read-only,
  prefilled. `default` → prefill. `Other(x)` → text input + a "treated as string" hint.
- **Sequence**: labeled group, children in order.
- **Choice**: branch selector (radio/segmented); only the chosen branch renders → `Choice{branch,value}`.
- **occurs.optional()** (min=0): collapsed/removable; absent → `Omitted`.
- **occurs.repeatable()**: add/remove instances → `Repeated([...])`.
- **nillable**: a "nil" toggle → `Nil` (emits `xsi:nil`).
- **attributes**: rendered alongside the leaf value (a leaf can carry attributes — slice-2 note).
- **Any**: raw XML editor → `Raw(xml)`. Branch on `doc`: `"unsupported: edit raw"` (xs:any/group)
  vs `"recursive: expand on demand"` (recursion cutoff) — both render the raw editor with the right
  hint. No `expand_schema_node` this slice.

Components follow the CVA + `cn()` conventions; tokens only. Keep the recursive renderer in focused
files (one per node kind if it grows).

Verify: a Vitest test building a small schema, driving inputs, asserting the produced `FormValue`
matches the pairing contract (sequence/choice/optional/repeated/nil).

### C2. `XmlTree` — response tree + copy-leaf (differentiator #2)

Parse `response.body` with native `DOMParser` (no dep). Render a tree mirroring `JsonTree`
(expand/collapse; reuse the `LeafNode` copy button — copies the **value only**, no tag/prefix).
Namespace prefixes (`ns2:MainValue`) shown dimmed in the key. `ResponseBodyView` picks `XmlTree` vs
`JsonTree` by content-type (or by sniffing `<`). Raw view unchanged.

Verify: Vitest — an XML string → tree nodes; copy yields the bare value.

### C3. Waterfall UI (differentiator #3)

Replace `TimingStub` with a per-phase bar reading `TimingBreakdown` (DNS/TCP/TLS/TTFB/download,
proportional widths, `Option` phases hidden/zeroed). Serves **both** REST and SOAP. Tokens only
(`--timing-*` in `tokens.css`).

### C4. Wire Send + fault-as-error

SOAP Send → `api.sendSoap` → `responseStore`. When `response.fault` is present, render as a
**structured error** (never green), even on HTTP 200 (F3).

---

## Out of scope (this slice)

xs:any real expansion / `expand_schema_node`; rpc/encoded; WS-Security; persisting filled form
values; Form⇄XML bidirectional sync (ADR-013: raw disables form until reset, one direction);
connection pooling (MVP = one connection/request); auto-redirect & response decompression unless a
smoke target needs it.

## Testing strategy (see `docs/testing.md`)

- Rust unit: `schema_tns` elementFormDefault; serializer golden envelopes (1.1/1.2, each pairing
  branch); fault parsing (1.1/1.2/none); engine timing phases populated; **existing REST send tests
  stay green**.
- Vitest: `SchemaForm` → `FormValue`; `XmlTree` parse + copy-leaf.
- Manual/E2E: import a real WSDL, fill, Send, see response + waterfall.

## Milestone order (for writing-plans)

A0 → A1 → A2 → A4 → A3 → A5 → B1 → B2 → C1 → C2 → C3 → C4.
(A4 before A3 so response types settle before the engine returns them; A3 — the reqwest→hyper swap —
is the highest-risk step and gets its own milestone with the REST tests as guardrail.)
