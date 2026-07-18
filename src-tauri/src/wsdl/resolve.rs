use crate::wsdl::error::WsdlError;
use std::collections::HashSet;
use std::future::Future;

const XSD_NS: &str = "http://www.w3.org/2001/XMLSchema";

#[derive(Debug)]
#[allow(dead_code)] // fields consumed by slice 2 (xsd -> SchemaNode)
pub struct ResolvedDoc {
    pub url: String,
    pub xml: String,
}

/// All fetched documents (root WSDL first). Slice 2 parses schemas out of these.
#[derive(Debug)]
#[allow(dead_code)] // consumed by slice 2 (xsd -> SchemaNode); import_wsdl only validates
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
        let xml = fetch(url.clone())
            .await
            .map_err(|message| WsdlError::Fetch {
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
        let err = resolve(
            "http://example.com/svc/svc.wsdl",
            &wsdl,
            fetcher(HashMap::new()),
        )
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
        assert!(
            matches!(err, WsdlError::InvalidXml { url, .. } if url == "http://example.com/svc/a.xsd")
        );
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
