# SOAP Hero Flow (Slice 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import WSDL → click a SOAP operation → fill a schema-generated form → Send → see the XML response (navigable tree + copy-leaf) with a real per-phase timing waterfall.

**Architecture:** Rust gains a pure `FormValue` domain type, a `quick-xml` envelope serializer that walks `(SchemaNode, FormValue)`, an instrumented `hyper` HTTP engine (DNS/TCP/TLS/TTFB/download stamped) that replaces reqwest **on the send path** for both REST and SOAP, and a thin `send_soap` command. The frontend adds hand-written TS types, a recursive `SchemaForm` that produces `FormValue`, an `XmlTree` response viewer (native `DOMParser`, copy-leaf), and a real waterfall UI.

**Tech Stack:** Rust (hyper, hyper-util, http-body-util, hickory-resolver, tokio-rustls, rustls, rustls-native-certs, quick-xml, roxmltree, thiserror, serde, tokio), React 19 + TS + zustand + Tailwind/CVA.

## Global Constraints

- **rustls throughout — never OpenSSL/native-tls, not even via a feature** (ADR-006).
- **Domain is pure** — no I/O in `domain/`. Network lives in `engine/`; commands are thin (validate + delegate).
- **`src/bindings.ts` does not exist** — types are hand-written in `src/lib/api.ts` (ADR-007). Rust IPC types serialize `#[serde(rename_all = "camelCase")]`; mirror camelCase in TS.
- **No `any` in TS.** Client state in zustand. Async only via `src/lib/api.ts` wrappers over `invoke` — never a bare `invoke` string in a component.
- **UI uses only tokens from `src/App.css`** (`--color-*`). No hardcoded hex in components. Components use CVA + `cn()` (`src/lib/utils.ts`), named exports.
- **Rust**: `thiserror` for domain/engine errors, `anyhow` at command level. `cargo fmt` + `cargo clippy -D warnings` clean before each commit.
- **Deviation from the spec, deliberate:** the instrumented engine replaces reqwest **only on the send path** (`engine::send`). WSDL document fetching (`commands::fetch_text`, used by `import_wsdl` + `get_operation_schema`) keeps reqwest with `rustls-tls` — it needs no per-phase timing and relies on reqwest's redirect handling. reqwest is **not** removed from `Cargo.toml`.
- **MVP = one new connection per request** (all timing phases always measured; pooling is v2 → `tls_ms` is `Option`).
- **Reject rpc/encoded and WS-Security** — out of scope; do not serialize them.

Reference docs (read before the relevant task): `docs/soap-engine.md` (algorithm, §3 namespaces, §4 serialize, §5 engine, §6 response, §7 errors), `docs/domain-model.md` §3 (FormValue + pairing contract), the spec `docs/superpowers/specs/2026-07-19-wsdl-soap-hero-flow-slice3-design.md`.

---

## File structure

**Rust (create):**
- `src-tauri/src/domain/value.rs` — `FormValue` enum (pure).
- `src-tauri/src/domain/error.rs` — `DomainError` (serialize/pairing errors).
- `src-tauri/src/engine/serialize.rs` — envelope writer + `NsRegistry`.
- `src-tauri/src/engine/connector.rs` — instrumented transport (DNS/TCP/TLS/hyper) + `TimingBreakdown`.
- `src-tauri/src/engine/error.rs` — `EngineError`.
- `src-tauri/src/engine/fault.rs` — SOAP fault detection + `SoapFault`.

**Rust (modify):**
- `src-tauri/src/domain/mod.rs`, `src-tauri/src/engine/mod.rs` — module wiring; `engine::send` re-driven over `connector`.
- `src-tauri/src/wsdl/xsd.rs:383` — `schema_tns` honors `elementFormDefault`.
- `src-tauri/src/commands/mod.rs` — add `send_soap`.
- `src-tauri/src/lib.rs` — register `send_soap`.
- `src-tauri/Cargo.toml` — add engine + quick-xml deps.

**Frontend (create):**
- `src/components/request/soap/SchemaForm.tsx` + node widgets (`SchemaNodeField.tsx`, `LeafField.tsx`).
- `src/components/response/body/XmlTree.tsx`.
- `src/components/response/Waterfall.tsx`.
- `src/store/soapForm.ts` — default `FormValue` builder + immutable update helpers (pure, unit-tested).

**Frontend (modify):**
- `src/lib/api.ts` — schema/value/timing types + `getOperationSchema`, `sendSoap`.
- `src/lib/request-types.ts` — `OpenRequest.soap?`, `RequestTab` for soap.
- `src/lib/response-types.ts` — `TimingBreakdown`, `SoapFault` on `HttpResponse`.
- `src/store/requestStore.ts` — fetch schema on open for SOAP nodes.
- `src/store/responseStore.ts` — `sendSoap` path.
- `src/components/request/RequestPanel.tsx` — branch SOAP → `SchemaForm`.
- `src/components/response/ResponsePanel.tsx` — Waterfall + fault-as-error; `ResponseBodyView` picks XML vs JSON.
- `src/components/response/body/ResponseBodyView.tsx`.
- `src/App.css` — `--color-timing-*` tokens.

---

## Task 1: `schema_tns` honors `elementFormDefault` (A0)

**Files:**
- Modify: `src-tauri/src/wsdl/xsd.rs:383` (`schema_tns`) and its call site.
- Test: `src-tauri/src/wsdl/xsd.rs` (`#[cfg(test)]` module).

**Interfaces:**
- Consumes: existing `wsdl::xsd::build_schema`, `roxmltree::Node`.
- Produces: local (non-global) elements under a schema whose `elementFormDefault` is absent or `"unqualified"` get `namespace: None`; global elements (direct schema children / reached via `ref`) and any element under `elementFormDefault="qualified"` keep the schema `targetNamespace`.

- [ ] **Step 1: Read context.** Open `docs/soap-engine.md §3` ("Known gap") and read `src/wsdl/xsd.rs` around `schema_tns` (line 383) and every caller, to see how a node currently receives its namespace and whether the walker knows if an element is global vs local.

- [ ] **Step 2: Write the failing test**

