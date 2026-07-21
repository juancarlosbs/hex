//! Parse a SOAP envelope back into a `FormValue`, guided by the operation's
//! `SchemaNode`. The exact inverse of `engine::serialize::build_envelope`, so a
//! round-trip preserves the form value. Any XML that does not conform to the
//! schema (missing/extra elements, malformed markup, a populated `soap:Header`)
//! is rejected — the caller keeps the raw XML instead.

use crate::domain::schema::{NodeKind, SchemaNode};
use crate::domain::value::FormValue;
use roxmltree::{Document, Node};
use thiserror::Error;

const XSI: &str = "http://www.w3.org/2001/XMLSchema-instance";

#[derive(Debug, Error)]
pub enum DeserializeError {
    #[error("malformed XML: {0}")]
    Malformed(String),
    #[error("{0}")]
    Structure(String),
}

fn structure(msg: impl Into<String>) -> DeserializeError {
    DeserializeError::Structure(msg.into())
}

/// Parse the `soap:Body` of `xml` into a `FormValue` for `schema`.
pub fn parse_envelope(schema: &SchemaNode, xml: &str) -> Result<FormValue, DeserializeError> {
    let doc = Document::parse(xml).map_err(|e| DeserializeError::Malformed(e.to_string()))?;
    let root = doc.root_element();
    if root.tag_name().name() != "Envelope" {
        return Err(structure("root element is not a SOAP Envelope"));
    }
    // The form does not represent SOAP headers — refuse to silently drop one.
    if let Some(header) = child_element(&root, "Header") {
        if header.children().any(|n| n.is_element()) {
            return Err(structure("soap:Header is not representable in the form"));
        }
    }
    let body = child_element(&root, "Body").ok_or_else(|| structure("missing soap:Body"))?;
    let children: Vec<Node> = body.children().filter(Node::is_element).collect();
    let mut cur = 0;
    let value = parse_node(schema, &children, &mut cur)?;
    if cur != children.len() {
        return Err(structure("unexpected extra elements in soap:Body"));
    }
    Ok(value)
}

fn child_element<'a, 'input>(parent: &Node<'a, 'input>, local: &str) -> Option<Node<'a, 'input>> {
    parent
        .children()
        .find(|n| n.is_element() && n.tag_name().name() == local)
}

fn matches(node: &SchemaNode, elem: &Node) -> bool {
    node.name == elem.tag_name().name() && node.namespace.as_deref() == elem.tag_name().namespace()
}

fn is_nil(elem: &Node) -> bool {
    elem.attribute((XSI, "nil")) == Some("true")
}

/// Consume 0..N sibling elements for `node` (mirrors `serialize::write_node`).
fn parse_node(
    node: &SchemaNode,
    sibs: &[Node],
    cur: &mut usize,
) -> Result<FormValue, DeserializeError> {
    // Nameless inline choice (e.g. an <xs:choice> inside an extension): no wrapper
    // element — one branch element sits directly among the siblings.
    if let NodeKind::Choice(branches) = &node.kind {
        if node.name.is_empty() {
            return parse_inline_choice(branches, sibs, cur);
        }
    }

    if node.occurs.repeatable() {
        let mut items = Vec::new();
        while *cur < sibs.len() && matches(node, &sibs[*cur]) {
            items.push(parse_one(node, &sibs[*cur])?);
            *cur += 1;
        }
        return Ok(FormValue::Repeated(items));
    }

    if *cur < sibs.len() && matches(node, &sibs[*cur]) {
        let elem = sibs[*cur];
        *cur += 1;
        parse_one(node, &elem)
    } else if node.occurs.min == 0 {
        Ok(FormValue::Omitted)
    } else {
        Err(structure(format!("missing required element <{}>", node.name)))
    }
}

fn parse_inline_choice(
    branches: &[SchemaNode],
    sibs: &[Node],
    cur: &mut usize,
) -> Result<FormValue, DeserializeError> {
    let elem = sibs
        .get(*cur)
        .ok_or_else(|| structure("missing choice element"))?;
    let (branch, node) = branches
        .iter()
        .enumerate()
        .find(|(_, b)| matches(b, elem))
        .ok_or_else(|| structure("no matching choice branch"))?;
    let value = parse_node(node, sibs, cur)?;
    Ok(FormValue::Choice {
        branch,
        value: Box::new(value),
    })
}

