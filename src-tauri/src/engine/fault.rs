use roxmltree::Document;
use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SoapFault {
    pub code: String,
    pub reason: String,
    pub detail: Option<String>,
    pub actor: Option<String>,
}

/// Parse a response body for a SOAP Fault (1.1 or 1.2). None if not a fault / not XML.
pub fn detect_fault(body: &str) -> Option<SoapFault> {
    let doc = Document::parse(body).ok()?;
    let fault = doc
        .descendants()
        .find(|n| n.is_element() && n.tag_name().name() == "Fault")?;

    let child_text = |local: &str| -> Option<String> {
        fault
            .descendants()
            .find(|n| n.is_element() && n.tag_name().name() == local)
            .and_then(|n| n.text())
            .map(|t| t.trim().to_string())
    };

    // SOAP 1.1: <faultcode>/<faultstring>. SOAP 1.2: <Code><Value>/<Reason><Text>.
    let code = child_text("faultcode").or_else(|| child_text("Value"))?;
    let reason = child_text("faultstring").or_else(|| child_text("Text"))?;
    let detail = child_text("detail").or_else(|| child_text("Detail"));
    let actor = child_text("faultactor").or_else(|| child_text("Role"));

    Some(SoapFault {
        code,
        reason,
        detail,
        actor,
    })
}

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
