// build_envelope is not wired into engine::client / commands yet (later task); allow
// dead_code until that call site exists.
#![allow(dead_code)]

use crate::domain::error::DomainError;
use crate::domain::schema::{MaxOccurs, NodeKind, SchemaNode};
use crate::domain::value::FormValue;
use quick_xml::events::{BytesEnd, BytesStart, BytesText, Event};
use quick_xml::Writer;
use std::collections::BTreeMap;
use std::io::Cursor;

const SOAP11: &str = "http://schemas.xmlsoap.org/soap/envelope/";
const SOAP12: &str = "http://www.w3.org/2003/05/soap-envelope";

pub struct SoapMeta {
    pub content_type: String,
    pub soap_action_header: Option<(String, String)>,
}

#[derive(Default)]
struct NsRegistry {
    map: Vec<(String, String)>, // (uri, prefix) in discovery order
}

impl NsRegistry {
    fn prefix_for(&mut self, uri: &str) -> String {
        if let Some((_, p)) = self.map.iter().find(|(u, _)| u == uri) {
            return p.clone();
        }
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

fn write_node(
    w: &mut Writer<Cursor<Vec<u8>>>,
    node: &SchemaNode,
    value: &FormValue,
    reg: &mut NsRegistry,
    path: &str,
) -> Result<(), DomainError> {
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

fn write_one(
    w: &mut Writer<Cursor<Vec<u8>>>,
    node: &SchemaNode,
    value: &FormValue,
    reg: &mut NsRegistry,
    path: &str,
) -> Result<(), DomainError> {
    let tag = qualified(&node.name, node.namespace.as_deref(), reg);
    match (&node.kind, value) {
        (_, FormValue::Nil) => {
            let mut start = BytesStart::new(&tag);
            start.push_attribute(("xsi:nil", "true"));
            w.write_event(Event::Empty(start)).unwrap();
        }
        (NodeKind::Leaf { .. }, FormValue::Leaf(v)) => {
            // ponytail: leaf attribute emission (node.attributes on the start tag)
            // deferred until a real WSDL needs simpleContent attributes.
            w.write_event(Event::Start(BytesStart::new(&tag))).unwrap();
            if let Some(s) = v {
                w.write_event(Event::Text(BytesText::new(s))).unwrap();
            }
            w.write_event(Event::End(BytesEnd::new(&tag))).unwrap();
        }
        (NodeKind::Sequence(children), FormValue::Sequence(vals)) => {
            if children.len() != vals.len() {
                return Err(DomainError::ValueMismatch { path: path.into() });
            }
            w.write_event(Event::Start(BytesStart::new(&tag))).unwrap();
            for (i, (c, v)) in children.iter().zip(vals).enumerate() {
                write_node(w, c, v, reg, &format!("{path}/{i}"))?;
            }
            w.write_event(Event::End(BytesEnd::new(&tag))).unwrap();
        }
        (NodeKind::Choice(branches), FormValue::Choice { branch, value }) => {
            let b = branches
                .get(*branch)
                .ok_or(DomainError::ValueMismatch { path: path.into() })?;
            w.write_event(Event::Start(BytesStart::new(&tag))).unwrap();
            write_node(w, b, value, reg, &format!("{path}/choice"))?;
            w.write_event(Event::End(BytesEnd::new(&tag))).unwrap();
        }
        (NodeKind::Any, FormValue::Raw(xml)) => {
            // insert verbatim (from_escaped: writer emits the bytes as-is, no re-escaping)
            w.write_event(Event::Text(BytesText::from_escaped(xml.as_str())))
                .unwrap();
        }
        _ => return Err(DomainError::ValueMismatch { path: path.into() }),
    }
    Ok(())
}

/// Returns the full envelope XML string for the given body element + form values.
pub fn build_envelope(
    schema: &SchemaNode,
    value: &FormValue,
    soap_version: &str,
    soap_action: &str,
) -> Result<(String, SoapMeta), DomainError> {
    let mut reg = NsRegistry::default();
    let mut body = Writer::new(Cursor::new(Vec::new()));
    write_node(&mut body, schema, value, &mut reg, "")?;
    let body_xml = String::from_utf8(body.into_inner().into_inner()).unwrap();

    let env_ns = if soap_version == "1.2" {
        SOAP12
    } else {
        SOAP11
    };
    // Declare soapenv + all discovered ns prefixes on the root.
    let mut decls = format!(
        " xmlns:soapenv=\"{env_ns}\" xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\""
    );
    let ns_map: BTreeMap<&str, &str> = reg
        .map
        .iter()
        .map(|(u, p)| (p.as_str(), u.as_str()))
        .collect();
    for (p, u) in ns_map {
        decls.push_str(&format!(" xmlns:{p}=\"{u}\""));
    }
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::schema::*;
    use crate::domain::value::FormValue;

    fn leaf(name: &str, ns: Option<&str>) -> SchemaNode {
        SchemaNode {
            name: name.into(),
            namespace: ns.map(str::to_string),
            occurs: Occurs {
                min: 1,
                max: MaxOccurs::Bounded(1),
            },
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

    #[test]
    fn sequence_with_namespaced_leaf_11() {
        let schema = SchemaNode {
            name: "Order".into(),
            namespace: Some("http://ex.com/t".into()),
            occurs: Occurs {
                min: 1,
                max: MaxOccurs::Bounded(1),
            },
            nillable: false,
            doc: None,
            attributes: vec![],
            kind: NodeKind::Sequence(vec![leaf("id", None)]),
        };
        let value = FormValue::Sequence(vec![FormValue::Leaf(Some("A1".into()))]);
        let (xml, meta) = build_envelope(&schema, &value, "1.1", "urn:place").unwrap();
        assert!(xml.contains("http://schemas.xmlsoap.org/soap/envelope/"));
        assert!(xml.contains(":Order")); // root is namespaced (prefix ns0)
        assert!(xml.contains("<id>A1</id>") || xml.contains(":id"));
        assert_eq!(meta.content_type, "text/xml; charset=utf-8");
        assert_eq!(
            meta.soap_action_header,
            Some(("SOAPAction".into(), "\"urn:place\"".into()))
        );
    }

    #[test]
    fn optional_omitted_is_not_emitted() {
        let mut opt = leaf("note", None);
        opt.occurs = Occurs {
            min: 0,
            max: MaxOccurs::Bounded(1),
        };
        let schema = SchemaNode {
            kind: NodeKind::Sequence(vec![opt]),
            ..leaf("Root", Some("http://ex.com/t"))
        };
        let value = FormValue::Sequence(vec![FormValue::Omitted]);
        let (xml, _) = build_envelope(&schema, &value, "1.2", "").unwrap();
        assert!(!xml.contains("note"));
    }

    #[test]
    fn v12_content_type_carries_action() {
        let (_, meta) = build_envelope(
            &leaf("Ping", Some("http://ex.com/t")),
            &FormValue::Leaf(Some("x".into())),
            "1.2",
            "urn:ping",
        )
        .unwrap();
        assert!(meta.content_type.starts_with("application/soap+xml"));
        assert!(meta.content_type.contains("action=\"urn:ping\""));
        assert_eq!(meta.soap_action_header, None);
    }
}