Add to the `xsd.rs` test module. Use the existing test helpers there (mirror how other `xsd.rs` tests build a `SchemaSet` from an inline schema string — copy an existing test's setup).

```rust
#[test]
fn local_element_unqualified_has_no_namespace() {
    // elementFormDefault absent => XSD default "unqualified": nested locals get no namespace,
    // the global root keeps the tns.
    let xsd = r#"<xsd:schema xmlns:xsd="http://www.w3.org/2001/XMLSchema"
        targetNamespace="http://ex.com/t" xmlns:t="http://ex.com/t">
      <xsd:element name="Order">
        <xsd:complexType><xsd:sequence>
          <xsd:element name="id" type="xsd:string"/>
        </xsd:sequence></xsd:complexType>
      </xsd:element>
    </xsd:schema>"#;
    let node = build_from_single(xsd, "http://ex.com/t", "Order"); // test helper below
    assert_eq!(node.namespace.as_deref(), Some("http://ex.com/t")); // global root: qualified
    let NodeKind::Sequence(children) = &node.kind else { panic!() };
    assert_eq!(children[0].namespace, None);                        // local child: unqualified
}

#[test]
fn local_element_qualified_keeps_namespace() {
    let xsd = r#"<xsd:schema xmlns:xsd="http://www.w3.org/2001/XMLSchema"
        elementFormDefault="qualified"
        targetNamespace="http://ex.com/t" xmlns:t="http://ex.com/t">
      <xsd:element name="Order">
        <xsd:complexType><xsd:sequence>
          <xsd:element name="id" type="xsd:string"/>
        </xsd:sequence></xsd:complexType>
      </xsd:element>
    </xsd:schema>"#;
    let node = build_from_single(xsd, "http://ex.com/t", "Order");
    let NodeKind::Sequence(children) = &node.kind else { panic!() };
    assert_eq!(children[0].namespace.as_deref(), Some("http://ex.com/t"));
}
```

If no `build_from_single` helper exists in the test module, add it next to the existing helpers (adapt to the real `resolve`/`build_schema` signatures used by neighbouring tests):

```rust
fn build_from_single(xsd: &str, ns: &str, root: &str) -> SchemaNode {
    let set = crate::wsdl::resolve::resolve_inline_for_test(xsd); // or the helper existing tests use
    crate::wsdl::xsd::build_schema(&set, &QName { namespace: ns.into(), local: root.into() }).unwrap()
}
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd src-tauri && cargo test wsdl::xsd::tests::local_element -- --nocapture`
Expected: FAIL — `local_element_unqualified_has_no_namespace` asserts `None` but current code returns `Some(tns)`.

- [ ] **Step 4: Implement**

In `xsd.rs`, thread an `element_form_qualified: bool` (read once per schema from `@elementFormDefault == "qualified"`) into the recursive element walk. Emit the tns for an element's `namespace` only when it is **global** (a direct child element of `<xsd:schema>`, or reached via `ref` to a global) **or** `element_form_qualified` is true; otherwise `None`. Keep `schema_tns` as the tns lookup but gate its use at the call site by the global/qualified check. Do not change how attributes or types resolve.

- [ ] **Step 5: Run to verify pass**

Run: `cd src-tauri && cargo test wsdl::xsd -- --nocapture`
Expected: PASS (new tests + all existing xsd tests green — do not regress global-element cases).

- [ ] **Step 6: Commit**

```bash
cd src-tauri && cargo fmt && cargo clippy --all-targets -- -D warnings
git add -f src/wsdl/xsd.rs
git commit -m "fix(wsdl): schema_tns honors elementFormDefault for local elements"
```

---

## Task 2: `FormValue` domain type + `DomainError` (A1)

**Files:**
- Create: `src-tauri/src/domain/value.rs`, `src-tauri/src/domain/error.rs`.
- Modify: `src-tauri/src/domain/mod.rs`.
- Test: inline `#[cfg(test)]` in `value.rs`.

**Interfaces:**
- Produces: `domain::value::FormValue` (externally-tagged, camelCase), `domain::error::DomainError`.

```rust
// serde shapes the frontend mirrors (Task 9):
// Leaf(Some("v")) => {"leaf":"v"}     Leaf(None) => {"leaf":null}
// Sequence(v) => {"sequence":[..]}    Choice{branch,value} => {"choice":{"branch":0,"value":{..}}}
// Repeated(v) => {"repeated":[..]}    Nil => "nil"   Omitted => "omitted"   Raw(s) => {"raw":"<x/>"}
```

- [ ] **Step 1: Write the failing test** (`value.rs`)

```rust
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn form_value_serde_roundtrip_shapes() {
        assert_eq!(serde_json::to_string(&FormValue::Nil).unwrap(), "\"nil\"");
        assert_eq!(serde_json::to_string(&FormValue::Omitted).unwrap(), "\"omitted\"");
        assert_eq!(serde_json::to_string(&FormValue::Leaf(Some("v".into()))).unwrap(), "{\"leaf\":\"v\"}");
        let choice = FormValue::Choice { branch: 1, value: Box::new(FormValue::Leaf(None)) };
        assert_eq!(serde_json::to_string(&choice).unwrap(), "{\"choice\":{\"branch\":1,\"value\":{\"leaf\":null}}}");
        // deserialize the frontend-produced shape back
        let back: FormValue = serde_json::from_str("{\"repeated\":[\"nil\"]}").unwrap();
        assert_eq!(back, FormValue::Repeated(vec![FormValue::Nil]));
    }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd src-tauri && cargo test domain::value`
Expected: FAIL — module `value` does not exist.

- [ ] **Step 3: Implement `value.rs`**

```rust
use serde::{Deserialize, Serialize};

/// The instance the user filled in. Mirrors `NodeKind`; the serializer walks the
/// pair (SchemaNode, FormValue). See docs/domain-model.md §3.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FormValue {
    Leaf(Option<String>),
    Sequence(Vec<FormValue>),
    Choice { branch: usize, value: Box<FormValue> },
    Repeated(Vec<FormValue>),
    Nil,
    Omitted,
    Raw(String),
}
```

- [ ] **Step 4: Implement `error.rs`**

```rust
use thiserror::Error;

#[derive(Debug, Error)]
pub enum DomainError {
    #[error("value does not match schema at {path}")]
    ValueMismatch { path: String },
}
```

- [ ] **Step 5: Wire modules** — add to `src-tauri/src/domain/mod.rs`:

```rust
pub mod error;
pub mod value;
```

- [ ] **Step 6: Run to verify pass**

Run: `cd src-tauri && cargo test domain::value`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd src-tauri && cargo fmt && cargo clippy --all-targets -- -D warnings
git add src/domain/value.rs src/domain/error.rs src/domain/mod.rs
git commit -m "feat(domain): FormValue instance type + DomainError"
```

---

## Task 3: Envelope serializer + `NsRegistry` (A2)

**Files:**
- Create: `src-tauri/src/engine/serialize.rs`.
- Modify: `src-tauri/src/engine/mod.rs` (add `pub mod serialize;`), `src-tauri/Cargo.toml` (add `quick-xml`).
- Test: inline in `serialize.rs`.

**Interfaces:**
- Consumes: `domain::schema::{SchemaNode, NodeKind, MaxOccurs}`, `domain::value::FormValue`, `domain::error::DomainError`.
- Produces:

```rust
pub struct SoapMeta { pub content_type: String, pub soap_action_header: Option<(String, String)> }
/// Returns the full envelope XML string for the given body element + form values.
pub fn build_envelope(schema: &SchemaNode, value: &FormValue, soap_version: &str, soap_action: &str)
    -> Result<(String, SoapMeta), DomainError>;
```

`soap_version` is `"1.1"` or `"1.2"`. `SoapMeta` tells the engine which Content-Type to send and, for 1.1, the `SOAPAction` header; for 1.2 the action is folded into `content_type` (`;action="..."`).

- [ ] **Step 1: Read `docs/soap-engine.md §3 + §4`** — namespace registry, `write_node`/`write_one`, the 1.1-vs-1.2 table.

- [ ] **Step 2: Add dep**

In `src-tauri/Cargo.toml` under `[dependencies]`:
```toml
quick-xml = "0.36"
```

- [ ] **Step 3: Write failing tests** (`serialize.rs`)

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::schema::*;
    use crate::domain::value::FormValue;

    fn leaf(name: &str, ns: Option<&str>) -> SchemaNode {
        SchemaNode {
            name: name.into(), namespace: ns.map(str::to_string),
            occurs: Occurs { min: 1, max: MaxOccurs::Bounded(1) },
            nillable: false, doc: None, attributes: vec![],
            kind: NodeKind::Leaf { xsd_type: XsdType::String, enum_values: vec![], default: None, fixed: None },
        }
    }

    #[test]
    fn sequence_with_namespaced_leaf_11() {
        let schema = SchemaNode {
            name: "Order".into(), namespace: Some("http://ex.com/t".into()),
            occurs: Occurs { min: 1, max: MaxOccurs::Bounded(1) },
            nillable: false, doc: None, attributes: vec![],
            kind: NodeKind::Sequence(vec![leaf("id", None)]),
        };
        let value = FormValue::Sequence(vec![FormValue::Leaf(Some("A1".into()))]);
        let (xml, meta) = build_envelope(&schema, &value, "1.1", "urn:place").unwrap();
        assert!(xml.contains("http://schemas.xmlsoap.org/soap/envelope/"));
        assert!(xml.contains(":Order"));            // root is namespaced (prefix ns0)
        assert!(xml.contains("<id>A1</id>") || xml.contains(":id"));
        assert_eq!(meta.content_type, "text/xml; charset=utf-8");
        assert_eq!(meta.soap_action_header, Some(("SOAPAction".into(), "\"urn:place\"".into())));
    }

    #[test]
    fn optional_omitted_is_not_emitted() {
        let mut opt = leaf("note", None);
        opt.occurs = Occurs { min: 0, max: MaxOccurs::Bounded(1) };
        let schema = SchemaNode { kind: NodeKind::Sequence(vec![opt]), ..leaf("Root", Some("http://ex.com/t")) };
        let value = FormValue::Sequence(vec![FormValue::Omitted]);
        let (xml, _) = build_envelope(&schema, &value, "1.2", "").unwrap();
        assert!(!xml.contains("note"));
    }

    #[test]
    fn v12_content_type_carries_action() {
        let (_, meta) = build_envelope(&leaf("Ping", Some("http://ex.com/t")),
            &FormValue::Leaf(Some("x".into())), "1.2", "urn:ping").unwrap();
        assert!(meta.content_type.starts_with("application/soap+xml"));
        assert!(meta.content_type.contains("action=\"urn:ping\""));
        assert_eq!(meta.soap_action_header, None);
    }
}
```

- [ ] **Step 4: Run to verify it fails**

Run: `cd src-tauri && cargo test engine::serialize`
Expected: FAIL — `serialize` module / `build_envelope` missing.

- [ ] **Step 5: Implement `serialize.rs`**

Implement per §4. Sketch (fill body writers completely):

```rust
use crate::domain::error::DomainError;
use crate::domain::schema::{MaxOccurs, NodeKind, SchemaNode};
use crate::domain::value::FormValue;
use quick_xml::events::{BytesEnd, BytesStart, BytesText, Event};
use quick_xml::Writer;
use std::collections::BTreeMap;
use std::io::Cursor;

const SOAP11: &str = "http://schemas.xmlsoap.org/soap/envelope/";
const SOAP12: &str = "http://www.w3.org/2003/05/soap-envelope";

pub struct SoapMeta { pub content_type: String, pub soap_action_header: Option<(String, String)> }

#[derive(Default)]
struct NsRegistry { map: Vec<(String, String)> } // (uri, prefix) in discovery order

impl NsRegistry {
    fn prefix_for(&mut self, uri: &str) -> String {
        if let Some((_, p)) = self.map.iter().find(|(u, _)| u == uri) { return p.clone(); }
        let p = format!("ns{}", self.map.len());
        self.map.push((uri.into(), p.clone()));
        p
    }
}

fn qualified(name: &str, ns: Option<&str>, reg: &mut NsRegistry) -> String {
    match ns {
        Some(uri) => format!("{}:{}", reg.prefix_for(uri), name),
        None => name.to_string(),
    }
}

fn write_node(w: &mut Writer<Cursor<Vec<u8>>>, node: &SchemaNode, value: &FormValue,
              reg: &mut NsRegistry, path: &str) -> Result<(), DomainError> {
    let repeatable = matches!(node.occurs.max, MaxOccurs::Unbounded)
        || matches!(node.occurs.max, MaxOccurs::Bounded(n) if n > 1);
    match (repeatable, value) {
        (true, FormValue::Repeated(items)) => {
            for (i, item) in items.iter().enumerate() {
                write_one(w, node, item, reg, &format!("{path}[{i}]"))?;
            }
            Ok(())
        }
        (_, FormValue::Omitted) => Ok(()),
        _ => write_one(w, node, value, reg, path),
    }
}

fn write_one(w: &mut Writer<Cursor<Vec<u8>>>, node: &SchemaNode, value: &FormValue,
             reg: &mut NsRegistry, path: &str) -> Result<(), DomainError> {
    let tag = qualified(&node.name, node.namespace.as_deref(), reg);
    match (&node.kind, value) {
        (_, FormValue::Nil) => {
            let mut start = BytesStart::new(&tag);
            start.push_attribute(("xsi:nil", "true"));
            w.write_event(Event::Empty(start)).unwrap();
        }
        (NodeKind::Leaf { .. }, FormValue::Leaf(v)) => {
            w.write_event(Event::Start(BytesStart::new(&tag))).unwrap();
            if let Some(s) = v { w.write_event(Event::Text(BytesText::new(s))).unwrap(); }
            w.write_event(Event::End(BytesEnd::new(&tag))).unwrap();
        }
        (NodeKind::Sequence(children), FormValue::Sequence(vals)) => {
            if children.len() != vals.len() { return Err(DomainError::ValueMismatch { path: path.into() }); }
            w.write_event(Event::Start(BytesStart::new(&tag))).unwrap();
            for (i, (c, v)) in children.iter().zip(vals).enumerate() {
                write_node(w, c, v, reg, &format!("{path}/{}", i))?;
            }
            w.write_event(Event::End(BytesEnd::new(&tag))).unwrap();
        }
        (NodeKind::Choice(branches), FormValue::Choice { branch, value }) => {
            let b = branches.get(*branch).ok_or(DomainError::ValueMismatch { path: path.into() })?;
            w.write_event(Event::Start(BytesStart::new(&tag))).unwrap();
            write_node(w, b, value, reg, &format!("{path}/choice"))?;
            w.write_event(Event::End(BytesEnd::new(&tag))).unwrap();
        }
        (NodeKind::Any, FormValue::Raw(xml)) => {
            // insert verbatim
            w.write_event(Event::Text(BytesText::from_escaped(xml.as_str()))).unwrap();
        }
        _ => return Err(DomainError::ValueMismatch { path: path.into() }),
    }
    Ok(())
}

pub fn build_envelope(schema: &SchemaNode, value: &FormValue, soap_version: &str, soap_action: &str)
    -> Result<(String, SoapMeta), DomainError> {
    let mut reg = NsRegistry::default();
    let mut body = Writer::new(Cursor::new(Vec::new()));
    write_node(&mut body, schema, value, &mut reg, "")?;
    let body_xml = String::from_utf8(body.into_inner().into_inner()).unwrap();

    let env_ns = if soap_version == "1.2" { SOAP12 } else { SOAP11 };
    // Declare soapenv + all discovered ns prefixes on the root.
    let mut decls = format!(" xmlns:soapenv=\"{env_ns}\" xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\"");
    let ns_map: BTreeMap<&str, &str> = reg.map.iter().map(|(u, p)| (p.as_str(), u.as_str())).collect();
    for (p, u) in ns_map { decls.push_str(&format!(" xmlns:{p}=\"{u}\"")); }
    let xml = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\
         <soapenv:Envelope{decls}><soapenv:Body>{body_xml}</soapenv:Body></soapenv:Envelope>"
    );

    let meta = if soap_version == "1.2" {
        SoapMeta {
            content_type: format!("application/soap+xml; charset=utf-8; action=\"{soap_action}\""),
            soap_action_header: None,
        }
    } else {
        SoapMeta {
            content_type: "text/xml; charset=utf-8".into(),
            soap_action_header: Some(("SOAPAction".into(), format!("\"{soap_action}\""))),
        }
    };
    Ok((xml, meta))
}
```

Note: `quick-xml` `BytesText::new` escapes text automatically. Attributes on nodes (`node.attributes`) and `default`/`fixed` prefill are the form's job (Task 9 seeds `FormValue`); the serializer emits exactly what the `FormValue` carries. If a leaf carries schema attributes, emit them from `node.attributes` on the `BytesStart` — add that once a real WSDL needs it (ponytail: attribute emission deferred until a test target uses simpleContent attributes; the leaf value path is the hero path).

- [ ] **Step 6: Run to verify pass**

Run: `cd src-tauri && cargo test engine::serialize`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd src-tauri && cargo fmt && cargo clippy --all-targets -- -D warnings
git add src/engine/serialize.rs src/engine/mod.rs Cargo.toml Cargo.lock
git commit -m "feat(engine): SOAP envelope serializer (quick-xml, NsRegistry, 1.1/1.2)"
```

---

## Task 4: Instrumented hyper engine + `TimingBreakdown` (A3)

**Files:**
- Create: `src-tauri/src/engine/connector.rs`, `src-tauri/src/engine/error.rs`.
- Modify: `src-tauri/src/engine/mod.rs` (`send` re-driven over `connector`; add `timing` to `HttpResponse`), `src-tauri/Cargo.toml`.
- Test: inline in `connector.rs` + keep existing `engine::mod` tests green.

**Interfaces:**
- Consumes: an assembled request (method, url, headers, body bytes).
- Produces:

```rust
#[derive(Debug, Serialize)] #[serde(rename_all = "camelCase")]
pub struct TimingBreakdown {
    pub dns_ms: Option<u64>, pub tcp_ms: Option<u64>, pub tls_ms: Option<u64>,
    pub ttfb_ms: u64, pub download_ms: u64, pub total_ms: u64,
}
pub enum EngineError { Dns(String), Connect(String), Tls(String), Send(String), Timeout, BodyRead(String) }
/// Low-level: one new connection, all phases stamped.
pub async fn execute(method: &str, url: &url::Url, headers: Vec<(String,String)>, body: Vec<u8>)
    -> Result<RawResponse, EngineError>;
pub struct RawResponse { pub status: u16, pub headers: Vec<(String,String)>, pub body: String, pub timing: TimingBreakdown }
```

`engine::HttpResponse` gains `pub timing: TimingBreakdown`.

- [ ] **Step 1: Read `docs/soap-engine.md §5`** (the phase waterfall) and `docs/stack.md` ADR-005/006 dep list. Study crate `ttfb` for the phase pattern.

- [ ] **Step 2: Add deps**

`src-tauri/Cargo.toml` under `[dependencies]`:
```toml
hyper = { version = "1", features = ["client", "http1"] }
hyper-util = { version = "0.1", features = ["tokio"] }
http-body-util = "0.1"
hickory-resolver = "0.24"
tokio-rustls = { version = "0.26", default-features = false, features = ["ring"] }
rustls = { version = "0.23", default-features = false, features = ["ring", "std"] }
rustls-native-certs = "0.8"
tokio = { version = "1", features = ["net", "rt", "macros", "io-util", "time"] }
```
(reqwest stays — WSDL fetch path.)

- [ ] **Step 3: Write failing test** (`connector.rs`) — hit a local server so DNS/TCP/TTFB are populated.

```rust
#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn execute_stamps_all_http_phases() {
        // Minimal local HTTP server on 127.0.0.1 (spawn a tokio TcpListener that writes a canned
        // 200 response), then call execute against it.
        let addr = spawn_canned_200().await; // helper: returns "http://127.0.0.1:PORT/"
        let url = url::Url::parse(&addr).unwrap();
        let r = execute("GET", &url, vec![], vec![]).await.unwrap();
        assert_eq!(r.status, 200);
        assert!(r.timing.dns_ms.is_some());
        assert!(r.timing.tcp_ms.is_some());
        assert!(r.timing.tls_ms.is_none());       // plain http
        assert!(r.timing.total_ms >= r.timing.ttfb_ms);
    }
}
```

Write `spawn_canned_200` in the test module: bind `tokio::net::TcpListener` to `127.0.0.1:0`, `tokio::spawn` a task that accepts one connection and writes `HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok`, return the `http://127.0.0.1:{port}/` string.

