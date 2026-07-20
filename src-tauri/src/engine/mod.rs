use crate::persistence::collection::{AuthData, BodyData, KeyValueEntry};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub mod connector;
pub mod error;
pub mod fault;
pub mod serialize;

use connector::TimingBreakdown;
use fault::SoapFault;

#[derive(Debug, Deserialize)]
pub struct SendSpec {
    pub method: String,
    pub url: String,
    #[serde(default)]
    pub params: Vec<KeyValueEntry>,
    #[serde(default)]
    pub headers: Vec<KeyValueEntry>,
    pub body: BodyData,
    pub auth: AuthData,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpResponse {
    pub status: u16,
    pub status_text: String,
    pub time_ms: u64,
    pub size_bytes: u64,
    pub headers: HashMap<String, String>,
    pub body: String,
    pub timing: TimingBreakdown,
    pub fault: Option<SoapFault>,
}

/// True when a Content-Type header indicates XML/SOAP (fault detection only applies there).
fn is_xml_content_type(headers: &HashMap<String, String>) -> bool {
    headers.get("content-type").is_some_and(|ct| {
        let ct = ct.to_ascii_lowercase();
        ct.contains("text/xml") || ct.contains("application/soap+xml") || ct.contains("/xml")
    })
}

fn enabled(list: &[KeyValueEntry]) -> impl Iterator<Item = &KeyValueEntry> {
    list.iter().filter(|kv| kv.enabled && !kv.key.is_empty())
}

/// Sets a header, replacing any existing entry with the same name (case-insensitive) —
/// mirrors `HeaderMap::insert`, used so a user-supplied header always wins over a default.
fn set_header(headers: &mut Vec<(String, String)>, name: &str, value: String) {
    headers.retain(|(k, _)| !k.eq_ignore_ascii_case(name));
    headers.push((name.to_string(), value));
}

type BuiltRequest = (String, url::Url, Vec<(String, String)>, Vec<u8>);

fn build_request(spec: &SendSpec) -> Result<BuiltRequest, String> {
    http::Method::from_bytes(spec.method.as_bytes())
        .map_err(|_| format!("invalid method: {}", spec.method))?;

    let mut url = url::Url::parse(&spec.url).map_err(|e| e.to_string())?;
    {
        let mut pairs = url.query_pairs_mut();
        for kv in enabled(&spec.params) {
            pairs.append_pair(&kv.key, &kv.value);
        }
    }

    let mut headers: Vec<(String, String)> = Vec::new();

    match &spec.auth {
        AuthData::None => {}
        AuthData::Basic { username, password } => {
            use base64::Engine;
            let encoded =
                base64::engine::general_purpose::STANDARD.encode(format!("{username}:{password}"));
            set_header(&mut headers, "Authorization", format!("Basic {encoded}"));
        }
        AuthData::Bearer { token } => {
            set_header(&mut headers, "Authorization", format!("Bearer {token}"));
        }
        AuthData::Apikey { key, value, add_to } => {
            if add_to == "query" {
                url.query_pairs_mut().append_pair(key, value);
            } else {
                set_header(&mut headers, key, value.clone());
            }
        }
    }

    let mut body: Vec<u8> = Vec::new();
    match spec.body.mode.as_str() {
        "json" => {
            if !spec.body.json.is_empty() {
                // a user Content-Type header always wins: the header loop below
                // replaces this default, so no absence check is needed here
                set_header(&mut headers, "Content-Type", "application/json".into());
                body = spec.body.json.clone().into_bytes();
            }
        }
        "form-urlencoded" => {
            let pairs: Vec<(&str, &str)> = enabled(&spec.body.form)
                .map(|kv| (kv.key.as_str(), kv.value.as_str()))
                .collect();
            set_header(
                &mut headers,
                "Content-Type",
                "application/x-www-form-urlencoded".into(),
            );
            body = url::form_urlencoded::Serializer::new(String::new())
                .extend_pairs(pairs)
                .finish()
                .into_bytes();
        }
        "form-multipart" => return Err("multipart body is not supported yet".into()),
        other => return Err(format!("unknown body mode: {other}")),
    }

    for kv in enabled(&spec.headers) {
        http::header::HeaderName::from_bytes(kv.key.as_bytes())
            .map_err(|_| format!("invalid header name: {}", kv.key))?;
        http::header::HeaderValue::from_str(&kv.value)
            .map_err(|_| format!("invalid header value for: {}", kv.key))?;
        set_header(&mut headers, &kv.key, kv.value.clone());
    }

    Ok((spec.method.clone(), url, headers, body))
}

fn to_http_response(raw: connector::RawResponse) -> HttpResponse {
    let mut headers: HashMap<String, String> = HashMap::new();
    for (name, value) in raw.headers {
        headers
            .entry(name)
            .and_modify(|existing| {
                existing.push_str(", ");
                existing.push_str(&value);
            })
            .or_insert(value);
    }

    let fault = if is_xml_content_type(&headers) {
        fault::detect_fault(&raw.body)
    } else {
        None
    };

    HttpResponse {
        status: raw.status,
        status_text: http::StatusCode::from_u16(raw.status)
            .ok()
            .and_then(|s| s.canonical_reason())
            .unwrap_or("")
            .to_string(),
        time_ms: raw.timing.total_ms,
        size_bytes: raw.body.len() as u64,
        headers,
        body: raw.body,
        timing: raw.timing,
        fault,
    }
}

pub async fn send(spec: SendSpec) -> Result<HttpResponse, String> {
    let (method, url, headers, body) = build_request(&spec)?;

    let raw = connector::execute(&method, &url, headers, body)
        .await
        .map_err(|e| e.to_string())?;

    Ok(to_http_response(raw))
}

/// POSTs a pre-serialized SOAP envelope to `endpoint` using `meta`'s content type
/// and optional SOAPAction header, mapping the raw response the same way as `send`.
pub async fn send_soap_envelope(
    endpoint: &str,
    envelope: String,
    meta: serialize::SoapMeta,
) -> Result<HttpResponse, String> {
    let url = url::Url::parse(endpoint).map_err(|e| e.to_string())?;

    let mut headers = vec![("Content-Type".to_string(), meta.content_type)];
    if let Some((name, value)) = meta.soap_action_header {
        headers.push((name, value));
    }

    let raw = connector::execute("POST", &url, headers, envelope.into_bytes())
        .await
        .map_err(|e| e.to_string())?;

    Ok(to_http_response(raw))
}

#[cfg(test)]
mod tests {
    use super::*;

