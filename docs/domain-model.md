# Domain Model — Hex

> The pure Rust core (`src-tauri/src/domain/`): the types and functions that define what
> Hex IS, without I/O. Rule for the agent: these types are the contract. Do not put network/fs here
> (ADR-003). Types that cross the IPC boundary derive `Serialize, Deserialize, specta::Type`
> — specta is just a derive, not I/O, so it's allowed in the domain. See `docs/soap-engine.md`
> for the algorithm that BUILDS the `SchemaNode` and the one that SERIALIZES the envelope.

---

## 1. The central idea: two trees

The common mistake is mixing "the shape" with "what the user typed". In Hex these are **two separate trees**:

- **`SchemaNode`** — the *shape* of a SOAP operation, derived from the WSDL/XSD. Describes which fields exist, their types, whether required, whether repeatable, whether it's a `choice`. **Immutable** after parsing. Not persisted per request (comes from the WSDL — ADR-011).
- **`FormValue`** — the *instance*: what the user filled in. Has a different shape from the schema (a `choice` collapses to one branch, an array becomes N copies, an optional may disappear).

The serializer (`engine::serialize`) walks **both together** (`SchemaNode` + `FormValue`) to produce the envelope. Validation (authoritative, ADR-003) does the same pair to check required fields.

```
WSDL ──parse──► SchemaNode (shape, from WSDL)          ┐
                                                        ├─► serialize ─► XML Envelope
user fills in ─► FormValue (instance, from form)       ┘
```

---

## 2. `SchemaNode` — the shape (`domain/schema.rs`)

```rust
/// The shape of a SOAP operation input. Immutable tree derived from XSD.
pub struct SchemaNode {
    pub name: String,
    pub namespace: Option<String>,   // targetNamespace — needed for prefix in envelope
    pub occurs: Occurs,              // cardinality (optional? repeatable?)
    pub nillable: bool,              // can send xsi:nil
    pub doc: Option<String>,         // xs:annotation -> tooltip in UI
    pub attributes: Vec<Attribute>,  // xs:attribute of the element
    pub kind: NodeKind,
}

pub enum NodeKind {
    /// Leaf: typed value. Non-empty enum_values => UI renders dropdown.
    Leaf {
        xsd_type: XsdType,
        enum_values: Vec<String>,
        default: Option<String>,
        fixed: Option<String>,       // schema-imposed value (read-only in UI)
    },
    /// Complex (xs:sequence): children in order, each subject to its own occurs.
    Sequence(Vec<SchemaNode>),
    /// xs:choice: exactly ONE branch is selected.
    Choice(Vec<SchemaNode>),
    /// xs:any / anyType — outside the subset (ADR-010): falls back to raw editor for this subnode.
    Any,
}

pub struct Occurs { pub min: u32, pub max: MaxOccurs }
pub enum MaxOccurs { Bounded(u32), Unbounded }

impl Occurs {
    pub fn optional(&self) -> bool { self.min == 0 }
    pub fn repeatable(&self) -> bool {
        matches!(self.max, MaxOccurs::Unbounded)
            || matches!(self.max, MaxOccurs::Bounded(n) if n > 1)
    }
}

/// Subset of simple types supported in MVP (ADR-010).
pub enum XsdType {
    String, Boolean, Integer, Decimal, Double,
    Date, DateTime, Time, GYearMonth,
    Base64Binary,
    Other(String),   // unknown xs: -> treated as String, with warning in UI
}

pub struct Attribute {
    pub name: String,
    pub xsd_type: XsdType,
    pub required: bool,              // use="required"
    pub enum_values: Vec<String>,
    pub default: Option<String>,
}
```

**Invariants**:
- `NodeKind::Choice` always has ≥ 2 children.
- `fixed` implies read-only field; the UI shows it but doesn't allow editing.
- `Any` is never validated or generates a form — raw editor only.

---

## 3. `FormValue` — the instance (`domain/value.rs`)

Structurally mirrors `NodeKind`, so the pair (schema, value) is a recursive "zip".

```rust
pub enum FormValue {
    /// Corresponds to NodeKind::Leaf. None or "" => omit if optional; error if required.
    Leaf(Option<String>),
    /// Corresponds to NodeKind::Sequence: one FormValue per child, SAME order.
    Sequence(Vec<FormValue>),
    /// Corresponds to NodeKind::Choice: index of chosen branch + its value.
    Choice { branch: usize, value: Box<FormValue> },
    /// For nodes with occurs.repeatable(): N instances.
    Repeated(Vec<FormValue>),
    /// nillable && user chose nil -> emits xsi:nil="true".
    Nil,
    /// Optional (min=0) not included -> does not emit the element.
    Omitted,
    /// Corresponds to NodeKind::Any -> raw XML provided by user.
    Raw(String),
}
```