- [ ] **Step 4: Run to verify it fails**

Run: `cd src-tauri && cargo test engine::connector`
Expected: FAIL — module missing.

- [ ] **Step 5: Implement `error.rs`**

```rust
use thiserror::Error;
#[derive(Debug, Error)]
pub enum EngineError {
    #[error("DNS: {0}")] Dns(String),
    #[error("connect: {0}")] Connect(String),
    #[error("TLS: {0}")] Tls(String),
    #[error("send: {0}")] Send(String),
    #[error("request timed out")] Timeout,
    #[error("body read: {0}")] BodyRead(String),
}
```

- [ ] **Step 6: Implement `connector.rs`** per §5: resolve host with `hickory-resolver` (stamp `dns_ms`), `TcpStream::connect` (`tcp_ms`), if `https` wrap with `tokio_rustls::TlsConnector` built from `rustls-native-certs` (`tls_ms`), `hyper::client::conn::http1::handshake`, spawn the connection driver, `send_request` (`ttfb_ms`), collect body with `http-body-util` (`download_ms`), `total_ms` from `t0`. Build the `rustls::ClientConfig` once via `std::sync::OnceLock`. Wrap the whole thing in `tokio::time::timeout(Duration::from_secs(30), …)` → `EngineError::Timeout`.

- [ ] **Step 7: Re-drive `engine::send`** — in `engine/mod.rs`, keep `build_request`'s logic for assembling method/query/auth/headers/body, but produce `(method, url, headers, body_bytes)` and call `connector::execute` instead of reqwest. Add `pub mod connector; pub mod error;`. Add `timing: TimingBreakdown` to `HttpResponse` and populate it from `RawResponse.timing`. Map `EngineError` → the `String` error the command layer already expects. Keep the existing `#[cfg(test)]` `build_request` unit tests compiling — if `build_request` no longer returns a `reqwest::Request`, update those tests to assert on the new assembled tuple (method/url/query) rather than deleting them.