/// Parse the single element `elem` for `node` (mirrors `serialize::write_one`).
fn parse_one(node: &SchemaNode, elem: &Node) -> Result<FormValue, DeserializeError> {
    if is_nil(elem) {
        return Ok(FormValue::Nil);
    }
    match &node.kind {
        NodeKind::Leaf { .. } => Ok(FormValue::Leaf(Some(elem.text().unwrap_or("").to_string()))),
        NodeKind::Sequence(children) => {
            let child_elems: Vec<Node> = elem.children().filter(Node::is_element).collect();
            let mut cur = 0;
            let mut vals = Vec::with_capacity(children.len());
            for c in children {
                vals.push(parse_node(c, &child_elems, &mut cur)?);
            }
            if cur != child_elems.len() {
                return Err(structure(format!(
                    "unexpected extra elements in <{}>",
                    node.name
                )));
            }
            Ok(FormValue::Sequence(vals))
        }
        NodeKind::Choice(branches) => {
            let child_elems: Vec<Node> = elem.children().filter(Node::is_element).collect();
            let first = child_elems
                .first()
                .ok_or_else(|| structure(format!("empty choice <{}>", node.name)))?;
            let (branch, bnode) = branches
                .iter()
                .enumerate()
                .find(|(_, b)| matches(b, first))
                .ok_or_else(|| structure(format!("no matching choice branch in <{}>", node.name)))?;
            let mut cur = 0;
            let value = parse_node(bnode, &child_elems, &mut cur)?;
            if cur != child_elems.len() {
                return Err(structure(format!(
                    "unexpected extra elements in choice <{}>",
                    node.name
                )));
            }
            Ok(FormValue::Choice {
                branch,
                value: Box::new(value),
            })
        }
        NodeKind::Any => Err(structure("xs:any is not editable in the XML view")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::schema::{MaxOccurs, Occurs, XsdType};
    use crate::engine::serialize::build_envelope;

    fn occ(min: u32, max: MaxOccurs) -> Occurs {
        Occurs { min, max }
    }

    fn leaf(name: &str, min: u32) -> SchemaNode {
        SchemaNode {
            name: name.into(),
            namespace: Some("urn:test".into()),
            occurs: occ(min, MaxOccurs::Bounded(1)),
            nillable: false,
            doc: None,
            attributes: vec![],
            kind: NodeKind::Leaf {
                xsd_type: XsdType::String,
                enum_values: vec![],
                default: None,
                fixed: None,
            },
        }
    }

    fn seq(name: &str, children: Vec<SchemaNode>) -> SchemaNode {
        SchemaNode {
            name: name.into(),
            namespace: Some("urn:test".into()),
            occurs: occ(1, MaxOccurs::Bounded(1)),
            nillable: false,
            doc: None,
            attributes: vec![],
            kind: NodeKind::Sequence(children),
        }
    }

    fn roundtrip(schema: &SchemaNode, value: &FormValue) -> FormValue {
        let (xml, _) = build_envelope(schema, value, "1.2", "urn:act").unwrap();
        parse_envelope(schema, &xml).unwrap()
    }

    #[test]
    fn roundtrips_leaf_optional_and_repeatable() {
        let mut repeatable = leaf("Item", 1);
        repeatable.occurs = occ(1, MaxOccurs::Unbounded);
        let schema = seq("Op", vec![leaf("A", 1), leaf("B", 0), repeatable]);

        let value = FormValue::Sequence(vec![
            FormValue::Leaf(Some("hello".into())),
            FormValue::Omitted,
            FormValue::Repeated(vec![
                FormValue::Leaf(Some("1".into())),
                FormValue::Leaf(Some("2".into())),
            ]),
        ]);
        assert_eq!(roundtrip(&schema, &value), value);
    }

    #[test]
    fn roundtrips_choice_and_nil() {
        let mut nillable = leaf("N", 1);
        nillable.nillable = true;
        let choice = SchemaNode {
            name: "Pick".into(),
            namespace: Some("urn:test".into()),
            occurs: occ(1, MaxOccurs::Bounded(1)),
            nillable: false,
            doc: None,
            attributes: vec![],
            kind: NodeKind::Choice(vec![leaf("X", 1), leaf("Y", 1)]),
        };
        let schema = seq("Op", vec![choice, nillable]);

        let value = FormValue::Sequence(vec![
            FormValue::Choice {
                branch: 1,
                value: Box::new(FormValue::Leaf(Some("y".into()))),
            },
            FormValue::Nil,
        ]);
        assert_eq!(roundtrip(&schema, &value), value);
    }

    #[test]
    fn rejects_malformed_xml() {
        let schema = seq("Op", vec![leaf("A", 1)]);
        assert!(matches!(
            parse_envelope(&schema, "<not-closed>"),
            Err(DeserializeError::Malformed(_))
        ));
    }

    #[test]
    fn rejects_missing_required_element() {
        let schema = seq("Op", vec![leaf("A", 1)]);
        let xml = r#"<soapenv:Envelope xmlns:soapenv="http://www.w3.org/2003/05/soap-envelope"><soapenv:Body><Op xmlns="urn:test"></Op></soapenv:Body></soapenv:Envelope>"#;
        assert!(matches!(
            parse_envelope(&schema, xml),
            Err(DeserializeError::Structure(_))
        ));
    }

    #[test]
    fn rejects_populated_header() {
        let schema = seq("Op", vec![leaf("A", 1)]);
        let (xml, _) = build_envelope(
            &schema,
            &FormValue::Sequence(vec![FormValue::Leaf(Some("x".into()))]),
            "1.2",
            "urn:act",
        )
        .unwrap();
        let with_header = xml.replace(
            "<soapenv:Body>",
            "<soapenv:Header><wsse:Security xmlns:wsse=\"urn:w\"/></soapenv:Header><soapenv:Body>",
        );
        assert!(matches!(
            parse_envelope(&schema, &with_header),
            Err(DeserializeError::Structure(_))
        ));
    }
}
