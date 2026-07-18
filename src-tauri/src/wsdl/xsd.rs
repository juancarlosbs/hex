use crate::domain::schema::{Attribute, MaxOccurs, NodeKind, Occurs, SchemaNode, XsdType};
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
}