- [ ] **Step 8: Run to verify pass**

Run: `cd src-tauri && cargo test engine`
Expected: PASS — new connector test + existing send/build tests green.

- [ ] **Step 9: Manual REST smoke** — `pnpm tauri dev`, send an existing REST request against a public HTTPS endpoint, confirm 200 + a populated Timing tab (Task 12 renders it; for now confirm `timing` is in the JSON via a `console.log` or the raw response). Confirm no OpenSSL pulled: `cargo tree -i openssl-sys` must error ("nothing depends on it").

- [ ] **Step 10: Commit**

```bash
cd src-tauri && cargo fmt && cargo clippy --all-targets -- -D warnings
git add src/engine/connector.rs src/engine/error.rs src/engine/mod.rs Cargo.toml Cargo.lock
git commit -m "feat(engine): instrumented hyper transport with per-phase TimingBreakdown"
```

---

## Task 5: SOAP fault detection (A4)

**Files:**
- Create: `src-tauri/src/engine/fault.rs`.
- Modify: `src-tauri/src/engine/mod.rs` (`pub mod fault;`, add `fault: Option<SoapFault>` to `HttpResponse`).
- Test: inline in `fault.rs`.

**Interfaces:**
- Produces:

```rust
#[derive(Debug, Serialize)] #[serde(rename_all = "camelCase")]
pub struct SoapFault { pub code: String, pub reason: String, pub detail: Option<String>, pub actor: Option<String> }
/// Parse a response body for a SOAP Fault (1.1 or 1.2). None if not a fault / not XML.
pub fn detect_fault(body: &str) -> Option<SoapFault>;
```

