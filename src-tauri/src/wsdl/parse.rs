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

    let service = wsdl_child(root, "service").ok_or_else(|| not_found("wsdl:service"))?;
    let service_name = service.attribute("name").unwrap_or("Service").to_string();

    // First port with a soap 1.1/1.2 address (skips HTTP-GET/POST ports).
    let (endpoint, binding_name) = service
        .children()
        .filter(|c| c.has_tag_name((WSDL_NS, "port")))
        .find_map(|port| {
            let addr = port.children().find(|c| is_soap(c, "address"))?;
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
        if op
            .descendants()
            .any(|d| is_soap(&d, "body") && d.attribute("use") == Some("encoded"))
        {
            return Err(WsdlError::UnsupportedStyle);
        }
        if let Some(soap_op) = op.children().find(|c| is_soap(c, "operation")) {
            if soap_op.attribute("style") == Some("rpc") {
                return Err(WsdlError::UnsupportedStyle);
            }
            actions.insert(
                name,
                soap_op
                    .attribute("soapAction")
                    .unwrap_or_default()
                    .to_string(),
            );
        }
    }

    let port_type_name = local_part(
        binding
            .attribute("type")
            .ok_or_else(|| not_found("binding/@type"))?,
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
            input
                .attribute("message")
                .ok_or_else(|| not_found("input/@message"))?,
        );
        let message = wsdl_children(root, "message")
            .find(|m| m.attribute("name") == Some(msg_name))
            .ok_or_else(|| not_found(&format!("wsdl:message {msg_name}")))?;
        let part = message
            .children()
            .find(|c| c.has_tag_name((WSDL_NS, "part")))
            .ok_or_else(|| not_found(&format!("part of message {msg_name}")))?;
        let element = part.attribute("element").ok_or_else(|| {
            not_found(&format!(
                "part/@element of message {msg_name} (type-based parts are rpc-style)"
            ))
        })?;
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

    Ok(WsdlDocument {
        service_name,
        operations,
    })
}

fn wsdl_child<'a>(node: Node<'a, 'a>, tag: &str) -> Option<Node<'a, 'a>> {
    node.children().find(|c| c.has_tag_name((WSDL_NS, tag)))
}

fn wsdl_children<'a>(node: Node<'a, 'a>, tag: &'a str) -> impl Iterator<Item = Node<'a, 'a>> {
    node.children()
        .filter(move |c| c.has_tag_name((WSDL_NS, tag)))
}

fn wsdl_op_children<'a>(node: Node<'a, 'a>) -> impl Iterator<Item = Node<'a, 'a>> {
    wsdl_children(node, "operation")
}

fn is_soap(node: &Node, tag: &str) -> bool {
    node.has_tag_name((SOAP11_NS, tag)) || node.has_tag_name((SOAP12_NS, tag))
}

fn not_found(qname: &str) -> WsdlError {
    WsdlError::ElementNotFound {
        qname: qname.to_string(),
    }
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
        namespace: node
            .lookup_namespace_uri(prefix)
            .unwrap_or_default()
            .to_string(),
        local: local.to_string(),
    }
}

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
