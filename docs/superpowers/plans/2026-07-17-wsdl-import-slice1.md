# WSDL Import — Slice 1 (parse + resolve, URL only) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import a WSDL by URL — parse operations, transitively resolve external schemas, preview in a modal, confirm into the sidebar as a SOAP collection.

**Architecture:** New pure `wsdl::parse` (roxmltree over fetched bytes) and `wsdl::resolve` (the only I/O — fetch injected as an async closure so tests run without network). Thin `import_wsdl`/`confirm_wsdl_import` commands reuse the existing reqwest client and `persistence::collection`. Frontend: a `wsdlImportStore` (zustand, same shape as `responseStore`) driving `ImportWsdlModal`.

**Tech Stack:** Rust (roxmltree, thiserror, url, reqwest rustls-only), Tauri v2 commands, React 19 + zustand + Vitest.

**Spec:** `docs/superpowers/specs/2026-07-17-wsdl-import-slice1-design.md`

## Global Constraints

- rustls only — never OpenSSL/native-tls (CLAUDE.md).
- Domain stays pure: no I/O in `domain/`; `wsdl::resolve` is the ONLY place fetching schemas.
- Reject rpc/encoded explicitly (`WsdlError::UnsupportedStyle`, ADR-010).
- Never import partial results: any failure aborts the whole import with the failing URL.
- Commands are thin: validate + delegate only.
- TS: no `any`; async via `lib/api.ts` wrappers (this repo uses hand-typed `invoke` wrappers — there is no tauri-specta/bindings.ts despite CLAUDE.md; follow the existing pattern).
- UI: tokens from `styles/tokens.css` only; `cn()` for class merging; named exports.
- Commits: Conventional Commits, single line.
- `docs/` is gitignored — plan/spec files need `git add -f`.
- Deviation from spec (agreed): `xsd:import` without `schemaLocation` is skipped (legal and common in real WSDLs), so there is no `MissingSchemaLocation` error variant.

---

### Task 1: `wsdl::parse` — operations from a WSDL

**Files:**
- Modify: `src-tauri/Cargo.toml` (add deps)
- Create: `src-tauri/src/domain/mod.rs`, `src-tauri/src/domain/wsdl.rs`
- Create: `src-tauri/src/wsdl/mod.rs`, `src-tauri/src/wsdl/error.rs`, `src-tauri/src/wsdl/parse.rs`
- Create: `src-tauri/src/wsdl/testdata/calculator.wsdl`, `calculator12.wsdl`, `rpc.wsdl`
- Modify: `src-tauri/src/lib.rs` (declare modules)

**Interfaces:**
- Produces: `domain::wsdl::{QName, SoapVersion, OperationRef}`; `wsdl::error::WsdlError`; `wsdl::parse::parse(url: &str, xml: &str) -> Result<WsdlDocument, WsdlError>` with `WsdlDocument { service_name: String, operations: Vec<OperationRef> }`.

- [ ] **Step 1: Add dependencies**

In `src-tauri/Cargo.toml` `[dependencies]`:

```toml
roxmltree = "0.20"
thiserror = "2"
url = "2"
```

Run: `cargo check` (inside `src-tauri/`). Expected: compiles (deps resolve).

- [ ] **Step 2: Domain types**

`src-tauri/src/domain/mod.rs`:

```rust
pub mod wsdl;
```