- [ ] **Step 1: Read `docs/soap-engine.md §6`** (fault detection: 1.1 `faultcode`/`faultstring`, 1.2 `Code`/`Reason`).

- [ ] **Step 2: Write failing tests** (`fault.rs`)

```rust
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn detects_soap_11_fault() {
        let xml = r#"<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
          <soap:Body><soap:Fault><faultcode>soap:Server</faultcode>
          <faultstring>boom</faultstring></soap:Fault></soap:Body></soap:Envelope>"#;
        let f = detect_fault(xml).unwrap();
        assert_eq!(f.code, "soap:Server");
        assert_eq!(f.reason, "boom");
    }
    #[test]
    fn detects_soap_12_fault() {
        let xml = r#"<env:Envelope xmlns:env="http://www.w3.org/2003/05/soap-envelope">
          <env:Body><env:Fault><env:Code><env:Value>env:Receiver</env:Value></env:Code>
          <env:Reason><env:Text>bad</env:Text></env:Reason></env:Fault></env:Body></env:Envelope>"#;
        let f = detect_fault(xml).unwrap();
        assert_eq!(f.code, "env:Receiver");
        assert_eq!(f.reason, "bad");
    }
    #[test]
    fn no_fault_on_success() {
        assert!(detect_fault("<a><b>ok</b></a>").is_none());
    }
}
```

- [ ] **Step 3: Run to verify it fails** — `cd src-tauri && cargo test engine::fault` → FAIL (module missing).

- [ ] **Step 4: Implement `fault.rs`** with `roxmltree`: parse; find any element whose local name is `Fault`; read `faultcode`/`faultstring` (1.1) or `Code//Value` + `Reason//Text` (1.2) by local name (ignore prefixes). Return `None` on parse error or no `Fault`.

- [ ] **Step 5: Wire into responses** — in `engine/mod.rs` add `pub fault: Option<SoapFault>` to `HttpResponse`; in `send`, set `fault: fault::detect_fault(&body)` only when the response Content-Type is XML/soap (else `None`).

- [ ] **Step 6: Run to verify pass** — `cd src-tauri && cargo test engine` → PASS.

- [ ] **Step 7: Commit**

```bash
cd src-tauri && cargo fmt && cargo clippy --all-targets -- -D warnings
git add src/engine/fault.rs src/engine/mod.rs
git commit -m "feat(engine): SOAP fault detection (1.1/1.2), fault field on HttpResponse"
```

---

## Task 6: `send_soap` command (A5)

**Files:**
- Modify: `src-tauri/src/commands/mod.rs`, `src-tauri/src/lib.rs`.
- Test: covered by frontend E2E + the manual step here (command is a thin composition of already-tested units).

**Interfaces:**
- Consumes: `wsdl::resolve::resolve`, `wsdl::xsd::build_schema`, `engine::serialize::build_envelope`, `engine::send`/`connector::execute`, `commands::{http_client, fetch_text}`.
- Produces: `#[tauri::command] async fn send_soap(...) -> Result<engine::HttpResponse, String>`.

