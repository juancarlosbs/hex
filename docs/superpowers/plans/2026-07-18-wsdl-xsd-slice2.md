# WSDL XSD → SchemaNode (Slice 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a resolved WSDL/XSD into an immutable `SchemaNode` tree (the shape of a SOAP operation input), reachable via a thin `get_operation_schema` command.

**Architecture:** New pure domain types in `domain/schema.rs`; a pure `wsdl::xsd` module that indexes the already-resolved `SchemaSet` and walks the XSD from an `input_element` QName; a thin async command that re-fetches + resolves + builds. No new UI — verification is Rust tests + serialized `SchemaNode` JSON.

**Tech Stack:** Rust, roxmltree (XSD parsing), serde (IPC types via serde; tauri-specta not yet wired — ADR-007), thiserror (`WsdlError`), reqwest/rustls (command fetch only).

## Global Constraints

- **Domain is pure.** `domain/schema.rs` has zero I/O. All fetching stays in the command; `wsdl::xsd` is pure over the resolved `SchemaSet`.
- **rustls only.** The command reuses the existing reqwest client pattern from `import_wsdl`. Never pull OpenSSL/native-tls.
- **No new enum variant for fallbacks.** `NodeKind::Any` (= raw editor) represents `xs:any`, unsupported constructs (`group`/`attributeGroup`), and recursion cutoff. Disambiguate via the `doc` marker: `"unsupported: edit raw"` vs `"recursive: expand on demand"`.
- **Hard error vs marked fallback.** A genuinely absent type/element QName → `WsdlError::TypeNotFound` (hard fail). A known-but-unsupported construct → marked `Any` node. Never conflate.
- **XSD coverage:** base subset + `element ref` + `extension`/`restriction`. `xs:all` → `Sequence`. `group`/`attributeGroup` → marked `Any` (post-MVP backlog).
- **Depth cap `D = 12`** and named-type cycle guard on the traversal path.
- **Test convention:** inline `#[cfg(test)] mod tests` in each module (as in `parse.rs`), fixtures under `src-tauri/src/wsdl/testdata/`. Run from `src-tauri/`.
- **All code, comments, names in English.**

---

### Task 1: Domain types — `domain/schema.rs`

**Files:**
- Create: `src-tauri/src/domain/schema.rs`
- Modify: `src-tauri/src/domain/mod.rs`

**Interfaces:**
- Produces: `SchemaNode { name: String, namespace: Option<String>, occurs: Occurs, nillable: bool, doc: Option<String>, attributes: Vec<Attribute>, kind: NodeKind }`; `enum NodeKind { Leaf { xsd_type: XsdType, enum_values: Vec<String>, default: Option<String>, fixed: Option<String> }, Sequence(Vec<SchemaNode>), Choice(Vec<SchemaNode>), Any }`; `struct Occurs { min: u32, max: MaxOccurs }` with `fn optional(&self)->bool` and `fn repeatable(&self)->bool`; `enum MaxOccurs { Bounded(u32), Unbounded }`; `enum XsdType { String, Boolean, Integer, Decimal, Double, Date, DateTime, Time, GYearMonth, Base64Binary, Other(String) }`; `struct Attribute { name: String, xsd_type: XsdType, required: bool, enum_values: Vec<String>, default: Option<String> }`. All derive `Debug, Clone, PartialEq, Serialize, Deserialize` with `#[serde(rename_all = "camelCase")]` on structs. (No `specta::Type` — tauri-specta is not wired in this repo; see ADR-007 / Notes.)

- [ ] **Step 1: Write the failing test**

Append to `src-tauri/src/domain/schema.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn occurs_optional_and_repeatable() {
        let opt = Occurs { min: 0, max: MaxOccurs::Bounded(1) };
        assert!(opt.optional());
        assert!(!opt.repeatable());

        let req_many = Occurs { min: 1, max: MaxOccurs::Unbounded };
        assert!(!req_many.optional());
        assert!(req_many.repeatable());

        let bounded_many = Occurs { min: 1, max: MaxOccurs::Bounded(3) };
        assert!(bounded_many.repeatable());
    }

    #[test]
    fn leaf_node_serializes_to_camel_case_json() {
        let node = SchemaNode {
            name: "a".into(),
            namespace: Some("http://ex".into()),
            occurs: Occurs { min: 1, max: MaxOccurs::Bounded(1) },
            nillable: false,
            doc: None,
            attributes: vec![],
            kind: NodeKind::Leaf {
                xsd_type: XsdType::Integer,
                enum_values: vec![],
                default: None,
                fixed: None,
            },
        };
        let json = serde_json::to_string(&node).unwrap();
        assert!(json.contains("\"enumValues\":[]"), "got: {json}");
        assert!(json.contains("\"xsdType\":\"integer\""), "got: {json}");
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test --lib domain::schema`
Expected: FAIL — `cannot find type SchemaNode`.

- [ ] **Step 3: Write minimal implementation**

Prepend to `src-tauri/src/domain/schema.rs` (above the test module):

```rust
use serde::{Deserialize, Serialize};

/// The shape of a SOAP operation input. Immutable tree derived from XSD.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaNode {
    pub name: String,
    pub namespace: Option<String>,
    pub occurs: Occurs,
    pub nillable: bool,
    pub doc: Option<String>,
    pub attributes: Vec<Attribute>,
    pub kind: NodeKind,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum NodeKind {
    Leaf {
        xsd_type: XsdType,
        enum_values: Vec<String>,
        default: Option<String>,
        fixed: Option<String>,
    },
    Sequence(Vec<SchemaNode>),
    Choice(Vec<SchemaNode>),
    Any,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Occurs {
    pub min: u32,
    pub max: MaxOccurs,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MaxOccurs {
    Bounded(u32),
    Unbounded,
}

impl Occurs {
    pub fn optional(&self) -> bool {
        self.min == 0
    }
    pub fn repeatable(&self) -> bool {
        matches!(self.max, MaxOccurs::Unbounded)
            || matches!(self.max, MaxOccurs::Bounded(n) if n > 1)
    }
}

/// Subset of simple types supported in MVP (ADR-010).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum XsdType {
    String,
    Boolean,
    Integer,
    Decimal,
    Double,
    Date,
    DateTime,
    Time,
    GYearMonth,
    Base64Binary,
    Other(String),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Attribute {
    pub name: String,
    pub xsd_type: XsdType,
    pub required: bool,
    pub enum_values: Vec<String>,
    pub default: Option<String>,
}
```

Add to `src-tauri/src/domain/mod.rs`:

```rust
pub mod schema;
pub mod wsdl;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-tauri && cargo test --lib domain::schema`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/domain/schema.rs src-tauri/src/domain/mod.rs
git commit -m "feat(domain): SchemaNode types for xsd traversal"
```

---

### Task 2: `wsdl::xsd` core — index + leaf/sequence + `TypeNotFound`

Walks the calculator fixture (`Add` → Sequence of two int leaves) and errors on a missing element. Establishes the index + `walk_element` skeleton every later task extends.

**Files:**
- Create: `src-tauri/src/wsdl/xsd.rs`
- Modify: `src-tauri/src/wsdl/mod.rs`, `src-tauri/src/wsdl/error.rs`

**Interfaces:**
- Consumes: `SchemaSet { docs: Vec<ResolvedDoc { url: String, xml: String }> }` from `wsdl::resolve`; `QName { namespace: String, local: String }` from `domain::wsdl`; `SchemaNode`, `NodeKind`, `Occurs`, `MaxOccurs`, `XsdType` from `domain::schema`.
- Produces: `pub fn build_schema(set: &SchemaSet, root: &QName) -> Result<SchemaNode, WsdlError>`; `WsdlError::TypeNotFound { qname: String }`.

- [ ] **Step 1: Write the failing test**

Create `src-tauri/src/wsdl/xsd.rs`:

```rust
use crate::domain::schema::{MaxOccurs, NodeKind, Occurs, SchemaNode, XsdType};
use crate::domain::wsdl::QName;
use crate::wsdl::error::WsdlError;
use crate::wsdl::resolve::{ResolvedDoc, SchemaSet};
use roxmltree::{Document, Node};
use std::collections::HashMap;

const XSD_NS: &str = "http://www.w3.org/2001/XMLSchema";
const DEPTH_CAP: usize = 12;

pub fn build_schema(set: &SchemaSet, root: &QName) -> Result<SchemaNode, WsdlError> {
    let docs: Vec<Document> = set
        .docs
        .iter()
        .map(|d| {
            Document::parse(&d.xml).map_err(|e| WsdlError::InvalidXml {
                url: d.url.clone(),
                message: e.to_string(),
            })
        })
        .collect::<Result<_, _>>()?;
    let index = Index::build(&docs);
    let el = index
        .element(root)
        .ok_or_else(|| WsdlError::ElementNotFound { qname: qname_str(root) })?;
    index.walk_element(el, &mut Vec::new(), 0)
}

fn qname_str(q: &QName) -> String {
    format!("{{{}}}{}", q.namespace, q.local)
}

/// Global elements and named types keyed by (targetNamespace, name).
struct Index<'a> {
    elements: HashMap<(String, String), Node<'a, 'a>>,
    types: HashMap<(String, String), Node<'a, 'a>>,
}

impl<'a> Index<'a> {
    fn build(docs: &'a [Document<'a>]) -> Self {
        let mut elements = HashMap::new();
        let mut types = HashMap::new();
        for doc in docs {
            for schema in doc
                .root()
                .descendants()
                .filter(|n| n.has_tag_name((XSD_NS, "schema")))
            {
                let tns = schema.attribute("targetNamespace").unwrap_or("").to_string();
                for child in schema.children().filter(Node::is_element) {
                    let Some(name) = child.attribute("name") else { continue };
                    let key = (tns.clone(), name.to_string());
                    if child.has_tag_name((XSD_NS, "element")) {
                        elements.insert(key, child);
                    } else if child.has_tag_name((XSD_NS, "complexType"))
                        || child.has_tag_name((XSD_NS, "simpleType"))
                    {
                        types.insert(key, child);
                    }
                }
            }
        }
        Index { elements, types }
    }

    fn element(&self, q: &QName) -> Option<Node<'a, 'a>> {
        self.elements
            .get(&(q.namespace.clone(), q.local.clone()))
            .copied()
    }

    fn named_type(&self, q: &QName) -> Option<Node<'a, 'a>> {
        self.types
            .get(&(q.namespace.clone(), q.local.clone()))
            .copied()
    }

    fn walk_element(
        &self,
        el: Node<'a, 'a>,
        path_types: &mut Vec<(String, String)>,
        depth: usize,
    ) -> Result<SchemaNode, WsdlError> {
        let occurs = read_occurs(el);
        let nillable = el.attribute("nillable") == Some("true");
        let doc = read_doc(el);

        // Resolve the element's type node: inline complexType/simpleType, or el.type QName.
        let type_node = el
            .children()
            .find(|c| c.has_tag_name((XSD_NS, "complexType")) || c.has_tag_name((XSD_NS, "simpleType")));

        let kind = match type_node {
            Some(t) if t.has_tag_name((XSD_NS, "complexType")) => {
                self.walk_complex(t, path_types, depth)?
            }
            Some(t) => leaf_from_simple_type(t, el),
            None => {
                // named type reference via @type
                match el.attribute("type") {
                    Some(type_ref) => {
                        let tq = resolve_ref(el, type_ref);
                        self.walk_named_type(&tq, el, path_types, depth)?
                    }
                    None => NodeKind::Leaf {
                        xsd_type: XsdType::String,
                        enum_values: vec![],
                        default: el.attribute("default").map(str::to_string),
                        fixed: el.attribute("fixed").map(str::to_string),
                    },
                }
            }
        };

        Ok(SchemaNode {
            name: el.attribute("name").unwrap_or_default().to_string(),
            namespace: schema_tns(el),
            occurs,
            nillable,
            doc,
            attributes: vec![],
            kind,
        })
    }

    fn walk_named_type(
        &self,
        tq: &QName,
        el: Node<'a, 'a>,
        path_types: &mut Vec<(String, String)>,
        depth: usize,
    ) -> Result<NodeKind, WsdlError> {
        // Built-in xs:* type -> Leaf.
        if tq.namespace == XSD_NS {
            return Ok(leaf_from_builtin(tq, el));
        }
        let key = (tq.namespace.clone(), tq.local.clone());
        let t = self
            .named_type(tq)
            .ok_or_else(|| WsdlError::TypeNotFound { qname: qname_str(tq) })?;
        if t.has_tag_name((XSD_NS, "simpleType")) {
            return Ok(leaf_from_simple_type(t, el));
        }
        // complexType: cycle/depth guard keyed by the named type.
        if depth >= DEPTH_CAP || path_types.contains(&key) {
            return Ok(recursive_placeholder());
        }
        path_types.push(key);
        let kind = self.walk_complex(t, path_types, depth + 1)?;
        path_types.pop();
        Ok(kind)
    }

    fn walk_complex(
        &self,
        _t: Node<'a, 'a>,
        _path_types: &mut Vec<(String, String)>,
        _depth: usize,
    ) -> Result<NodeKind, WsdlError> {
        // xs:sequence support only in this task; extended in later tasks.
        let seq = _t
            .children()
            .find(|c| c.has_tag_name((XSD_NS, "sequence")));
        if let Some(seq) = seq {
            let mut children = Vec::new();
            for child_el in seq.children().filter(|c| c.has_tag_name((XSD_NS, "element"))) {
                children.push(self.walk_element(child_el, _path_types, _depth)?);
            }
            return Ok(NodeKind::Sequence(children));
        }
        Ok(NodeKind::Sequence(vec![]))
    }
}