### Pairing contract (schema × value)

The recursive walk `(node: &SchemaNode, value: &FormValue)` follows these rules — the same
contract used by `validate` and `serialize`:

| Situation in `SchemaNode` | Expected `FormValue` | Behavior |
|---|---|---|
| `occurs.repeatable()` | `Repeated(vec)` | serializes one element per item in `vec` |
| `occurs.optional()` and not filled | `Omitted` | does not emit the element |
| `nillable` and user marked nil | `Nil` | emits `<el xsi:nil="true"/>` |
| `NodeKind::Leaf` | `Leaf(Some(s))` | emits `<el>s</el>` |
| `NodeKind::Sequence(children)` | `Sequence(values)` (len == children.len()) | zip child-by-child, in order |
| `NodeKind::Choice(branches)` | `Choice{branch, value}` | serializes only `branches[branch]` with `value` |
| `NodeKind::Any` | `Raw(xml)` | inserts `xml` verbatim |

**Source of truth rule**: in MVP, the **form is the source**. Editing the raw XML (Form⇄XML toggle,
ADR-013) disables the form until reset. Bidirectional sync is v2.

---

## 4. XSD → `SchemaNode` (what the parser produces)

Reference mapping that `wsdl::xsd` implements (algorithm in `soap-engine.md`):

| XSD construct | Becomes in `SchemaNode` |
|---|---|
| `xs:element` simple type | `Leaf{ xsd_type }` |
| `xs:enumeration` | `Leaf{ enum_values: [...] }` |
| `default` / `fixed` | `Leaf{ default }` / `Leaf{ fixed }` |
| `minOccurs` / `maxOccurs` | `occurs.min` / `occurs.max` (`unbounded` -> `Unbounded`) |
| `nillable="true"` | `nillable = true` |
| `xs:complexType` + `xs:sequence` | `Sequence(children)` |
| `xs:choice` | `Choice(branches)` |
| `xs:attribute` | goes into `attributes` |
| `xs:annotation/xs:documentation` | `doc` |
| `xs:any` / `anyType` | `Any` |
| recursive type | `Sequence`/`Choice` with lazy expansion + depth cap (marked) |

`SchemaNode` → UI widget mapping (dropdown, date picker, branch selector, repeatable group,
collapsed optional): see `docs/ui.md`.

---

## 5. Authoritative validation (`domain/validate.rs`)

Pure function. This is the validation that **wins** (ADR-003); the frontend's is UX only.

```rust
pub struct ValidationIssue { pub path: Vec<String>, pub kind: IssueKind }

pub enum IssueKind {
    MissingRequired,                 // required (min>=1) empty/omitted
    EmptyChoice,                     // Choice with no branch selected
    InvalidFormat { expected: XsdType },  // e.g.: text in an xs:integer field
    ArityMismatch,                   // Repeated outside a repeatable node, etc.
}

/// Walks the (schema, value) pair and collects ALL issues (does not stop at first).
pub fn validate(node: &SchemaNode, value: &FormValue) -> Result<(), Vec<ValidationIssue>>;
```

`path` is the trail of names to the field (e.g.: `["GetBalance","Employee","TaxId"]`) — the UI uses
it to highlight the exact field. `command::send_request` calls `validate` BEFORE serializing; if
it fails, returns the issues and does not send.

---

## 6. Variable interpolation (`domain/env.rs`)

`{{var}}` is resolved in the domain (pure), before serializing — applies to URL, headers, and
leaf values.

```rust
pub struct Environment { pub name: String, pub vars: BTreeMap<String, String> }

/// Substitutes {{key}} with values from the environment. Missing variable -> DomainError::UnknownVar.
pub fn interpolate(template: &str, env: &Environment) -> Result<String, DomainError>;
```

---

## 7. Request: persisted (lean) vs prepared (runtime)

Important design point (ADR-011): **`SchemaNode` is NOT saved per request**. The
git-friendly file stores only the operation reference + the values; the schema is resolved from the WSDL on open.