- [ ] **Step 1: Implement `send_soap`** in `commands/mod.rs` (mirror `get_operation_schema`'s fetch/resolve prelude, then serialize + send):

```rust
use crate::domain::value::FormValue;

#[tauri::command]
pub async fn send_soap(
    wsdl_url: String,
    input_element: QName,
    endpoint: String,
    soap_action: String,
    soap_version: String,
    value: FormValue,
) -> Result<engine::HttpResponse, String> {
    let client = http_client()?;
    let fetch = |u: String| { let client = client.clone(); async move { fetch_text(&client, &u).await } };
    let root_xml = fetch(wsdl_url.clone()).await.map_err(|message| {
        wsdl::error::WsdlError::Fetch { url: wsdl_url.clone(), message }.to_string()
    })?;
    let set = wsdl::resolve::resolve(&wsdl_url, &root_xml, fetch).await.map_err(|e| e.to_string())?;
    let schema = wsdl::xsd::build_schema(&set, &input_element).map_err(|e| e.to_string())?;

    let (envelope, meta) = engine::serialize::build_envelope(&schema, &value, &soap_version, &soap_action)
        .map_err(|e| e.to_string())?;

    engine::send_soap_envelope(&endpoint, envelope, meta).await
}
```

- [ ] **Step 2: Add `engine::send_soap_envelope`** to `engine/mod.rs` — POST the envelope to `endpoint` with `meta.content_type` and (if present) `meta.soap_action_header`, via `connector::execute`, returning the `HttpResponse` (with `timing` + `fault`). Reuse the same `RawResponse → HttpResponse` mapping as `send`.

- [ ] **Step 3: Register** in `src-tauri/src/lib.rs` `generate_handler![ … , commands::send_soap ]`.

- [ ] **Step 4: Compile check** — `cd src-tauri && cargo build`. Expected: clean.

- [ ] **Step 5: Commit**

```bash
cd src-tauri && cargo fmt && cargo clippy --all-targets -- -D warnings
git add src/commands/mod.rs src/lib.rs src/engine/mod.rs
git commit -m "feat(commands): send_soap — resolve schema, serialize envelope, POST via engine"
```

---

## Task 7: Frontend types + API wrappers (B1)

**Files:**
- Modify: `src/lib/api.ts`, `src/lib/response-types.ts`.

**Interfaces:**
- Produces: `SchemaNode`, `NodeKind`, `XsdType`, `Occurs`, `MaxOccurs`, `Attribute`, `FormValue`, `TimingBreakdown`, `SoapFault` TS types; `api.getOperationSchema`, `api.sendSoap`.

- [ ] **Step 1: Add types to `api.ts`** (mirror the Rust serde shapes exactly; `WsdlQName` already exists):

```ts
export type MaxOccurs = { bounded: number } | "unbounded";
export interface Occurs { min: number; max: MaxOccurs }
export type XsdType =
  | "string" | "boolean" | "integer" | "decimal" | "double"
  | "date" | "dateTime" | "time" | "gYearMonth" | "base64Binary"
  | { other: string };
export interface Attribute {
  name: string; xsdType: XsdType; required: boolean; enumValues: string[]; default: string | null;
}
export type NodeKind =
  | { leaf: { xsdType: XsdType; enumValues: string[]; default: string | null; fixed: string | null } }
  | { sequence: SchemaNode[] }
  | { choice: SchemaNode[] }
  | "any";
export interface SchemaNode {
  name: string; namespace: string | null; occurs: Occurs; nillable: boolean;
  doc: string | null; attributes: Attribute[]; kind: NodeKind;
}
export type FormValue =
  | { leaf: string | null }
  | { sequence: FormValue[] }
  | { choice: { branch: number; value: FormValue } }
  | { repeated: FormValue[] }
  | "nil" | "omitted"
  | { raw: string };
```

Note: Rust `enum` externally tagged serializes a unit-struct enum variant like `MaxOccurs::Bounded(u32)` as `{"bounded": n}` and `Unbounded` as `"unbounded"` — the TS above matches. Verify against a real `getOperationSchema` response in Step 4.

- [ ] **Step 2: Add to `response-types.ts`**

```ts
export interface TimingBreakdown {
  dnsMs: number | null; tcpMs: number | null; tlsMs: number | null;
  ttfbMs: number; downloadMs: number; totalMs: number;
}
export interface SoapFault { code: string; reason: string; detail: string | null; actor: string | null }
```
Extend `HttpResponse` with `timing: TimingBreakdown;` and `fault?: SoapFault | null;`.

- [ ] **Step 3: Add wrappers to the `api` object in `api.ts`**

```ts
  getOperationSchema: (wsdlUrl: string, inputElement: WsdlQName) =>
    invoke<SchemaNode>("get_operation_schema", { wsdlUrl, inputElement }),

  sendSoap: (spec: {
    wsdlUrl: string; inputElement: WsdlQName; endpoint: string;
    soapAction: string; soapVersion: string; value: FormValue;
  }) => invoke<HttpResponse>("send_soap", spec),
```
Import `FormValue`/`SchemaNode` are same-file; import `HttpResponse` (already imported).

- [ ] **Step 4: Verify shapes** — `pnpm tauri dev`, temporarily call `api.getOperationSchema` for an imported operation from a scratch button or the console; confirm the returned object matches `SchemaNode` (no `undefined` where a field is expected). Fix the `MaxOccurs`/`XsdType` tags if serde emits a different casing.

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm tsc --noEmit
git add src/lib/api.ts src/lib/response-types.ts
git commit -m "feat(api): SchemaNode/FormValue/timing TS types + getOperationSchema/sendSoap wrappers"
```

---

## Task 8: SOAP form state store + defaults (B2)

**Files:**
- Create: `src/store/soapForm.ts`.
- Test: `src/store/soapForm.test.ts` (Vitest).

**Interfaces:**
- Consumes: `SchemaNode`, `NodeKind`, `FormValue` from `api.ts`.
- Produces:

```ts
export function defaultFormValue(node: SchemaNode): FormValue;
export function setLeafAt(root: FormValue, path: number[], text: string | null): FormValue; // immutable
```

`defaultFormValue`: required leaf → `{leaf: default ?? ""}` (fixed → `{leaf: fixed}`); optional (min=0) → `"omitted"`; repeatable → `{repeated: []}`; sequence → `{sequence: children.map(defaultFormValue)}`; choice → `{choice:{branch:0, value: defaultFormValue(branches[0])}}`; any → `{raw: ""}`. `path` indexes into sequence children / choice value for immutable updates.

- [ ] **Step 1: Write failing tests** (`soapForm.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import { defaultFormValue } from "./soapForm";
import type { SchemaNode } from "../lib/api";

const leaf = (name: string, min = 1, def: string | null = null): SchemaNode => ({
  name, namespace: null, occurs: { min, max: { bounded: 1 } }, nillable: false,
  doc: null, attributes: [], kind: { leaf: { xsdType: "string", enumValues: [], default: def, fixed: null } },
});

describe("defaultFormValue", () => {
  it("required leaf → empty string; optional → omitted", () => {
    expect(defaultFormValue(leaf("a"))).toEqual({ leaf: "" });
    expect(defaultFormValue(leaf("b", 0))).toEqual("omitted");
  });
  it("default prefills", () => {
    expect(defaultFormValue(leaf("c", 1, "X"))).toEqual({ leaf: "X" });
  });
  it("sequence recurses in order", () => {
    const seq: SchemaNode = { ...leaf("Root"), kind: { sequence: [leaf("a"), leaf("b", 0)] } };
    expect(defaultFormValue(seq)).toEqual({ sequence: [{ leaf: "" }, "omitted"] });
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm test soapForm` → FAIL (module missing).

- [ ] **Step 3: Implement `soapForm.ts`** per the interface above.

- [ ] **Step 4: Run to verify pass** — `pnpm test soapForm` → PASS.

- [ ] **Step 5: Wire schema fetch on open** — in `src/lib/request-types.ts` add to `OpenRequest`:

```ts
  soap?: {
    meta: { wsdlUrl: string; inputElement: WsdlQName; endpoint: string; soapAction: string; soapVersion: string };
    schema: SchemaNode | null;   // null while loading
    value: FormValue;
  };
```
In `src/store/requestStore.ts` `openRequest`, after loading the request file: if `data.kind === "soap"`, build `req.soap = { meta, schema: null, value: {sequence: []} }`, then after the state set, call `api.getOperationSchema(meta.wsdlUrl, meta.inputElement)` and patch `soap.schema` + `soap.value = defaultFormValue(schema)`. (`fromFile` must carry the soap meta from `RequestFileData` — extend `RequestFileData` in `api.ts` with the soap fields if not already present, reading from the request file the same way REST fields are read.) `saveRequest` stays a no-op for soap (values not persisted this slice).

- [ ] **Step 6: Typecheck + commit**

```bash
pnpm tsc --noEmit && pnpm test soapForm
git add src/store/soapForm.ts src/store/soapForm.test.ts src/lib/request-types.ts src/store/requestStore.ts src/lib/api.ts
git commit -m "feat(store): SOAP form value defaults + fetch schema on open"
```

---

## Task 9: `SchemaForm` recursive renderer (C1)

**Files:**
- Create: `src/components/request/soap/SchemaForm.tsx`, `src/components/request/soap/SchemaNodeField.tsx`, `src/components/request/soap/LeafField.tsx`.
- Modify: `src/components/request/RequestPanel.tsx` (branch SOAP → `SchemaForm`).
- Test: `src/components/request/soap/SchemaForm.test.tsx` (Vitest + Testing Library).

**Interfaces:**
- Consumes: `SchemaNode`, `FormValue`, `defaultFormValue` (Task 8).
- Produces: `<SchemaForm schema value onChange />` where `onChange(next: FormValue)` bubbles the whole updated tree. `SchemaNodeField` renders one node by kind; `LeafField` renders a typed input / enum dropdown / read-only fixed.

- [ ] **Step 1: Write failing test** (`SchemaForm.test.tsx`)

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SchemaForm } from "./SchemaForm";
import type { SchemaNode } from "../../../lib/api";

const seq: SchemaNode = {
  name: "Order", namespace: null, occurs: { min: 1, max: { bounded: 1 } }, nillable: false,
  doc: null, attributes: [],
  kind: { sequence: [{
    name: "id", namespace: null, occurs: { min: 1, max: { bounded: 1 } }, nillable: false,
    doc: null, attributes: [], kind: { leaf: { xsdType: "string", enumValues: [], default: null, fixed: null } },
  }] },
};

describe("SchemaForm", () => {
  it("edits a leaf and emits the updated FormValue tree", () => {
    const onChange = vi.fn();
    render(<SchemaForm schema={seq} value={{ sequence: [{ leaf: "" }] }} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("id"), { target: { value: "A1" } });
    expect(onChange).toHaveBeenCalledWith({ sequence: [{ leaf: "A1" }] });
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm test SchemaForm` → FAIL (module missing).

- [ ] **Step 3: Implement** `LeafField` (input by `xsdType`: `date`→`type=date`, `dateTime`→`datetime-local`, `integer`/`decimal`/`double`→`type=number`, `boolean`→checkbox, else text; non-empty `enumValues`→`<select>`; `fixed`→read-only), `SchemaNodeField` (switch on `kind`: leaf→`LeafField`; sequence→map children, replacing child value at index immutably; choice→branch `<select>` + render chosen branch; `occurs.optional()`→a remove/add toggle producing `"omitted"`; `occurs.repeatable()`→list with add/remove producing `{repeated:[...]}`; nillable→a nil checkbox producing `"nil"`; any→a `<textarea>` producing `{raw}`, with a hint switched on `doc` (`"unsupported: edit raw"` vs `"recursive: expand on demand"`)), and `SchemaForm` (renders the root `SchemaNodeField`). Use CVA + `cn()`, tokens only, named exports. Each `LeafField` sets `aria-label={node.name}` (the test relies on it and it's a11y baseline).

- [ ] **Step 4: Run to verify pass** — `pnpm test SchemaForm` → PASS.

- [ ] **Step 5: Branch `RequestPanel`** — when the active request has `.soap`, render `<SchemaForm schema value onChange>` (onChange → a new `requestStore` action `setSoapValue(id, next)` that patches `openRequests[id].soap.value`), with a loading state while `soap.schema === null`. REST path unchanged.

- [ ] **Step 6: Manual check** — `pnpm tauri dev`, import a WSDL, click an operation, confirm the form renders and typing updates state (React devtools / a temporary log).

- [ ] **Step 7: Typecheck + commit**

```bash
pnpm tsc --noEmit && pnpm test SchemaForm
git add src/components/request/soap/ src/components/request/RequestPanel.tsx src/store/requestStore.ts
git commit -m "feat(ui): SchemaForm — recursive schema-generated SOAP input form"
```

---

## Task 10: `XmlTree` response viewer + copy-leaf (C2)

**Files:**
- Create: `src/components/response/body/XmlTree.tsx`.
- Modify: `src/components/response/body/ResponseBodyView.tsx` (pick XML vs JSON).
- Test: `src/components/response/body/XmlTree.test.tsx` (Vitest).

**Interfaces:**
- Consumes: `response.body: string`.
- Produces: `<XmlTree xml={string} />` — expandable tree; each leaf has a copy button that writes **only the text value** (no tag/prefix) via `navigator.clipboard.writeText`.

- [ ] **Step 1: Read `src/components/response/body/JsonTree.tsx`** — mirror its expand/collapse + `LeafNode` copy pattern (differentiator #2).

- [ ] **Step 2: Write failing test** (`XmlTree.test.tsx`)

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { XmlTree } from "./XmlTree";

describe("XmlTree", () => {
  it("renders element leaf values and copies the bare value", async () => {
    const writeText = vi.fn();
    Object.assign(navigator, { clipboard: { writeText } });
    render(<XmlTree xml={`<r><ns2:name>Ada</ns2:name></r>`} />);
    expect(screen.getByText("Ada")).toBeInTheDocument();
    screen.getByRole("button", { name: /copy/i }).click();
    expect(writeText).toHaveBeenCalledWith("Ada");
  });
});
```

- [ ] **Step 3: Run to verify it fails** — `pnpm test XmlTree` → FAIL (module missing).

- [ ] **Step 4: Implement `XmlTree.tsx`** — parse with `new DOMParser().parseFromString(xml, "application/xml")`; walk `documentElement`. A node with only a text child is a leaf (key = `tagName`, value = `textContent`); a node with element children is a branch. Render like `JsonTree`: prefixes (`ns2:`) shown dimmed via a token color; copy button copies `textContent` only. On parse error (`<parsererror>`), fall back to a raw `<pre>`.

- [ ] **Step 5: Route in `ResponseBodyView`** — choose `XmlTree` when the body trims to start with `<` (or content-type is XML), else `JsonTree`. Raw view unchanged.

- [ ] **Step 6: Run to verify pass** — `pnpm test XmlTree` → PASS.

- [ ] **Step 7: Typecheck + commit**

```bash
pnpm tsc --noEmit && pnpm test XmlTree
git add src/components/response/body/XmlTree.tsx src/components/response/body/ResponseBodyView.tsx
git commit -m "feat(ui): XmlTree response viewer with copy-leaf for SOAP/XML"
```

---

## Task 11: Waterfall UI (C3)

**Files:**
- Create: `src/components/response/Waterfall.tsx`.
- Modify: `src/components/response/ResponsePanel.tsx` (replace `TimingStub`), `src/App.css` (timing tokens).
- Test: `src/components/response/Waterfall.test.tsx` (Vitest).

**Interfaces:**
- Consumes: `TimingBreakdown` (Task 7).
- Produces: `<Waterfall timing={TimingBreakdown} />` — one proportional bar per phase; `null` phases (reused connection) hidden.

- [ ] **Step 1: Add tokens to `src/App.css`** (next to the `--color-status-*` block):

```css
  --color-timing-dns: #a78bfa;
  --color-timing-tcp: #58a6ff;
  --color-timing-tls: #3fb950;
  --color-timing-ttfb: #e3b341;
  --color-timing-download: #ff8400;
```

- [ ] **Step 2: Write failing test** (`Waterfall.test.tsx`)

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Waterfall } from "./Waterfall";

describe("Waterfall", () => {
  it("shows measured phases and hides null ones", () => {
    render(<Waterfall timing={{ dnsMs: 12, tcpMs: 8, tlsMs: null, ttfbMs: 40, downloadMs: 5, totalMs: 65 }} />);
    expect(screen.getByText(/DNS/)).toBeInTheDocument();
    expect(screen.getByText(/TTFB/)).toBeInTheDocument();
    expect(screen.queryByText(/TLS/)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run to verify it fails** — `pnpm test Waterfall` → FAIL (module missing).

- [ ] **Step 4: Implement `Waterfall.tsx`** — list phases `[DNS, TCP, TLS, TTFB, Download]`, skip `null`, render each as a labeled row with a bar whose width is `phase/totalMs * 100%` using the matching `--color-timing-*` token; show `Xms` per phase and `totalMs` total. CVA + `cn()`, tokens only.

- [ ] **Step 5: Wire into `ResponsePanel`** — replace `{activeTab === "timing" && <TimingStub />}` with `<Waterfall timing={response.timing} />`; delete `TimingStub`.

- [ ] **Step 6: Run to verify pass** — `pnpm test Waterfall` → PASS.

- [ ] **Step 7: Typecheck + commit**

```bash
pnpm tsc --noEmit && pnpm test Waterfall
git add src/components/response/Waterfall.tsx src/components/response/ResponsePanel.tsx src/App.css
git commit -m "feat(ui): real per-phase timing waterfall (REST + SOAP)"
```

---

## Task 12: Wire SOAP Send + fault-as-error (C4)

**Files:**
- Modify: `src/store/responseStore.ts` (SOAP send path), the Send trigger for SOAP requests, `src/components/response/ResponsePanel.tsx` (render fault as error).
- Test: manual end-to-end (the hero flow).

**Interfaces:**
- Consumes: `api.sendSoap` (Task 7), `OpenRequest.soap` (Task 8), `HttpResponse.fault` (Tasks 5/7).

- [ ] **Step 1: SOAP branch in `responseStore.send`** — if `request.soap` is present, call `api.sendSoap({ ...request.soap.meta, value: request.soap.value })` instead of `api.sendRequest`; keep the same `seq`/loading/error handling.

- [ ] **Step 2: Fault renders as error** — in `ResponsePanel`, when `entry.state === "done" && response.fault`, render the fault (`code` / `reason` / `detail`) in the error styling (reuse `ErrorView`'s treatment / status-5xx tokens), never the success/green path. Body tab still shows the Xml tree.

- [ ] **Step 3: Ensure the Send button reaches SOAP requests** — verify whichever component triggers `useResponseStore.send` passes the full `OpenRequest` (with `.soap`); if Send is gated on REST fields, add the SOAP path.

- [ ] **Step 4: End-to-end manual verification (the hero flow)** — `pnpm tauri dev`:
  1. Import a real WSDL (e.g. a public calculator/temperature-convert WSDL).
  2. Click an operation → form renders from the schema.
  3. Fill required fields → Send.
  4. Response shows the XML tree (copy a leaf → clipboard has the bare value), the Timing tab shows a populated waterfall (DNS/TCP/TLS/TTFB/download).
  5. Trigger a fault (send an invalid value) → response renders as a structured error, not green.

- [ ] **Step 5: Full test suite green**

```bash
cd src-tauri && cargo test && cargo clippy --all-targets -- -D warnings && cd .. && pnpm test && pnpm tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add src/store/responseStore.ts src/components/response/ResponsePanel.tsx
git commit -m "feat(ui): wire SOAP Send end-to-end + render soap:Fault as error"
```

---

## Self-review notes (coverage)

- Spec A0–A5, B1–B2, C1–C4 → Tasks 1–12 (A4 fault is Task 5; A3 engine Task 4; ordered engine-before-fault so `HttpResponse.timing` exists first).
- Divergences carried from the spec: XML parsed in the frontend (`XmlTree`, Task 10) not Rust `ResponseNode`; reqwest kept for WSDL fetch (Global Constraints). Both flagged in the spec + here.
- Deferred (ponytail, noted at their tasks): leaf attribute emission in the serializer (Task 3) until a simpleContent-attribute target needs it; persisting filled form values (Task 8); `expand_schema_node` real lazy expansion (Task 9 renders raw editor for the recursion marker instead). All match the spec's "Out of scope".
- Differentiators exercised: #1 SchemaForm (Task 9), #2 copy-leaf XML (Task 10), #3 waterfall (Task 11), hero flow end-to-end (Task 12).