`src-tauri/src/domain/wsdl.rs`:

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QName {
    pub namespace: String,
    pub local: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub enum SoapVersion {
    #[serde(rename = "1.1")]
    V11,
    #[serde(rename = "1.2")]
    V12,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationRef {
    pub name: String,
    pub endpoint: String,
    pub soap_action: String,
    pub soap_version: SoapVersion,
    pub input_element: QName,
}
```

`src-tauri/src/wsdl/error.rs`:

```rust
use thiserror::Error;

#[derive(Debug, Error)]
pub enum WsdlError {
    #[error("failed to fetch {url}: {message}")]
    Fetch { url: String, message: String },
    #[error("invalid XML in {url}: {message}")]
    InvalidXml { url: String, message: String },
    #[error("unsupported WSDL style: rpc/encoded is not supported (only document/literal)")]
    UnsupportedStyle,
    #[error("not found in WSDL: {qname}")]
    ElementNotFound { qname: String },
}
```

`src-tauri/src/wsdl/mod.rs`:

```rust
pub mod error;
pub mod parse;
```

In `src-tauri/src/lib.rs`, next to the existing `mod` declarations add:

```rust
mod domain;
mod wsdl;
```

- [ ] **Step 3: Fixtures**

`src-tauri/src/wsdl/testdata/calculator.wsdl` (SOAP 1.1 doc/literal, two operations):

```xml
<definitions xmlns="http://schemas.xmlsoap.org/wsdl/"
             xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/"
             xmlns:tns="http://example.com/calc"
             xmlns:xs="http://www.w3.org/2001/XMLSchema"
             targetNamespace="http://example.com/calc">
  <types>
    <xs:schema targetNamespace="http://example.com/calc">
      <xs:element name="Add">
        <xs:complexType><xs:sequence>
          <xs:element name="a" type="xs:int"/>
          <xs:element name="b" type="xs:int"/>
        </xs:sequence></xs:complexType>
      </xs:element>
      <xs:element name="Subtract">
        <xs:complexType><xs:sequence>
          <xs:element name="a" type="xs:int"/>
          <xs:element name="b" type="xs:int"/>
        </xs:sequence></xs:complexType>
      </xs:element>
    </xs:schema>
  </types>
  <message name="AddIn"><part name="parameters" element="tns:Add"/></message>
  <message name="SubtractIn"><part name="parameters" element="tns:Subtract"/></message>
  <portType name="CalcPort">
    <operation name="Add"><input message="tns:AddIn"/></operation>
    <operation name="Subtract"><input message="tns:SubtractIn"/></operation>
  </portType>
  <binding name="CalcBinding" type="tns:CalcPort">
    <soap:binding style="document" transport="http://schemas.xmlsoap.org/soap/http"/>
    <operation name="Add">
      <soap:operation soapAction="http://example.com/calc/Add"/>
      <input><soap:body use="literal"/></input>
    </operation>
    <operation name="Subtract">
      <soap:operation soapAction="http://example.com/calc/Subtract"/>
      <input><soap:body use="literal"/></input>
    </operation>
  </binding>
  <service name="CalcService">
    <port name="CalcPort" binding="tns:CalcBinding">
      <soap:address location="http://example.com/calc"/>
    </port>
  </service>
</definitions>
```

`calculator12.wsdl`: copy of the above with these three substitutions —
`xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap12/"`, service name `CalcService12`, and keep everything else identical (the soap12 namespace on `soap:binding`/`soap:address` is what flips version detection).

`rpc.wsdl`: copy of `calculator.wsdl` with `<soap:binding style="rpc" ...>`.

- [ ] **Step 4: Write failing tests**

Test module at the bottom of `src-tauri/src/wsdl/parse.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::wsdl::SoapVersion;
    use crate::wsdl::error::WsdlError;

    const CALC: &str = include_str!("testdata/calculator.wsdl");
    const CALC12: &str = include_str!("testdata/calculator12.wsdl");
    const RPC: &str = include_str!("testdata/rpc.wsdl");

    #[test]
    fn parses_doc_literal_11() {
        let doc = parse("http://example.com/calc?wsdl", CALC).unwrap();
        assert_eq!(doc.service_name, "CalcService");
        assert_eq!(doc.operations.len(), 2);
        let add = &doc.operations[0];
        assert_eq!(add.name, "Add");
        assert_eq!(add.endpoint, "http://example.com/calc");
        assert_eq!(add.soap_action, "http://example.com/calc/Add");
        assert_eq!(add.soap_version, SoapVersion::V11);
        assert_eq!(add.input_element.namespace, "http://example.com/calc");
        assert_eq!(add.input_element.local, "Add");
    }

    #[test]
    fn detects_soap_12() {
        let doc = parse("u", CALC12).unwrap();
        assert_eq!(doc.operations[0].soap_version, SoapVersion::V12);
    }

    #[test]
    fn rejects_rpc_style() {
        assert!(matches!(parse("u", RPC), Err(WsdlError::UnsupportedStyle)));
    }

    #[test]
    fn rejects_invalid_xml() {
        assert!(matches!(
            parse("http://x/bad", "<definitions"),
            Err(WsdlError::InvalidXml { url, .. }) if url == "http://x/bad"
        ));
    }
}
```

- [ ] **Step 5: Run tests to verify they fail**

Run: `cargo test wsdl::parse` (inside `src-tauri/`). Expected: FAIL — `parse` not defined (compile error).

- [ ] **Step 6: Implement `parse`**

`src-tauri/src/wsdl/parse.rs`:

```rust
use crate::domain::wsdl::{OperationRef, QName, SoapVersion};
use crate::wsdl::error::WsdlError;
use roxmltree::{Document, Node};
use std::collections::HashMap;

const WSDL_NS: &str = "http://schemas.xmlsoap.org/wsdl/";
const SOAP11_NS: &str = "http://schemas.xmlsoap.org/wsdl/soap/";
const SOAP12_NS: &str = "http://schemas.xmlsoap.org/wsdl/soap12/";

pub struct WsdlDocument {
    pub service_name: String,
    pub operations: Vec<OperationRef>,
}

pub fn parse(url: &str, xml: &str) -> Result<WsdlDocument, WsdlError> {
    let doc = Document::parse(xml).map_err(|e| WsdlError::InvalidXml {
        url: url.to_string(),
        message: e.to_string(),
    })?;
    let root = doc.root_element();

    let service = wsdl_child(root, "service")
        .ok_or_else(|| not_found("wsdl:service"))?;
    let service_name = service.attribute("name").unwrap_or("Service").to_string();

    // First port with a soap 1.1/1.2 address (skips HTTP-GET/POST ports).
    let (endpoint, binding_name) = service
        .children()
        .filter(|c| c.has_tag_name((WSDL_NS, "port")))
        .find_map(|port| {
            let addr = port
                .children()
                .find(|c| is_soap(c, "address"))?;
            Some((
                addr.attribute("location")?.to_string(),
                local_part(port.attribute("binding")?).to_string(),
            ))
        })
        .ok_or_else(|| not_found("soap:address"))?;

    let binding = wsdl_children(root, "binding")
        .find(|b| b.attribute("name") == Some(binding_name.as_str()))
        .ok_or_else(|| not_found(&format!("wsdl:binding {binding_name}")))?;

    let soap_binding = binding
        .children()
        .find(|c| is_soap(c, "binding"))
        .ok_or_else(|| not_found("soap:binding"))?;
    let soap_version = if soap_binding.tag_name().namespace() == Some(SOAP12_NS) {
        SoapVersion::V12
    } else {
        SoapVersion::V11
    };
    if soap_binding.attribute("style") == Some("rpc") {
        return Err(WsdlError::UnsupportedStyle);
    }

    // soapAction per operation + reject use="encoded".
    let mut actions: HashMap<String, String> = HashMap::new();
    for op in wsdl_op_children(binding) {
        let name = op.attribute("name").unwrap_or_default().to_string();
        if op.descendants().any(|d| is_soap(&d, "body") && d.attribute("use") == Some("encoded")) {
            return Err(WsdlError::UnsupportedStyle);
        }
        if let Some(soap_op) = op.children().find(|c| is_soap(c, "operation")) {
            if soap_op.attribute("style") == Some("rpc") {
                return Err(WsdlError::UnsupportedStyle);
            }
            actions.insert(name, soap_op.attribute("soapAction").unwrap_or_default().to_string());
        }
    }

    let port_type_name = local_part(
        binding.attribute("type").ok_or_else(|| not_found("binding/@type"))?,
    );
    let port_type = wsdl_children(root, "portType")
        .find(|p| p.attribute("name") == Some(port_type_name))
        .ok_or_else(|| not_found(&format!("wsdl:portType {port_type_name}")))?;

    let mut operations = Vec::new();
    for op in wsdl_op_children(port_type) {
        let name = op.attribute("name").unwrap_or_default().to_string();
        let Some(input) = op.children().find(|c| c.has_tag_name((WSDL_NS, "input"))) else {
            continue; // notification-style operation: no input
        };
        let msg_name = local_part(
            input.attribute("message").ok_or_else(|| not_found("input/@message"))?,
        );
        let message = wsdl_children(root, "message")
            .find(|m| m.attribute("name") == Some(msg_name))
            .ok_or_else(|| not_found(&format!("wsdl:message {msg_name}")))?;
        let part = message
            .children()
            .find(|c| c.has_tag_name((WSDL_NS, "part")))
            .ok_or_else(|| not_found(&format!("part of message {msg_name}")))?;
        let element = part
            .attribute("element")
            .ok_or_else(|| not_found(&format!("part/@element of message {msg_name} (type-based parts are rpc-style)")))?;
        operations.push(OperationRef {
            soap_action: actions.get(&name).cloned().unwrap_or_default(),
            input_element: resolve_qname(part, element),
            endpoint: endpoint.clone(),
            soap_version,
            name,
        });
    }
    if operations.is_empty() {
        return Err(not_found("wsdl:operation"));
    }

    Ok(WsdlDocument { service_name, operations })
}

fn wsdl_child<'a>(node: Node<'a, 'a>, tag: &str) -> Option<Node<'a, 'a>> {
    node.children().find(|c| c.has_tag_name((WSDL_NS, tag)))
}

fn wsdl_children<'a>(node: Node<'a, 'a>, tag: &'a str) -> impl Iterator<Item = Node<'a, 'a>> {
    node.children().filter(move |c| c.has_tag_name((WSDL_NS, tag)))
}

fn wsdl_op_children<'a>(node: Node<'a, 'a>) -> impl Iterator<Item = Node<'a, 'a>> {
    wsdl_children(node, "operation")
}

fn is_soap(node: &Node, tag: &str) -> bool {
    node.has_tag_name((SOAP11_NS, tag)) || node.has_tag_name((SOAP12_NS, tag))
}

fn not_found(qname: &str) -> WsdlError {
    WsdlError::ElementNotFound { qname: qname.to_string() }
}

fn local_part(qname: &str) -> &str {
    qname.rsplit(':').next().unwrap_or(qname)
}

fn resolve_qname(node: Node, value: &str) -> QName {
    let (prefix, local) = match value.split_once(':') {
        Some((p, l)) => (Some(p), l),
        None => (None, value),
    };
    QName {
        namespace: node.lookup_namespace_uri(prefix).unwrap_or_default().to_string(),
        local: local.to_string(),
    }
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cargo test wsdl::parse`. Expected: 4 passed.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/domain src-tauri/src/wsdl src-tauri/src/lib.rs
git commit -m "feat(wsdl): parse operations from doc/literal wsdl, reject rpc/encoded"
```

---

### Task 2: `wsdl::resolve` — transitive import/include resolution

**Files:**
- Create: `src-tauri/src/wsdl/resolve.rs`
- Modify: `src-tauri/src/wsdl/mod.rs` (add `pub mod resolve;`)

**Interfaces:**
- Consumes: `WsdlError` from Task 1.
- Produces: `wsdl::resolve::resolve(root_url: &str, root_xml: &str, fetch: F) -> Result<SchemaSet, WsdlError>` where `F: Fn(String) -> Fut`, `Fut: Future<Output = Result<String, String>>` (the `Err` string is a human message, e.g. `"HTTP 404 Not Found"`). `SchemaSet { docs: Vec<ResolvedDoc { url, xml }> }`.

- [ ] **Step 1: Write failing tests**

Test module at the bottom of `src-tauri/src/wsdl/resolve.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::future::{ready, Ready};

    fn fetcher(
        map: HashMap<&'static str, &'static str>,
    ) -> impl Fn(String) -> Ready<Result<String, String>> {
        move |url: String| {
            ready(
                map.get(url.as_str())
                    .map(|s| s.to_string())
                    .ok_or_else(|| "HTTP 404 Not Found".to_string()),
            )
        }
    }

    const XSD_A: &str = r#"<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"
        targetNamespace="http://example.com/a">
        <xs:include schemaLocation="b.xsd"/>
    </xs:schema>"#;

    const XSD_B: &str = r#"<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"
        targetNamespace="http://example.com/a">
        <xs:include schemaLocation="a.xsd"/>
    </xs:schema>"#;

    fn wsdl_importing(location: &str) -> String {
        format!(
            r#"<definitions xmlns="http://schemas.xmlsoap.org/wsdl/">
              <types>
                <xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
                  <xs:import namespace="http://example.com/a" schemaLocation="{location}"/>
                </xs:schema>
              </types>
            </definitions>"#
        )
    }

    #[tokio::test]
    async fn resolves_relative_import_against_document_url() {
        let wsdl = wsdl_importing("a.xsd");
        let map = HashMap::from([
            ("http://example.com/svc/a.xsd", XSD_A),
            ("http://example.com/svc/b.xsd", XSD_B),
        ]);
        let set = resolve("http://example.com/svc/svc.wsdl", &wsdl, fetcher(map))
            .await
            .unwrap();
        let urls: Vec<&str> = set.docs.iter().map(|d| d.url.as_str()).collect();
        assert_eq!(
            urls,
            vec![
                "http://example.com/svc/svc.wsdl",
                "http://example.com/svc/a.xsd",
                "http://example.com/svc/b.xsd",
            ]
        );
    }

    #[tokio::test]
    async fn include_cycle_terminates_via_dedup() {
        // a.xsd includes b.xsd includes a.xsd — must fetch each once and stop.
        let map = HashMap::from([
            ("http://example.com/svc/a.xsd", XSD_A),
            ("http://example.com/svc/b.xsd", XSD_B),
        ]);
        let wsdl = wsdl_importing("a.xsd");
        let set = resolve("http://example.com/svc/svc.wsdl", &wsdl, fetcher(map))
            .await
            .unwrap();
        assert_eq!(set.docs.len(), 3);
    }

    #[tokio::test]
    async fn missing_external_schema_names_the_url() {
        let wsdl = wsdl_importing("missing.xsd");
        let err = resolve("http://example.com/svc/svc.wsdl", &wsdl, fetcher(HashMap::new()))
            .await
            .unwrap_err();
        match err {
            WsdlError::Fetch { url, message } => {
                assert_eq!(url, "http://example.com/svc/missing.xsd");
                assert!(message.contains("404"));
            }
            other => panic!("expected Fetch, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn invalid_fetched_xml_names_the_url() {
        let wsdl = wsdl_importing("a.xsd");
        let map = HashMap::from([("http://example.com/svc/a.xsd", "<xs:schema")]);
        let err = resolve("http://example.com/svc/svc.wsdl", &wsdl, fetcher(map))
            .await
            .unwrap_err();
        assert!(matches!(err, WsdlError::InvalidXml { url, .. } if url == "http://example.com/svc/a.xsd"));
    }

    #[tokio::test]
    async fn import_without_schema_location_is_skipped() {
        let wsdl = r#"<definitions xmlns="http://schemas.xmlsoap.org/wsdl/">
          <types>
            <xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
              <xs:import namespace="http://www.w3.org/XML/1998/namespace"/>
            </xs:schema>
          </types>
        </definitions>"#;
        let set = resolve("http://example.com/svc.wsdl", wsdl, fetcher(HashMap::new()))
            .await
            .unwrap();
        assert_eq!(set.docs.len(), 1); // nothing fetched
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test wsdl::resolve`. Expected: FAIL — `resolve` not defined (compile error).

- [ ] **Step 3: Implement `resolve`**

`src-tauri/src/wsdl/resolve.rs`:

```rust
use crate::wsdl::error::WsdlError;
use std::collections::HashSet;
use std::future::Future;

const XSD_NS: &str = "http://www.w3.org/2001/XMLSchema";

pub struct ResolvedDoc {
    pub url: String,
    pub xml: String,
}

/// All fetched documents (root WSDL first). Slice 2 parses schemas out of these.
pub struct SchemaSet {
    pub docs: Vec<ResolvedDoc>,
}

/// The ONLY place that fetches external schemas. `fetch` is injected so tests
/// run without network; production passes a reqwest-backed closure.
pub async fn resolve<F, Fut>(
    root_url: &str,
    root_xml: &str,
    fetch: F,
) -> Result<SchemaSet, WsdlError>
where
    F: Fn(String) -> Fut,
    Fut: Future<Output = Result<String, String>>,
{
    let mut fetched: HashSet<String> = HashSet::from([root_url.to_string()]);
    let mut queue = pending_locations(root_url, root_xml)?;
    let mut docs = vec![ResolvedDoc {
        url: root_url.to_string(),
        xml: root_xml.to_string(),
    }];

    while !queue.is_empty() {
        let url = queue.remove(0);
        if !fetched.insert(url.clone()) {
            continue; // already fetched: cuts include cycles
        }
        let xml = fetch(url.clone()).await.map_err(|message| WsdlError::Fetch {
            url: url.clone(),
            message,
        })?;
        queue.extend(pending_locations(&url, &xml)?);
        docs.push(ResolvedDoc { url, xml });
    }

    Ok(SchemaSet { docs })
}

/// schemaLocation of every xsd:import/xsd:include, resolved against the
/// document's own URL. Imports without schemaLocation are skipped (legal:
/// the namespace may already be known).
fn pending_locations(base_url: &str, xml: &str) -> Result<Vec<String>, WsdlError> {
    let doc = roxmltree::Document::parse(xml).map_err(|e| WsdlError::InvalidXml {
        url: base_url.to_string(),
        message: e.to_string(),
    })?;
    Ok(doc
        .descendants()
        .filter(|n| n.has_tag_name((XSD_NS, "import")) || n.has_tag_name((XSD_NS, "include")))
        .filter_map(|n| n.attribute("schemaLocation"))
        .map(|loc| resolve_relative(base_url, loc))
        .collect())
}

fn resolve_relative(base: &str, loc: &str) -> String {
    url::Url::parse(base)
        .and_then(|b| b.join(loc))
        .map(String::from)
        .unwrap_or_else(|_| loc.to_string())
}
```

Add to `src-tauri/src/wsdl/mod.rs`:

```rust
pub mod resolve;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test wsdl::resolve`. Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/wsdl
git commit -m "feat(wsdl): transitive import/include resolution with url dedup and typed errors"
```

---

### Task 3: Persist SOAP operation metadata

**Files:**
- Modify: `src-tauri/src/persistence/collection.rs` (extend `RequestKind::Soap`)
- Modify: `src/lib/api.ts` (extend the soap variant of `RequestKind`)

**Interfaces:**
- Consumes: `domain::wsdl::QName` (Task 1).
- Produces: `RequestKind::Soap { wsdl_url, operation, endpoint: Option<String>, soap_action: Option<String>, soap_version: Option<String>, input_element: Option<QName> }` — the hooks slice 2 uses to re-resolve schemas.

- [ ] **Step 1: Write failing test**

In the existing `#[cfg(test)]` module of `src-tauri/src/persistence/collection.rs`, following the style of the surrounding tests (they build a temp dir and call the public fns):

```rust
#[test]
fn soap_request_roundtrips_metadata_and_old_files_still_load() {
    let tmp = tempdir(); // use the same temp-dir helper the neighboring tests use
    let dir = tmp.path();
    create_collection(dir, "w1", "Calc").unwrap();
    let col_id = match &list_collections(dir, "w1").unwrap()[0] {
        CollectionNode::Folder { id, .. } => id.clone(),
        _ => panic!("expected folder"),
    };
    let kind = RequestKind::Soap {
        wsdl_url: "http://x/svc?wsdl".into(),
        operation: "Add".into(),
        endpoint: Some("http://x/svc".into()),
        soap_action: Some("http://x/Add".into()),
        soap_version: Some("1.1".into()),
        input_element: Some(crate::domain::wsdl::QName {
            namespace: "http://x/ns".into(),
            local: "Add".into(),
        }),
    };
    let node = create_request(dir, "w1", vec![col_id.clone()], "Add", kind).unwrap();
    let CollectionNode::Request { id, .. } = &node else { panic!("expected request") };
    let rf = get_request(dir, "w1", vec![col_id, id.clone()]).unwrap();
    match rf.kind {
        RequestKind::Soap { soap_version, input_element, .. } => {
            assert_eq!(soap_version.as_deref(), Some("1.1"));
            assert_eq!(input_element.unwrap().local, "Add");
        }
        _ => panic!("expected soap"),
    }
}

#[test]
fn soap_file_without_metadata_still_deserializes() {
    // pre-slice-1 file shape: only wsdlUrl + operation
    let json = r#"{"id":"r1","name":"Old","kind":"soap","wsdlUrl":"http://x?wsdl","operation":"Op"}"#;
    let rf: RequestFile = serde_json::from_str(json).unwrap();
    assert!(matches!(rf.kind, RequestKind::Soap { endpoint: None, .. }));
}
```

Adapt the temp-dir setup line to whatever helper the existing tests in this file use (read them first) — do not introduce a new tempfile dependency if one is already there.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test persistence::collection::tests::soap`. Expected: FAIL — `Soap` variant has no field `endpoint` (compile error).

- [ ] **Step 3: Extend the variant**

In `src-tauri/src/persistence/collection.rs` replace the `Soap` variant:

```rust
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum RequestKind {
    Rest { method: String, url: String },
    #[serde(rename_all = "camelCase")]
    Soap {
        wsdl_url: String,
        operation: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        endpoint: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        soap_action: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        soap_version: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        input_element: Option<crate::domain::wsdl::QName>,
    },
}
```

Fix any other construction/match sites of `RequestKind::Soap` the compiler reports (use `..` in matches).

- [ ] **Step 4: Run the full Rust suite**

Run: `cargo test`. Expected: all pass (including pre-existing collection tests).

- [ ] **Step 5: Update the TS type**

In `src/lib/api.ts` replace the soap arm of `RequestKind`:

```ts
export interface WsdlQName {
  namespace: string;
  local: string;
}

export type RequestKind =
  | { kind: "rest"; method: string; url: string }
  | {
      kind: "soap";
      wsdlUrl: string;
      operation: string;
      endpoint?: string;
      soapAction?: string;
      soapVersion?: "1.1" | "1.2";
      inputElement?: WsdlQName;
    };
```

Run: `pnpm test`. Expected: existing frontend tests still pass.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/persistence/collection.rs src/lib/api.ts
git commit -m "feat(persistence): soap request metadata for wsdl operations"
```

---

### Task 4: Commands `import_wsdl` + `confirm_wsdl_import` and api wrappers

**Files:**
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs` (register commands)
- Modify: `src/lib/api.ts` (types + wrappers)

**Interfaces:**
- Consumes: `wsdl::parse::parse`, `wsdl::resolve::resolve`, `domain::wsdl::{OperationRef, SoapVersion}`, `collection::{create_collection, create_request}`, extended `RequestKind::Soap`.
- Produces: commands `import_wsdl(url) -> WsdlImportPreview` and `confirm_wsdl_import(workspace_id, preview) -> ()`; TS `api.importWsdl(url)` / `api.confirmWsdlImport(workspaceId, preview)` with `WsdlImportPreview { serviceName, wsdlUrl, operations: OperationRef[] }` (camelCase mirrors of the Rust serde types).

- [ ] **Step 1: Implement the commands**

Append to `src-tauri/src/commands/mod.rs`:

```rust
use crate::domain::wsdl::{OperationRef, SoapVersion};
use crate::wsdl;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WsdlImportPreview {
    pub service_name: String,
    pub wsdl_url: String,
    pub operations: Vec<OperationRef>,
}

#[tauri::command]
pub async fn import_wsdl(url: String) -> Result<WsdlImportPreview, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;
    let fetch = |u: String| {
        let client = client.clone();
        async move {
            let resp = client.get(&u).send().await.map_err(|e| e.to_string())?;
            if !resp.status().is_success() {
                return Err(format!("HTTP {}", resp.status()));
            }
            resp.text().await.map_err(|e| e.to_string())
        }
    };

    let xml = fetch(url.clone()).await.map_err(|message| {
        wsdl::error::WsdlError::Fetch { url: url.clone(), message }.to_string()
    })?;
    let parsed = wsdl::parse::parse(&url, &xml).map_err(|e| e.to_string())?;
    // SchemaSet discarded in slice 1: resolve runs to validate the full schema
    // closure up front; slice 2 (xsd -> SchemaNode) consumes it.
    wsdl::resolve::resolve(&url, &xml, fetch)
        .await
        .map_err(|e| e.to_string())?;

    Ok(WsdlImportPreview {
        service_name: parsed.service_name,
        wsdl_url: url,
        operations: parsed.operations,
    })
}

#[tauri::command]
pub fn confirm_wsdl_import(
    app: tauri::AppHandle,
    workspace_id: String,
    preview: WsdlImportPreview,
) -> Result<(), String> {
    let dir = data_dir(&app)?;
    let col = collection::create_collection(&dir, &workspace_id, &preview.service_name)
        .map_err(|e| e.to_string())?;
    let CollectionNode::Folder { id, .. } = &col else {
        return Err("created collection is not a folder".into());
    };
    for op in &preview.operations {
        let version = match op.soap_version {
            SoapVersion::V11 => "1.1",
            SoapVersion::V12 => "1.2",
        };
        collection::create_request(
            &dir,
            &workspace_id,
            vec![id.clone()],
            &op.name,
            RequestKind::Soap {
                wsdl_url: preview.wsdl_url.clone(),
                operation: op.name.clone(),
                endpoint: Some(op.endpoint.clone()),
                soap_action: Some(op.soap_action.clone()),
                soap_version: Some(version.to_string()),
                input_element: Some(op.input_element.clone()),
            },
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}
```

Register both in `src-tauri/src/lib.rs` inside `generate_handler![...]`:

```rust
            commands::import_wsdl,
            commands::confirm_wsdl_import,
```

- [ ] **Step 2: Verify it compiles and the suite passes**

Run: `cargo test`. Expected: all pass. Then `cargo clippy` — clean.

- [ ] **Step 3: Add the api wrappers**

In `src/lib/api.ts`:

```ts
export interface WsdlOperation {
  name: string;
  endpoint: string;
  soapAction: string;
  soapVersion: "1.1" | "1.2";
  inputElement: WsdlQName;
}

export interface WsdlImportPreview {
  serviceName: string;
  wsdlUrl: string;
  operations: WsdlOperation[];
}
```

And in the `api` object:

```ts
  importWsdl: (url: string) =>
    invoke<WsdlImportPreview>("import_wsdl", { url }),

  confirmWsdlImport: (workspaceId: string, preview: WsdlImportPreview) =>
    invoke<void>("confirm_wsdl_import", { workspaceId, preview }),
```

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands/mod.rs src-tauri/src/lib.rs src/lib/api.ts
git commit -m "feat(commands): import_wsdl preview and confirm_wsdl_import"
```

---

### Task 5: `wsdlImportStore`

**Files:**
- Create: `src/store/wsdlImportStore.ts`
- Test: `src/store/wsdlImportStore.test.ts`

**Interfaces:**
- Consumes: `api.importWsdl`, `api.confirmWsdlImport`, `useCollectionStore.load`.
- Produces: `useWsdlImportStore` with `phase: { state: "idle" } | { state: "loading" } | { state: "preview"; preview: WsdlImportPreview } | { state: "error"; message: string }`, actions `importWsdl(url)`, `confirm(workspaceId)`, `reset()`.

- [ ] **Step 1: Write failing tests**

`src/store/wsdlImportStore.test.ts` (same mock pattern as `responseStore.test.ts`):

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/api", () => ({
  api: { importWsdl: vi.fn(), confirmWsdlImport: vi.fn(), listCollections: vi.fn() },
}));

import { useWsdlImportStore } from "./wsdlImportStore";
import { WsdlImportPreview } from "../lib/api";
import { api } from "../lib/api";

const PREVIEW: WsdlImportPreview = {
  serviceName: "CalcService",
  wsdlUrl: "http://x/svc?wsdl",
  operations: [
    {
      name: "Add",
      endpoint: "http://x/svc",
      soapAction: "http://x/Add",
      soapVersion: "1.1",
      inputElement: { namespace: "http://x/ns", local: "Add" },
    },
  ],
};

beforeEach(() => {
  useWsdlImportStore.setState({ phase: { state: "idle" } });
  vi.clearAllMocks();
});

describe("importWsdl", () => {
  it("goes loading then preview on success", async () => {
    let resolve!: (p: WsdlImportPreview) => void;
    vi.mocked(api.importWsdl).mockReturnValue(new Promise((res) => { resolve = res; }));
    const p = useWsdlImportStore.getState().importWsdl("http://x/svc?wsdl");
    expect(useWsdlImportStore.getState().phase).toEqual({ state: "loading" });
    resolve(PREVIEW);
    await p;
    expect(useWsdlImportStore.getState().phase).toEqual({ state: "preview", preview: PREVIEW });
  });

  it("stores the error message on failure", async () => {
    vi.mocked(api.importWsdl).mockRejectedValue("failed to fetch http://x/a.xsd: HTTP 404");
    await useWsdlImportStore.getState().importWsdl("http://x/svc?wsdl");
    expect(useWsdlImportStore.getState().phase).toEqual({
      state: "error",
      message: "failed to fetch http://x/a.xsd: HTTP 404",
    });
  });
});

describe("confirm", () => {
  it("confirms, reloads collections and resets to idle", async () => {
    vi.mocked(api.confirmWsdlImport).mockResolvedValue(undefined);
    vi.mocked(api.listCollections).mockResolvedValue([]);
    useWsdlImportStore.setState({ phase: { state: "preview", preview: PREVIEW } });
    await useWsdlImportStore.getState().confirm("w1");
    expect(api.confirmWsdlImport).toHaveBeenCalledWith("w1", PREVIEW);
    expect(api.listCollections).toHaveBeenCalledWith("w1");
    expect(useWsdlImportStore.getState().phase).toEqual({ state: "idle" });
  });

  it("does nothing when not in preview", async () => {
    await useWsdlImportStore.getState().confirm("w1");
    expect(api.confirmWsdlImport).not.toHaveBeenCalled();
  });

  it("stores the error message when confirm fails", async () => {
    vi.mocked(api.confirmWsdlImport).mockRejectedValue("disk full");
    useWsdlImportStore.setState({ phase: { state: "preview", preview: PREVIEW } });
    await useWsdlImportStore.getState().confirm("w1");
    expect(useWsdlImportStore.getState().phase).toEqual({ state: "error", message: "disk full" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- wsdlImportStore`. Expected: FAIL — module not found.

- [ ] **Step 3: Implement the store**

`src/store/wsdlImportStore.ts`:

```ts
import { create } from "zustand";
import { api, WsdlImportPreview } from "../lib/api";
import { useCollectionStore } from "./collectionStore";

type Phase =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "preview"; preview: WsdlImportPreview }
  | { state: "error"; message: string };

interface WsdlImportState {
  phase: Phase;
  importWsdl: (url: string) => Promise<void>;
  confirm: (workspaceId: string) => Promise<void>;
  reset: () => void;
}

export const useWsdlImportStore = create<WsdlImportState>((set, get) => ({
  phase: { state: "idle" },

  async importWsdl(url) {
    set({ phase: { state: "loading" } });
    try {
      const preview = await api.importWsdl(url);
      set({ phase: { state: "preview", preview } });
    } catch (e) {
      set({ phase: { state: "error", message: String(e) } });
    }
  },

  async confirm(workspaceId) {
    const phase = get().phase;
    if (phase.state !== "preview") return;
    try {
      await api.confirmWsdlImport(workspaceId, phase.preview);
      await useCollectionStore.getState().load(workspaceId);
      set({ phase: { state: "idle" } });
    } catch (e) {
      set({ phase: { state: "error", message: String(e) } });
    }
  },

  reset() {
    set({ phase: { state: "idle" } });
  },
}));
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- wsdlImportStore`. Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add src/store/wsdlImportStore.ts src/store/wsdlImportStore.test.ts
git commit -m "feat(store): wsdl import store with loading, preview and error phases"
```

---

### Task 6: `ImportWsdlModal` + sidebar entry

**Files:**
- Create: `src/components/ImportWsdlModal.tsx`
- Modify: `src/components/Sidebar.tsx` (Globe icon button + modal mount)

**Interfaces:**
- Consumes: `useWsdlImportStore` (Task 5), `useWorkspaceStore.activeId`.
- Produces: UI only.

- [ ] **Step 1: Implement the modal**

`src/components/ImportWsdlModal.tsx` — follows `AddWorkspaceModal.tsx` exactly (overlay, card, header/body/footer, token classes). Before writing, check `src/styles/tokens.css` for the error color token (`--color-destructive` or similar) and the SOAP accent used in `CollectionTree.tsx` (`text-soap-op`), and use those:

```tsx
import { useState } from "react";
import { Hexagon, RefreshCw, X } from "lucide-react";
import { cn } from "../lib/utils";
import { useWsdlImportStore } from "../store/wsdlImportStore";
import { useWorkspaceStore } from "../store/workspaceStore";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function ImportWsdlModal({ open, onClose }: Props) {
  const [url, setUrl] = useState("");
  const phase = useWsdlImportStore((s) => s.phase);
  const importWsdl = useWsdlImportStore((s) => s.importWsdl);
  const confirm = useWsdlImportStore((s) => s.confirm);
  const reset = useWsdlImportStore((s) => s.reset);
  const workspaceId = useWorkspaceStore((s) => s.activeId);

  if (!open) return null;

  const loading = phase.state === "loading";

  function close() {
    reset();
    setUrl("");
    onClose();
  }

  async function handlePrimary() {
    if (phase.state === "preview") {
      await confirm(workspaceId);
      setUrl("");
      onClose();
      return;
    }
    const trimmed = url.trim();
    if (!trimmed || loading) return;
    importWsdl(trimmed);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onPointerDown={(e) => { if (e.target === e.currentTarget) close(); }}
    >
      <div className="w-[480px] rounded-[6px] bg-card border border-border overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4">
          <span className="text-[15px] font-semibold text-foreground">Import WSDL</span>
          <X size={16} className="text-muted cursor-pointer hover:text-foreground" onClick={close} />
        </div>

        <div className="h-px bg-border" />

        {/* Body */}
        <div className="flex flex-col gap-4 px-5 py-5">
          <div className="flex flex-col gap-[6px]">
            <label className="text-[12px] font-semibold text-foreground">WSDL URL</label>
            <input
              autoFocus
              disabled={loading || phase.state === "preview"}
              className="w-full rounded-[4px] bg-secondary border border-border px-3 py-2 text-[13px] text-foreground placeholder:text-muted outline-none focus:border-ring disabled:opacity-60"
              placeholder="https://example.com/service?wsdl"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handlePrimary(); if (e.key === "Escape") close(); }}
            />
          </div>

          {loading && (
            <div className="flex items-center gap-2 text-[13px] text-muted">
              <RefreshCw size={14} className="animate-spin" />
              Resolving schemas…
            </div>
          )}

          {phase.state === "error" && (
            <div className="rounded-[4px] border border-border bg-secondary px-3 py-2 text-[12px] text-destructive break-all">
              {phase.message}
            </div>
          )}

          {phase.state === "preview" && (
            <div className="flex flex-col gap-2">
              <span className="text-[12px] font-semibold text-foreground">
                {phase.preview.serviceName}
                <span className="text-muted font-normal">
                  {" "}· {phase.preview.operations.length} operations
                </span>
              </span>
              <div className="max-h-[240px] overflow-y-auto rounded-[4px] border border-border">
                {phase.preview.operations.map((op) => (
                  <div key={op.name} className="flex items-center gap-2 px-3 py-[6px] text-[13px] text-foreground">
                    <Hexagon size={14} className="text-soap-op shrink-0" />
                    {op.name}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="h-px bg-border" />

        {/* Footer */}
        <div className="flex items-center justify-end gap-[10px] px-5 py-[14px]">
          <button
            className="px-4 py-[7px] rounded-[4px] text-[13px] font-medium text-foreground bg-secondary border border-border hover:bg-secondary/80 cursor-pointer"
            onClick={close}
          >
            Cancel
          </button>
          <button
            className={cn(
              "px-4 py-[7px] rounded-[4px] text-[13px] font-semibold cursor-pointer",
              (phase.state === "preview" || (url.trim() && !loading))
                ? "bg-accent text-accent-foreground hover:bg-accent/90"
                : "bg-accent/40 text-accent-foreground/50 cursor-not-allowed"
            )}
            onClick={handlePrimary}
            disabled={loading || (phase.state !== "preview" && !url.trim())}
          >
            {phase.state === "preview"
              ? `Import ${phase.preview.operations.length} Operations`
              : "Import"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

If `text-destructive` does not exist in `styles/tokens.css`, use the error/red token that does — never a hardcoded hex.

- [ ] **Step 2: Sidebar entry**

In `src/components/Sidebar.tsx`: import `Globe` from lucide-react and the modal, add `const [importOpen, setImportOpen] = useState(false)`, render a `Globe` icon button beside the existing `FolderPlus`/`Plus` icons (same size/classes, `title="Import WSDL"`, `onClick={() => setImportOpen(true)}`), and mount `<ImportWsdlModal open={importOpen} onClose={() => setImportOpen(false)} />` at the end of the `<aside>`.

- [ ] **Step 3: Verify**

Run: `pnpm test` (all green) and `pnpm lint`. Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/ImportWsdlModal.tsx src/components/Sidebar.tsx
git commit -m "feat(ui): import wsdl modal with preview and sidebar entry"
```

---

### Task 7: End-to-end verification

**Files:** none (manual verification per spec).

- [ ] **Step 1: Full suites**

Run: `cargo test` (in `src-tauri/`), `pnpm test`, `cargo fmt --check`, `cargo clippy`, `pnpm lint`. Expected: all clean.

- [ ] **Step 2: Real WSDL happy path**

Run `pnpm tauri dev`. Click the Globe icon → paste `http://www.dneonline.com/calculator.asmx?WSDL` → Import. Expected: loading state, then preview "Calculator · 4 operations" (Add, Subtract, Multiply, Divide), Confirm → a "Calculator" collection appears in the sidebar with 4 hexagon-marked SOAP requests. Restart the app: the collection persists.

- [ ] **Step 3: Error path**

Import `http://www.dneonline.com/nonexistent.asmx?WSDL` (or any 404). Expected: error rendered inside the modal naming the URL and HTTP status. No partial collection created.

- [ ] **Step 4: Commit any fixes, then stop**

Slice 1 done — hand off to the finishing-a-development-branch flow (PR from `feat/wsdl-import`).