```rust
// --- PERSISTED: 1 file per request (persistence/collection.rs writes this) ---
pub struct SavedRequest {
    pub id: RequestId,
    pub name: String,
    pub headers: Vec<Header>,
    pub auth: Auth,
    pub protocol: SavedProtocol,
}
pub enum SavedProtocol {
    Rest { method: HttpMethod, url: String, query: Vec<Param>, body: RestBody },
    Soap { wsdl_ref: WsdlRef, operation: String, values: FormValue },  // no schema
}

// --- RUNTIME: what the engine receives, with schema resolved and vars interpolated ---
pub struct PreparedRequest {
    pub url: String,
    pub headers: Vec<Header>,
    pub payload: Payload,
}
pub enum Payload {
    Rest(RestBody),
    Soap { envelope: Envelope, soap_action: String, version: SoapVersion },
}

pub enum HttpMethod { Get, Post, Put, Patch, Delete, Head, Options }
pub enum SoapVersion { V1_1, V1_2 }
pub enum Auth { None, Basic { user: String, pass: String }, Bearer(String),
                ApiKey { name: String, value: String, location: ApiKeyLoc } }
pub enum ApiKeyLoc { Header, Query }
```

Flow: `SavedRequest` --(resolve schema from WSDL + interpolate + serialize)--> `PreparedRequest` --> `engine`.

---

## 8. Envelope (`domain/envelope.rs`)

SOAP XML model. Its *construction* lives in `engine::serialize` (details in `soap-engine.md`);
this is just the shape.

```rust
pub struct Envelope {
    pub version: SoapVersion,
    pub namespaces: Vec<Namespace>,   // prefixes collected from the schema (ns0, ns1, ...)
    pub header: Option<XmlFragment>,  // e.g.: WS-Security UsernameToken (UI exists; engine v2)
    pub body: XmlFragment,            // serialized operation body
}
pub struct Namespace { pub prefix: String, pub uri: String }
pub struct XmlFragment(pub String);   // already serialized XML (quick-xml writer)
```

---

## 9. Response (`domain/response.rs`)

```rust
pub struct ResponseData {
    pub status: u16,
    pub status_text: String,
    pub headers: Vec<(String, String)>,
    pub body: ResponseBody,
    pub timing: TimingBreakdown,
    pub size_bytes: usize,
}

pub enum ResponseBody {
    Json(ResponseNode),
    Xml(ResponseNode),
    Soap { body: ResponseNode, fault: Option<SoapFault> },  // Fault even with HTTP 200
    Raw(String),                                            // non-parseable content-type
}

/// Tree for the response viewer. Isolated `value` per leaf = enables copy-leaf (differentiator #2).
pub struct ResponseNode {
    pub key: String,               // tag (with namespace prefix) or JSON key
    pub value: Option<String>,     // leaf value; None for container nodes
    pub kind: DisplayKind,         // Object | Array | Leaf
    pub children: Vec<ResponseNode>,
}
pub enum DisplayKind { Object, Array, Leaf }

/// SOAP Fault ALWAYS rendered as a structured error, never as success (product.md F3).
pub struct SoapFault {
    pub code: String,              // faultcode (1.1) / Code (1.2)
    pub reason: String,            // faultstring / Reason
    pub detail: Option<String>,
    pub actor: Option<String>,
}
```

### Timing (the waterfall — differentiator #3)

```rust
pub struct TimingBreakdown {
    pub dns_ms: Option<f64>,     // None if cached/host reused
    pub tcp_ms: Option<f64>,     // None if connection reused
    pub tls_ms: Option<f64>,     // None on plain HTTP
    pub ttfb_ms: f64,            // time to first byte after connection
    pub download_ms: f64,        // first byte -> last byte
    pub total_ms: f64,
}
```
`Option` on the first 3 phases because a reused connection / cached DNS / HTTP without TLS
makes the phase non-existent — the UI shows "—" in these cases, which is real information.

---

## 10. Errors (`domain/error.rs`)

```rust
#[derive(thiserror::Error, Debug)]
pub enum DomainError {
    #[error("validation failed")]
    Validation(Vec<ValidationIssue>),
    #[error("undefined variable: {0}")]
    UnknownVar(String),
    #[error("could not serialize: {0}")]
    Serialize(String),
    #[error("value incompatible with schema at {path:?}")]
    ValueMismatch { path: Vec<String> },
}
```
Network/TLS errors live in `engine`; WSDL parsing errors, in `wsdl`. The domain only knows
shape/value errors.

---

## 11. Agent rules (invariants)

- `SchemaNode` is immutable after parsing. Do not mutate during filling — user state lives in `FormValue`.
- Never serialize from schema alone, or from value alone — always the pair.
- `validate` runs in Rust before every Send; the return with `Vec<ValidationIssue>` is what the UI uses to highlight fields.
- `SchemaNode` does not go into the request file (ADR-011); only `wsdl_ref + operation + values`.
- SOAP Fault is an error. `ResponseBody::Soap{ fault: Some(_) }` is never a success UI.
- Timing phases are `Option` — absence is information, not a bug.