    pub fn kv(key: &str, value: &str, enabled: bool) -> KeyValueEntry {
        KeyValueEntry {
            id: "id".into(),
            key: key.into(),
            value: value.into(),
            description: None,
            enabled,
            entry_type: None,
        }
    }

    pub fn spec(url: &str) -> SendSpec {
        SendSpec {
            method: "GET".into(),
            url: url.into(),
            params: vec![],
            headers: vec![],
            body: BodyData {
                mode: "json".into(),
                json: String::new(),
                form: vec![],
            },
            auth: AuthData::None,
        }
    }

    pub fn build(spec: &SendSpec) -> Result<BuiltRequest, String> {
        build_request(spec)
    }

    /// Case-insensitive header lookup, mirroring `HeaderMap::get`.
    fn header<'a>(headers: &'a [(String, String)], name: &str) -> Option<&'a str> {
        headers
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.as_str())
    }

    fn header_count(headers: &[(String, String)], name: &str) -> usize {
        headers
            .iter()
            .filter(|(k, _)| k.eq_ignore_ascii_case(name))
            .count()
    }

    #[test]
    fn merges_enabled_params_into_existing_query() {
        let mut s = spec("https://api.dev/items?page=2");
        s.params = vec![kv("q", "witch", true), kv("skip", "me", false)];
        let (_, url, _, _) = build(&s).unwrap();
        assert_eq!(url.as_str(), "https://api.dev/items?page=2&q=witch");
    }

    #[test]
    fn rejects_invalid_method() {
        let mut s = spec("https://api.dev");
        s.method = "GE T".into();
        assert!(build(&s).is_err());
    }

    #[test]
    fn rejects_invalid_url() {
        assert!(build(&spec("not a url")).is_err());
    }

    #[test]
    fn sets_method() {
        let mut s = spec("https://api.dev");
        s.method = "DELETE".into();
        let (method, _, _, _) = build(&s).unwrap();
        assert_eq!(method, "DELETE");
    }

    #[test]
    fn applies_basic_auth() {
        let mut s = spec("https://api.dev");
        s.auth = AuthData::Basic {
            username: "ada".into(),
            password: "pw".into(),
        };
        let (_, _, headers, _) = build(&s).unwrap();
        let v = header(&headers, "authorization").unwrap();
        assert!(v.starts_with("Basic "));
    }

    #[test]
    fn applies_bearer_auth() {
        let mut s = spec("https://api.dev");
        s.auth = AuthData::Bearer {
            token: "tok123".into(),
        };
        let (_, _, headers, _) = build(&s).unwrap();
        assert_eq!(header(&headers, "authorization").unwrap(), "Bearer tok123");
    }

    #[test]
    fn applies_apikey_in_header() {
        let mut s = spec("https://api.dev");
        s.auth = AuthData::Apikey {
            key: "X-Api-Key".into(),
            value: "k1".into(),
            add_to: "header".into(),
        };
        let (_, _, headers, _) = build(&s).unwrap();
        assert_eq!(header(&headers, "x-api-key").unwrap(), "k1");
    }

    #[test]
    fn applies_apikey_in_query() {
        let mut s = spec("https://api.dev/x");
        s.auth = AuthData::Apikey {
            key: "api_key".into(),
            value: "k1".into(),
            add_to: "query".into(),
        };
        let (_, url, _, _) = build(&s).unwrap();
        assert_eq!(url.as_str(), "https://api.dev/x?api_key=k1");
    }

    #[test]
    fn sets_enabled_headers_and_skips_disabled() {
        let mut s = spec("https://api.dev");
        s.headers = vec![kv("X-Trace", "1", true), kv("X-Off", "no", false)];
        let (_, _, headers, _) = build(&s).unwrap();
        assert_eq!(header(&headers, "x-trace").unwrap(), "1");
        assert!(header(&headers, "x-off").is_none());
    }

    #[test]
    fn user_authorization_header_overrides_auth_config() {
        let mut s = spec("https://api.dev");
        s.auth = AuthData::Bearer {
            token: "tok".into(),
        };
        s.headers = vec![kv("Authorization", "Custom abc", true)];
        let (_, _, headers, _) = build(&s).unwrap();
        assert_eq!(header_count(&headers, "authorization"), 1);
        assert_eq!(header(&headers, "authorization").unwrap(), "Custom abc");
    }

    #[test]
    fn rejects_invalid_header_name() {
        let mut s = spec("https://api.dev");
        s.headers = vec![kv("bad name", "v", true)];
        assert!(build(&s).is_err());
    }

    #[test]
    fn json_body_sets_content_type_when_absent() {
        let mut s = spec("https://api.dev");
        s.method = "POST".into();
        s.body.json = r#"{"a":1}"#.into();
        let (_, _, headers, body) = build(&s).unwrap();
        assert_eq!(
            header(&headers, "content-type").unwrap(),
            "application/json"
        );
        assert_eq!(body, br#"{"a":1}"#);
    }

    #[test]
    fn json_body_respects_user_content_type() {
        let mut s = spec("https://api.dev");
        s.method = "POST".into();
        s.body.json = "<x/>".into();
        s.headers = vec![kv("Content-Type", "application/xml", true)];
        let (_, _, headers, _) = build(&s).unwrap();
        assert_eq!(header_count(&headers, "content-type"), 1);
        assert_eq!(header(&headers, "content-type").unwrap(), "application/xml");
    }

    #[test]
    fn empty_json_body_sends_no_body() {
        let mut s = spec("https://api.dev");
        s.method = "POST".into();
        let (_, _, headers, body) = build(&s).unwrap();
        assert!(body.is_empty());
        assert!(header(&headers, "content-type").is_none());
    }

    #[test]
    fn urlencoded_body_encodes_enabled_pairs() {
        let mut s = spec("https://api.dev");
        s.method = "POST".into();
        s.body.mode = "form-urlencoded".into();
        s.body.form = vec![
            kv("a", "1", true),
            kv("b", "x y", true),
            kv("c", "no", false),
        ];
        let (_, _, headers, body) = build(&s).unwrap();
        assert_eq!(
            header(&headers, "content-type").unwrap(),
            "application/x-www-form-urlencoded"
        );
        assert_eq!(body, b"a=1&b=x+y");
    }

    #[test]
    fn multipart_body_is_rejected() {
        let mut s = spec("https://api.dev");
        s.body.mode = "form-multipart".into();
        let err = build(&s).unwrap_err();
        assert!(err.contains("not supported yet"));
    }

    /// Minimal one-shot HTTP server on a random port; replies with `response` and closes.
    fn spawn_test_server(response: &'static str) -> String {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                use std::io::{Read, Write};
                let mut buf = [0u8; 4096];
                let _ = stream.read(&mut buf);
                let _ = stream.write_all(response.as_bytes());
            }
        });
        format!("http://{addr}")
    }

    #[tokio::test]
    async fn send_returns_status_headers_body_time_and_size() {
        let url = spawn_test_server(
            "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: 11\r\nconnection: close\r\n\r\n{\"ok\":true}",
        );
        let resp = send(spec(&url)).await.unwrap();
        assert_eq!(resp.status, 200);
        assert_eq!(resp.status_text, "OK");
        assert_eq!(resp.body, "{\"ok\":true}");
        assert_eq!(resp.size_bytes, 11);
        assert_eq!(
            resp.headers.get("content-type").unwrap(),
            "application/json"
        );
        assert!(resp.time_ms < 30_000);
    }

    #[tokio::test]
    async fn send_maps_connection_error_to_string() {
        // Bind then drop a listener so the port is very likely closed.
        let addr = {
            let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            l.local_addr().unwrap()
        };
        let err = send(spec(&format!("http://{addr}"))).await.unwrap_err();
        assert!(!err.is_empty());
    }
}