fn read_occurs(el: Node) -> Occurs {
    let min = el.attribute("minOccurs").and_then(|v| v.parse().ok()).unwrap_or(1);
    let max = match el.attribute("maxOccurs") {
        Some("unbounded") => MaxOccurs::Unbounded,
        Some(v) => MaxOccurs::Bounded(v.parse().unwrap_or(1)),
        None => MaxOccurs::Bounded(1),
    };
    Occurs { min, max }
}

fn read_doc(el: Node) -> Option<String> {
    el.children()
        .find(|c| c.has_tag_name((XSD_NS, "annotation")))
        .and_then(|a| a.children().find(|c| c.has_tag_name((XSD_NS, "documentation"))))
        .and_then(|d| d.text())
        .map(|t| t.trim().to_string())
}

fn schema_tns(node: Node) -> Option<String> {
    node.ancestors()
        .find(|n| n.has_tag_name((XSD_NS, "schema")))
        .and_then(|s| s.attribute("targetNamespace"))
        .map(str::to_string)
}

fn resolve_ref(node: Node, value: &str) -> QName {
    let (prefix, local) = match value.split_once(':') {
        Some((p, l)) => (Some(p), l),
        None => (None, value),
    };
    QName {
        namespace: node.lookup_namespace_uri(prefix).unwrap_or_default().to_string(),
        local: local.to_string(),
    }
}

fn leaf_from_builtin(tq: &QName, el: Node) -> NodeKind {
    NodeKind::Leaf {
        xsd_type: map_xsd_type(&tq.local),
        enum_values: vec![],
        default: el.attribute("default").map(str::to_string),
        fixed: el.attribute("fixed").map(str::to_string),
    }
}

fn leaf_from_simple_type(_t: Node, el: Node) -> NodeKind {
    // Enum facets handled in a later task; base type mapping is enough here.
    NodeKind::Leaf {
        xsd_type: XsdType::String,
        enum_values: vec![],
        default: el.attribute("default").map(str::to_string),
        fixed: el.attribute("fixed").map(str::to_string),
    }
}

fn recursive_placeholder() -> NodeKind {
    NodeKind::Any
}

fn map_xsd_type(local: &str) -> XsdType {
    match local {
        "string" => XsdType::String,
        "boolean" => XsdType::Boolean,
        "integer" | "int" | "long" | "short" | "byte" => XsdType::Integer,
        "decimal" => XsdType::Decimal,
        "double" | "float" => XsdType::Double,
        "date" => XsdType::Date,
        "dateTime" => XsdType::DateTime,
        "time" => XsdType::Time,
        "gYearMonth" => XsdType::GYearMonth,
        "base64Binary" => XsdType::Base64Binary,
        other => XsdType::Other(other.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn set_from(xml: &str) -> SchemaSet {
        SchemaSet {
            docs: vec![ResolvedDoc { url: "mem://root".into(), xml: xml.into() }],
        }
    }

    #[test]
    fn add_operation_is_sequence_of_two_int_leaves() {
        let set = set_from(include_str!("testdata/calculator.wsdl"));
        let root = QName { namespace: "http://example.com/calc".into(), local: "Add".into() };
        let node = build_schema(&set, &root).unwrap();
        let NodeKind::Sequence(children) = &node.kind else { panic!("expected Sequence, got {:?}", node.kind) };
        assert_eq!(children.len(), 2);
        assert_eq!(children[0].name, "a");
        assert!(matches!(children[0].kind, NodeKind::Leaf { xsd_type: XsdType::Integer, .. }));
    }

    #[test]
    fn missing_element_errors() {
        let set = set_from(include_str!("testdata/calculator.wsdl"));
        let root = QName { namespace: "http://example.com/calc".into(), local: "Nope".into() };
        assert!(matches!(build_schema(&set, &root), Err(WsdlError::ElementNotFound { .. })));
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test --lib wsdl::xsd`
Expected: FAIL — `TypeNotFound` variant missing / module not declared.

- [ ] **Step 3: Write minimal implementation**

Add to `src-tauri/src/wsdl/error.rs` inside the enum:

```rust
    #[error("type not found in schema: {qname}")]
    TypeNotFound { qname: String },
```

Add to `src-tauri/src/wsdl/mod.rs`:

```rust
pub mod xsd;
```

(The `xsd.rs` body from Step 1 is the implementation.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-tauri && cargo test --lib wsdl::xsd`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/wsdl/xsd.rs src-tauri/src/wsdl/mod.rs src-tauri/src/wsdl/error.rs
git commit -m "feat(wsdl): xsd traversal core — leaf, sequence, TypeNotFound"
```

---

### Task 3: Enums, occurs, nillable, default/fixed, attributes

**Files:**
- Create: `src-tauri/src/wsdl/testdata/fields.xsd`
- Modify: `src-tauri/src/wsdl/xsd.rs`

**Interfaces:**
- Consumes: `Index::walk_element`, `leaf_from_simple_type`, `leaf_from_builtin` from Task 2.
- Produces: `enum_values` populated from `xs:enumeration`; `attributes` populated from `xs:attribute`; `fn collect_attributes(t: Node) -> Vec<Attribute>`.

- [ ] **Step 1: Write the failing test**

Create `src-tauri/src/wsdl/testdata/fields.xsd`:

```xml
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"
           targetNamespace="http://ex/fields">
  <xs:element name="Order">
    <xs:complexType>
      <xs:sequence>
        <xs:element name="status">
          <xs:simpleType>
            <xs:restriction base="xs:string">
              <xs:enumeration value="NEW"/>
              <xs:enumeration value="PAID"/>
            </xs:restriction>
          </xs:simpleType>
        </xs:element>
        <xs:element name="note" type="xs:string" minOccurs="0" nillable="true"/>
        <xs:element name="qty" type="xs:int" minOccurs="1" maxOccurs="unbounded"/>
        <xs:element name="channel" type="xs:string" default="web"/>
      </xs:sequence>
      <xs:attribute name="id" type="xs:string" use="required"/>
    </xs:complexType>
  </xs:element>
</xs:schema>
```

Add to the `tests` module in `xsd.rs`:

```rust
    #[test]
    fn fields_enum_occurs_nillable_default_attributes() {
        let set = set_from(include_str!("testdata/fields.xsd"));
        let root = QName { namespace: "http://ex/fields".into(), local: "Order".into() };
        let node = build_schema(&set, &root).unwrap();
        let NodeKind::Sequence(children) = &node.kind else { panic!() };

        let status = &children[0];
        let NodeKind::Leaf { enum_values, .. } = &status.kind else { panic!() };
        assert_eq!(enum_values, &vec!["NEW".to_string(), "PAID".to_string()]);

        let note = &children[1];
        assert!(note.occurs.optional());
        assert!(note.nillable);

        let qty = &children[2];
        assert!(qty.occurs.repeatable());

        let channel = &children[3];
        let NodeKind::Leaf { default, .. } = &channel.kind else { panic!() };
        assert_eq!(default.as_deref(), Some("web"));

        assert_eq!(node.attributes.len(), 1);
        assert_eq!(node.attributes[0].name, "id");
        assert!(node.attributes[0].required);
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test --lib wsdl::xsd::tests::fields`
Expected: FAIL — enum_values empty / attributes empty.

- [ ] **Step 3: Write minimal implementation**

In `xsd.rs`, replace `leaf_from_simple_type` with a version that reads the restriction:

```rust
fn leaf_from_simple_type(t: Node, el: Node) -> NodeKind {
    let restriction = t.children().find(|c| c.has_tag_name((XSD_NS, "restriction")));
    let base_local = restriction
        .and_then(|r| r.attribute("base"))
        .map(|b| b.rsplit(':').next().unwrap_or(b).to_string())
        .unwrap_or_else(|| "string".into());
    let enum_values = restriction
        .map(|r| {
            r.children()
                .filter(|c| c.has_tag_name((XSD_NS, "enumeration")))
                .filter_map(|e| e.attribute("value").map(str::to_string))
                .collect()
        })
        .unwrap_or_default();
    NodeKind::Leaf {
        xsd_type: map_xsd_type(&base_local),
        enum_values,
        default: el.attribute("default").map(str::to_string),
        fixed: el.attribute("fixed").map(str::to_string),
    }
}
```

Add an attribute collector and wire it into `walk_element` + `walk_complex`. Add this function:

```rust
fn collect_attributes(container: Node) -> Vec<Attribute> {
    container
        .children()
        .filter(|c| c.has_tag_name((XSD_NS, "attribute")))
        .filter_map(|a| {
            let name = a.attribute("name")?.to_string();
            let type_local = a
                .attribute("type")
                .map(|t| t.rsplit(':').next().unwrap_or(t))
                .unwrap_or("string");
            Some(Attribute {
                name,
                xsd_type: map_xsd_type(type_local),
                required: a.attribute("use") == Some("required"),
                enum_values: vec![],
                default: a.attribute("default").map(str::to_string),
            })
        })
        .collect()
}
```

Add the import at the top of `xsd.rs`:

```rust
use crate::domain::schema::Attribute;
```

Thread attributes from the resolved complexType into the `SchemaNode`. Change `walk_element` so the complexType branch also returns its attributes. Simplest approach: have `walk_complex` return `(NodeKind, Vec<Attribute>)` and set them on the node:

```rust
    fn walk_element(
        &self,
        el: Node<'a, 'a>,
        path_types: &mut Vec<(String, String)>,
        depth: usize,
    ) -> Result<SchemaNode, WsdlError> {
        let occurs = read_occurs(el);
        let nillable = el.attribute("nillable") == Some("true");
        let doc = read_doc(el);

        let type_node = el
            .children()
            .find(|c| c.has_tag_name((XSD_NS, "complexType")) || c.has_tag_name((XSD_NS, "simpleType")));

        let (kind, attributes) = match type_node {
            Some(t) if t.has_tag_name((XSD_NS, "complexType")) => {
                (self.walk_complex(t, path_types, depth)?, collect_attributes(t))
            }
            Some(t) => (leaf_from_simple_type(t, el), vec![]),
            None => match el.attribute("type") {
                Some(type_ref) => {
                    let tq = resolve_ref(el, type_ref);
                    let attrs = self
                        .named_type(&tq)
                        .map(collect_attributes)
                        .unwrap_or_default();
                    (self.walk_named_type(&tq, el, path_types, depth)?, attrs)
                }
                None => (
                    NodeKind::Leaf {
                        xsd_type: XsdType::String,
                        enum_values: vec![],
                        default: el.attribute("default").map(str::to_string),
                        fixed: el.attribute("fixed").map(str::to_string),
                    },
                    vec![],
                ),
            },
        };

        Ok(SchemaNode {
            name: el.attribute("name").unwrap_or_default().to_string(),
            namespace: schema_tns(el),
            occurs,
            nillable,
            doc,
            attributes,
            kind,
        })
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-tauri && cargo test --lib wsdl::xsd`
Expected: PASS (all xsd tests, including `fields_...`).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/wsdl/xsd.rs src-tauri/src/wsdl/testdata/fields.xsd
git commit -m "feat(wsdl): xsd enums, occurs, nillable, default, attributes"
```

---

### Task 4: `xs:choice`, `xs:all` → Sequence, `element ref`

**Files:**
- Create: `src-tauri/src/wsdl/testdata/choice_ref.xsd`
- Modify: `src-tauri/src/wsdl/xsd.rs`

**Interfaces:**
- Consumes: `Index::walk_complex`, `Index::element`, `resolve_ref` from earlier tasks.
- Produces: `walk_complex` handles `choice` (→ `NodeKind::Choice`) and `all` (→ `NodeKind::Sequence`); `walk_element` resolves child `ref="qname"` to a global element.

- [ ] **Step 1: Write the failing test**

Create `src-tauri/src/wsdl/testdata/choice_ref.xsd`:

```xml
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"
           xmlns:tns="http://ex/cr"
           targetNamespace="http://ex/cr">
  <xs:element name="City" type="xs:string"/>
  <xs:element name="Pay">
    <xs:complexType>
      <xs:choice>
        <xs:element name="card" type="xs:string"/>
        <xs:element name="cash" type="xs:boolean"/>
      </xs:choice>
    </xs:complexType>
  </xs:element>
  <xs:element name="Addr">
    <xs:complexType>
      <xs:all>
        <xs:element ref="tns:City"/>
        <xs:element name="zip" type="xs:string"/>
      </xs:all>
    </xs:complexType>
  </xs:element>
</xs:schema>
```

Add to the `tests` module:

```rust
    #[test]
    fn choice_becomes_choice() {
        let set = set_from(include_str!("testdata/choice_ref.xsd"));
        let root = QName { namespace: "http://ex/cr".into(), local: "Pay".into() };
        let node = build_schema(&set, &root).unwrap();
        let NodeKind::Choice(branches) = &node.kind else { panic!("{:?}", node.kind) };
        assert_eq!(branches.len(), 2);
        assert_eq!(branches[0].name, "card");
    }

    #[test]
    fn all_becomes_sequence_and_ref_resolves() {
        let set = set_from(include_str!("testdata/choice_ref.xsd"));
        let root = QName { namespace: "http://ex/cr".into(), local: "Addr".into() };
        let node = build_schema(&set, &root).unwrap();
        let NodeKind::Sequence(children) = &node.kind else { panic!("{:?}", node.kind) };
        assert_eq!(children.len(), 2);
        assert_eq!(children[0].name, "City"); // resolved from ref
        assert!(matches!(children[0].kind, NodeKind::Leaf { xsd_type: XsdType::String, .. }));
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test --lib wsdl::xsd::tests::choice`
Expected: FAIL — choice yields empty Sequence; `all` unhandled.

- [ ] **Step 3: Write minimal implementation**

In `xsd.rs`, replace `walk_complex` with:

```rust
    fn walk_complex(
        &self,
        t: Node<'a, 'a>,
        path_types: &mut Vec<(String, String)>,
        depth: usize,
    ) -> Result<NodeKind, WsdlError> {
        for child in t.children().filter(Node::is_element) {
            if child.has_tag_name((XSD_NS, "sequence")) || child.has_tag_name((XSD_NS, "all")) {
                return Ok(NodeKind::Sequence(self.walk_particle(child, path_types, depth)?));
            }
            if child.has_tag_name((XSD_NS, "choice")) {
                return Ok(NodeKind::Choice(self.walk_particle(child, path_types, depth)?));
            }
        }
        Ok(NodeKind::Sequence(vec![]))
    }

    fn walk_particle(
        &self,
        particle: Node<'a, 'a>,
        path_types: &mut Vec<(String, String)>,
        depth: usize,
    ) -> Result<Vec<SchemaNode>, WsdlError> {
        let mut out = Vec::new();
        for child in particle.children().filter(|c| c.has_tag_name((XSD_NS, "element"))) {
            let resolved = match child.attribute("ref") {
                Some(r) => {
                    let q = resolve_ref(child, r);
                    self.element(&q)
                        .ok_or_else(|| WsdlError::ElementNotFound { qname: qname_str(&q) })?
                }
                None => child,
            };
            out.push(self.walk_element(resolved, path_types, depth)?);
        }
        Ok(out)
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-tauri && cargo test --lib wsdl::xsd`
Expected: PASS (all xsd tests).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/wsdl/xsd.rs src-tauri/src/wsdl/testdata/choice_ref.xsd
git commit -m "feat(wsdl): xsd choice, xs:all as sequence, element ref"
```

---

### Task 5: `extension` / `restriction` (complexContent + simpleContent)

Flatten inheritance: a derived complexType inlines the base's particle + attributes, then appends its own.

**Files:**
- Create: `src-tauri/src/wsdl/testdata/inherit.xsd`
- Modify: `src-tauri/src/wsdl/xsd.rs`

**Interfaces:**
- Consumes: `Index::walk_complex`, `Index::walk_particle`, `Index::named_type`, `collect_attributes`.
- Produces: `walk_complex` resolves `complexContent`/`simpleContent` `extension`/`restriction`, merging base content.

- [ ] **Step 1: Write the failing test**

Create `src-tauri/src/wsdl/testdata/inherit.xsd`:

```xml
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"
           xmlns:tns="http://ex/inh"
           targetNamespace="http://ex/inh">
  <xs:complexType name="Base">
    <xs:sequence>
      <xs:element name="id" type="xs:string"/>
    </xs:sequence>
    <xs:attribute name="version" type="xs:string"/>
  </xs:complexType>
  <xs:element name="Derived">
    <xs:complexType>
      <xs:complexContent>
        <xs:extension base="tns:Base">
          <xs:sequence>
            <xs:element name="extra" type="xs:int"/>
          </xs:sequence>
        </xs:extension>
      </xs:complexContent>
    </xs:complexType>
  </xs:element>
</xs:schema>
```

Add to the `tests` module:

```rust
    #[test]
    fn extension_flattens_base_then_derived() {
        let set = set_from(include_str!("testdata/inherit.xsd"));
        let root = QName { namespace: "http://ex/inh".into(), local: "Derived".into() };
        let node = build_schema(&set, &root).unwrap();
        let NodeKind::Sequence(children) = &node.kind else { panic!("{:?}", node.kind) };
        let names: Vec<&str> = children.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(names, vec!["id", "extra"]); // base first, then derived
        assert!(node.attributes.iter().any(|a| a.name == "version"));
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test --lib wsdl::xsd::tests::extension`
Expected: FAIL — `Derived` yields empty Sequence (complexContent unhandled).

- [ ] **Step 3: Write minimal implementation**

In `xsd.rs`, update `walk_complex` to handle `complexContent`/`simpleContent` before the particle scan, and merge base content. Replace `walk_complex` with:

```rust
    fn walk_complex(
        &self,
        t: Node<'a, 'a>,
        path_types: &mut Vec<(String, String)>,
        depth: usize,
    ) -> Result<NodeKind, WsdlError> {
        if let Some(content) = t.children().find(|c| {
            c.has_tag_name((XSD_NS, "complexContent")) || c.has_tag_name((XSD_NS, "simpleContent"))
        }) {
            return self.walk_derived_content(content, path_types, depth);
        }
        for child in t.children().filter(Node::is_element) {
            if child.has_tag_name((XSD_NS, "sequence")) || child.has_tag_name((XSD_NS, "all")) {
                return Ok(NodeKind::Sequence(self.walk_particle(child, path_types, depth)?));
            }
            if child.has_tag_name((XSD_NS, "choice")) {
                return Ok(NodeKind::Choice(self.walk_particle(child, path_types, depth)?));
            }
        }
        Ok(NodeKind::Sequence(vec![]))
    }

    /// complexContent/simpleContent extension|restriction: merge base then derived.
    fn walk_derived_content(
        &self,
        content: Node<'a, 'a>,
        path_types: &mut Vec<(String, String)>,
        depth: usize,
    ) -> Result<NodeKind, WsdlError> {
        let deriv = content
            .children()
            .find(|c| c.has_tag_name((XSD_NS, "extension")) || c.has_tag_name((XSD_NS, "restriction")));
        let Some(deriv) = deriv else { return Ok(NodeKind::Sequence(vec![])) };

        let mut children = Vec::new();
        // Base children first.
        if let Some(base_ref) = deriv.attribute("base") {
            let bq = resolve_ref(deriv, base_ref);
            if bq.namespace != XSD_NS {
                if let Some(base_t) = self.named_type(&bq) {
                    if let NodeKind::Sequence(base_children) =
                        self.walk_complex(base_t, path_types, depth)?
                    {
                        children.extend(base_children);
                    }
                }
            }
        }
        // Derived particle appended.
        for child in deriv.children().filter(Node::is_element) {
            if child.has_tag_name((XSD_NS, "sequence")) || child.has_tag_name((XSD_NS, "all")) {
                children.extend(self.walk_particle(child, path_types, depth)?);
            } else if child.has_tag_name((XSD_NS, "choice")) {
                // A choice inside an extension stays a nested Choice branch group.
                let branches = self.walk_particle(child, path_types, depth)?;
                children.push(SchemaNode {
                    name: String::new(),
                    namespace: None,
                    occurs: Occurs { min: 1, max: MaxOccurs::Bounded(1) },
                    nillable: false,
                    doc: None,
                    attributes: vec![],
                    kind: NodeKind::Choice(branches),
                });
            }
        }
        Ok(NodeKind::Sequence(children))
    }
```

Update `walk_element` so a complexType with derived content also gathers inherited + derived attributes. Replace the complexType arm's attribute collection:

```rust
            Some(t) if t.has_tag_name((XSD_NS, "complexType")) => {
                (self.walk_complex(t, path_types, depth)?, self.collect_all_attributes(t))
            }
```

And in the named-type arm, use `self.collect_all_attributes` on the resolved type instead of `collect_attributes`:

```rust
                Some(type_ref) => {
                    let tq = resolve_ref(el, type_ref);
                    let attrs = self
                        .named_type(&tq)
                        .map(|t| self.collect_all_attributes(t))
                        .unwrap_or_default();
                    (self.walk_named_type(&tq, el, path_types, depth)?, attrs)
                }
```

Add the recursive attribute collector as an `Index` method:

```rust
    fn collect_all_attributes(&self, t: Node<'a, 'a>) -> Vec<Attribute> {
        let mut attrs = collect_attributes(t);
        if let Some(content) = t.children().find(|c| {
            c.has_tag_name((XSD_NS, "complexContent")) || c.has_tag_name((XSD_NS, "simpleContent"))
        }) {
            if let Some(deriv) = content.children().find(|c| {
                c.has_tag_name((XSD_NS, "extension")) || c.has_tag_name((XSD_NS, "restriction"))
            }) {
                attrs.extend(collect_attributes(deriv));
                if let Some(base_ref) = deriv.attribute("base") {
                    let bq = resolve_ref(deriv, base_ref);
                    if bq.namespace != XSD_NS {
                        if let Some(base_t) = self.named_type(&bq) {
                            attrs.extend(self.collect_all_attributes(base_t));
                        }
                    }
                }
            }
        }
        attrs
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-tauri && cargo test --lib wsdl::xsd`
Expected: PASS (all xsd tests).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/wsdl/xsd.rs src-tauri/src/wsdl/testdata/inherit.xsd
git commit -m "feat(wsdl): xsd extension/restriction inheritance flattening"
```

---

### Task 6: Fallbacks — `xs:any`, `group`/`attributeGroup`, recursion cutoff

**Files:**
- Create: `src-tauri/src/wsdl/testdata/fallbacks.xsd`
- Modify: `src-tauri/src/wsdl/xsd.rs`

**Interfaces:**
- Consumes: `Index::walk_complex`, `Index::walk_named_type`, `recursive_placeholder`.
- Produces: `walk_complex` emits marked `Any` for `xs:any` and `group`/`attributeGroup`; `recursive_placeholder` and the unsupported placeholder set distinct `doc` markers. Because these need a `doc` marker, they return a full `SchemaNode`, so introduce `unsupported_placeholder()` and have `walk_complex` return `NodeKind::Any` while `walk_element`/`walk_particle` stamp the marker via a helper.

- [ ] **Step 1: Write the failing test**

Create `src-tauri/src/wsdl/testdata/fallbacks.xsd`:

```xml
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"
           xmlns:tns="http://ex/fb"
           targetNamespace="http://ex/fb">
  <xs:group name="G">
    <xs:sequence><xs:element name="g1" type="xs:string"/></xs:sequence>
  </xs:group>
  <xs:element name="WithAny">
    <xs:complexType><xs:sequence><xs:any/></xs:sequence></xs:complexType>
  </xs:element>
  <xs:element name="WithGroup">
    <xs:complexType><xs:group ref="tns:G"/></xs:complexType>
  </xs:element>
  <xs:complexType name="Node">
    <xs:sequence>
      <xs:element name="value" type="xs:string"/>
      <xs:element name="next" type="tns:Node" minOccurs="0"/>
    </xs:sequence>
  </xs:complexType>
  <xs:element name="Recursive" type="tns:Node"/>
</xs:schema>
```

Add to the `tests` module:

```rust
    fn first_leaf_or_any(node: &SchemaNode) -> &NodeKind { &node.kind }

    #[test]
    fn xs_any_becomes_any() {
        let set = set_from(include_str!("testdata/fallbacks.xsd"));
        let root = QName { namespace: "http://ex/fb".into(), local: "WithAny".into() };
        let node = build_schema(&set, &root).unwrap();
        let NodeKind::Sequence(children) = &node.kind else { panic!() };
        assert!(matches!(children[0].kind, NodeKind::Any));
    }

    #[test]
    fn group_ref_is_marked_any() {
        let set = set_from(include_str!("testdata/fallbacks.xsd"));
        let root = QName { namespace: "http://ex/fb".into(), local: "WithGroup".into() };
        let node = build_schema(&set, &root).unwrap();
        assert!(matches!(node.kind, NodeKind::Any));
        assert_eq!(node.doc.as_deref(), Some("unsupported: edit raw"));
    }

    #[test]
    fn recursive_type_terminates_with_marker() {
        let set = set_from(include_str!("testdata/fallbacks.xsd"));
        let root = QName { namespace: "http://ex/fb".into(), local: "Recursive".into() };
        let node = build_schema(&set, &root).unwrap(); // must not stack-overflow
        // Walk down `next` until the guard emits an Any marked "recursive...".
        fn find_recursive(n: &SchemaNode) -> bool {
            if matches!(n.kind, NodeKind::Any) && n.doc.as_deref() == Some("recursive: expand on demand") {
                return true;
            }
            match &n.kind {
                NodeKind::Sequence(c) | NodeKind::Choice(c) => c.iter().any(find_recursive),
                _ => false,
            }
        }
        assert!(find_recursive(&node));
        let _ = first_leaf_or_any(&node);
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test --lib wsdl::xsd::tests`
Expected: FAIL — `xs:any` ignored; group ref yields empty Sequence with no marker; recursion may not mark correctly.

- [ ] **Step 3: Write minimal implementation**

In `xsd.rs`, replace the `xs:any` / unsupported handling. First, make `walk_complex` recognize `xs:any`, `group`, and `attributeGroup` and signal a marked-`Any` node. Since markers live on `SchemaNode.doc`, handle them where the `SchemaNode` is built.

Update `walk_particle` to emit a marked `Any` child for `xs:any`:

```rust
    fn walk_particle(
        &self,
        particle: Node<'a, 'a>,
        path_types: &mut Vec<(String, String)>,
        depth: usize,
    ) -> Result<Vec<SchemaNode>, WsdlError> {
        let mut out = Vec::new();
        for child in particle.children().filter(Node::is_element) {
            if child.has_tag_name((XSD_NS, "any")) {
                out.push(any_node("", None));
                continue;
            }
            if child.has_tag_name((XSD_NS, "group")) {
                out.push(any_node("", Some(UNSUPPORTED_DOC)));
                continue;
            }
            if !child.has_tag_name((XSD_NS, "element")) {
                continue;
            }
            let resolved = match child.attribute("ref") {
                Some(r) => {
                    let q = resolve_ref(child, r);
                    self.element(&q)
                        .ok_or_else(|| WsdlError::ElementNotFound { qname: qname_str(&q) })?
                }
                None => child,
            };
            out.push(self.walk_element(resolved, path_types, depth)?);
        }
        Ok(out)
    }
```

Update `walk_complex` so a complexType whose direct child is `group`/`attributeGroup` (not wrapped in a particle) returns a marked `Any`. Add at the start of `walk_complex`, before the derived-content check:

```rust
        if t.children().any(|c| {
            c.has_tag_name((XSD_NS, "group")) || c.has_tag_name((XSD_NS, "attributeGroup"))
        }) && !t.children().any(|c| {
            c.has_tag_name((XSD_NS, "sequence"))
                || c.has_tag_name((XSD_NS, "choice"))
                || c.has_tag_name((XSD_NS, "all"))
                || c.has_tag_name((XSD_NS, "complexContent"))
                || c.has_tag_name((XSD_NS, "simpleContent"))
        }) {
            return Ok(NodeKind::Any); // marker stamped by caller (walk_element)
        }
```

Because `walk_complex` returns only a `NodeKind`, stamp the `doc` marker in `walk_element` when the resulting kind is `Any` and the source was an unsupported construct. Simplest: detect it in `walk_element` after computing `kind`:

```rust
        let doc = read_doc(el).or_else(|| unsupported_marker(&kind, el));
```

Define the marker constants and helpers near the other free functions:

```rust
const UNSUPPORTED_DOC: &str = "unsupported: edit raw";
const RECURSIVE_DOC: &str = "recursive: expand on demand";

fn any_node(name: &str, doc: Option<&str>) -> SchemaNode {
    SchemaNode {
        name: name.to_string(),
        namespace: None,
        occurs: Occurs { min: 1, max: MaxOccurs::Bounded(1) },
        nillable: false,
        doc: doc.map(str::to_string),
        attributes: vec![],
        kind: NodeKind::Any,
    }
}

/// A complexType that resolved to Any because of an unsupported construct
/// (group/attributeGroup) gets the raw-editor marker.
fn unsupported_marker(kind: &NodeKind, el: Node) -> Option<String> {
    if matches!(kind, NodeKind::Any) {
        let has_group = el
            .children()
            .find(|c| c.has_tag_name((XSD_NS, "complexType")))
            .map(|t| {
                t.children().any(|c| {
                    c.has_tag_name((XSD_NS, "group")) || c.has_tag_name((XSD_NS, "attributeGroup"))
                })
            })
            .unwrap_or(false);
        if has_group {
            return Some(UNSUPPORTED_DOC.to_string());
        }
    }
    None
}
```

Replace `recursive_placeholder` so it carries the recursive marker, and have `walk_named_type` return the full placeholder node's kind + let the guard mark it. Since `walk_named_type` returns `NodeKind`, keep the marker on the element by returning `Any` and stamping in `walk_element`. Simpler and robust: make `walk_named_type` return a marked `SchemaNode` path only for the placeholder by having the guard produce the marker through the element `doc`. Concretely, change the guard branch to stamp via a thread-local-free approach — return `NodeKind::Any` and detect recursion in `walk_element`:

Replace the guard in `walk_named_type`:

```rust
        if depth >= DEPTH_CAP || path_types.contains(&key) {
            return Ok(NodeKind::Any);
        }
```

And extend `unsupported_marker` to also recognize the recursion case by checking whether the element's `@type` names a complexType currently on the path. To keep the marker deterministic without re-deriving the path, pass the marker explicitly instead: change `walk_element` to compute the kind and a marker together. Replace the whole named-type arm and doc line with a small `Marked` return:

```rust
        // kind + optional marker, computed together
        let (kind, attributes, marker) = self.resolve_kind(el, path_types, depth)?;
        let doc = read_doc(el).or(marker);
```

Add the `resolve_kind` method that centralizes marker logic:

```rust
    fn resolve_kind(
        &self,
        el: Node<'a, 'a>,
        path_types: &mut Vec<(String, String)>,
        depth: usize,
    ) -> Result<(NodeKind, Vec<Attribute>, Option<String>), WsdlError> {
        let type_node = el
            .children()
            .find(|c| c.has_tag_name((XSD_NS, "complexType")) || c.has_tag_name((XSD_NS, "simpleType")));
        match type_node {
            Some(t) if t.has_tag_name((XSD_NS, "complexType")) => {
                let kind = self.walk_complex(t, path_types, depth)?;
                let marker = matches!(kind, NodeKind::Any).then(|| UNSUPPORTED_DOC.to_string());
                Ok((kind, self.collect_all_attributes(t), marker))
            }
            Some(t) => Ok((leaf_from_simple_type(t, el), vec![], None)),
            None => match el.attribute("type") {
                Some(type_ref) => {
                    let tq = resolve_ref(el, type_ref);
                    if tq.namespace == XSD_NS {
                        return Ok((leaf_from_builtin(&tq, el), vec![], None));
                    }
                    let key = (tq.namespace.clone(), tq.local.clone());
                    let t = self
                        .named_type(&tq)
                        .ok_or_else(|| WsdlError::TypeNotFound { qname: qname_str(&tq) })?;
                    if t.has_tag_name((XSD_NS, "simpleType")) {
                        return Ok((leaf_from_simple_type(t, el), vec![], None));
                    }
                    if depth >= DEPTH_CAP || path_types.contains(&key) {
                        return Ok((NodeKind::Any, vec![], Some(RECURSIVE_DOC.to_string())));
                    }
                    path_types.push(key);
                    let kind = self.walk_complex(t, path_types, depth + 1)?;
                    path_types.pop();
                    let attrs = self.collect_all_attributes(t);
                    let marker = matches!(kind, NodeKind::Any).then(|| UNSUPPORTED_DOC.to_string());
                    Ok((kind, attrs, marker))
                }
                None => Ok((
                    NodeKind::Leaf {
                        xsd_type: XsdType::String,
                        enum_values: vec![],
                        default: el.attribute("default").map(str::to_string),
                        fixed: el.attribute("fixed").map(str::to_string),
                    },
                    vec![],
                    None,
                )),
            },
        }
    }
```

Now delete the old `walk_named_type` method and the old inline `match type_node` block in `walk_element`, and delete the now-unused `unsupported_marker`. `walk_element` becomes:

```rust
    fn walk_element(
        &self,
        el: Node<'a, 'a>,
        path_types: &mut Vec<(String, String)>,
        depth: usize,
    ) -> Result<SchemaNode, WsdlError> {
        let occurs = read_occurs(el);
        let nillable = el.attribute("nillable") == Some("true");
        let (kind, attributes, marker) = self.resolve_kind(el, path_types, depth)?;
        let doc = read_doc(el).or(marker);
        Ok(SchemaNode {
            name: el.attribute("name").unwrap_or_default().to_string(),
            namespace: schema_tns(el),
            occurs,
            nillable,
            doc,
            attributes,
            kind,
        })
    }
```

Delete the standalone `recursive_placeholder` function (superseded by the `RECURSIVE_DOC` marker in `resolve_kind`).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-tauri && cargo test --lib wsdl::xsd`
Expected: PASS (all xsd tests). Confirm no infinite recursion (test completes).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/wsdl/xsd.rs src-tauri/src/wsdl/testdata/fallbacks.xsd
git commit -m "feat(wsdl): xsd fallbacks — xs:any, group ref, recursion cutoff"
```

---

### Task 7: `get_operation_schema` command + registration + end-to-end test

**Files:**
- Modify: `src-tauri/src/commands/mod.rs`, `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `wsdl::resolve::resolve`, `wsdl::xsd::build_schema`, `domain::wsdl::QName`, `domain::schema::SchemaNode`, the reqwest `fetch` closure pattern from `import_wsdl`.
- Produces: `#[tauri::command] pub async fn get_operation_schema(wsdl_url: String, input_element: QName) -> Result<SchemaNode, String>`.

- [ ] **Step 1: Write the failing test**

Add to the `tests` module in `src-tauri/src/wsdl/xsd.rs` an end-to-end test that mirrors what the command does (resolve on an in-memory doc via an injected fetch, then `build_schema`), so the command's glue is exercised without network:

```rust
    #[tokio::test]
    async fn resolve_then_build_end_to_end() {
        let root_url = "mem://calc.wsdl";
        let root_xml = include_str!("testdata/calculator.wsdl");
        let fetch = |_u: String| async move { Ok::<String, String>(String::new()) };
        let set = crate::wsdl::resolve::resolve(root_url, root_xml, fetch)
            .await
            .unwrap();
        let root = QName { namespace: "http://example.com/calc".into(), local: "Add".into() };
        let node = build_schema(&set, &root).unwrap();
        let json = serde_json::to_string(&node).unwrap();
        assert!(json.contains("\"name\":\"Add\""), "got: {json}");
    }
```

- [ ] **Step 2: Run test to verify it fails, then passes as written**

Run: `cd src-tauri && cargo test --lib wsdl::xsd::tests::resolve_then_build`
Expected: PASS (this asserts the resolve→build glue; if the calculator has no imports the fetch closure is never called). If it fails to compile because `tokio` test macro is unavailable, confirm `tokio` is a dev-dependency (it is used by resolve tests) — this test is the guard for the command's logic.

- [ ] **Step 3: Write the command**

Add to `src-tauri/src/commands/mod.rs` (after `confirm_wsdl_import`):

```rust
use crate::domain::schema::SchemaNode;
use crate::domain::wsdl::QName;

#[tauri::command]
pub async fn get_operation_schema(
    wsdl_url: String,
    input_element: QName,
) -> Result<SchemaNode, String> {
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

    let root_xml = fetch(wsdl_url.clone()).await.map_err(|message| {
        wsdl::error::WsdlError::Fetch { url: wsdl_url.clone(), message }.to_string()
    })?;
    let set = wsdl::resolve::resolve(&wsdl_url, &root_xml, fetch)
        .await
        .map_err(|e| e.to_string())?;
    wsdl::xsd::build_schema(&set, &input_element).map_err(|e| e.to_string())
}
```

Register it in `src-tauri/src/lib.rs` inside `generate_handler!`:

```rust
            commands::import_wsdl,
            commands::confirm_wsdl_import,
            commands::get_operation_schema,
```

- [ ] **Step 4: Verify build + full test suite + clippy**

Run: `cd src-tauri && cargo test --lib && cargo clippy --all-targets -- -D warnings && cargo fmt --check`
Expected: PASS — all tests green, no clippy warnings, formatting clean.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/mod.rs src-tauri/src/lib.rs src-tauri/src/wsdl/xsd.rs
git commit -m "feat(commands): get_operation_schema — wsdl_url + input_element -> SchemaNode"
```

---

## Manual Verification (end of slice)

1. `cd src-tauri && cargo test --lib` — all green.
2. In a scratch `#[tokio::test]` or a temporary `println!`, run `get_operation_schema` against a real public WSDL (e.g. the dneonline calculator: `http://www.dneonline.com/calculator.asmx?WSDL`, `input_element = {http://tempuri.org/}Add`) and confirm the returned `SchemaNode` JSON is a `Sequence` of two integer leaves (`intA`, `intB`).
3. Then a WSDL with nested complex types / a `choice` to confirm sequence/choice/extension expansion end-to-end.

## Notes / Divergences flagged

- **No `bindings.ts` / no `specta` in this repo.** Despite CLAUDE.md/docs, tauri-specta is not wired: `specta` is not a dependency, no type derives `specta::Type`, `lib.rs` uses `tauri::generate_handler!`, and `src/bindings.ts` does not exist. The frontend uses hand-written types in `src/lib/api.ts` with plain `invoke()`. Documented as a TODO in `docs/decisions.md` ADR-007. New IPC types therefore derive only `Serialize, Deserialize` (matching `domain/wsdl.rs`). Slice 2 ships zero UI, so no `api.ts` wrapper is added — the `getOperationSchema` wrapper belongs to slice 3 (SchemaForm).
- `xs:int`/`long`/`short`/`byte` map to `XsdType::Integer`; `float` to `Double`. Extends the domain-model §2 subset pragmatically (real WSDLs use `xs:int`).
