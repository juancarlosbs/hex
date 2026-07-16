use crate::persistence::collection::{AuthData, BodyData, KeyValueEntry};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
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
#[allow(dead_code)]
pub struct HttpResponse {
    pub status: u16,
    pub status_text: String,
    pub time_ms: u64,
    pub size_bytes: u64,
    pub headers: HashMap<String, String>,
    pub body: String,
}

#[allow(dead_code)]
fn enabled(list: &[KeyValueEntry]) -> impl Iterator<Item = &KeyValueEntry> {
    list.iter().filter(|kv| kv.enabled && !kv.key.is_empty())
}

#[allow(dead_code)]
fn build_request(client: &reqwest::Client, spec: &SendSpec) -> Result<reqwest::Request, String> {
    let method = reqwest::Method::from_bytes(spec.method.as_bytes())
        .map_err(|_| format!("invalid method: {}", spec.method))?;
    let mut rb = client.request(method, &spec.url);

    let query: Vec<(&str, &str)> = enabled(&spec.params)
        .map(|kv| (kv.key.as_str(), kv.value.as_str()))
        .collect();
    if !query.is_empty() {
        rb = rb.query(&query);
    }

    match &spec.auth {
        AuthData::None => {}
        AuthData::Basic { username, password } => {
            rb = rb.basic_auth(username, Some(password));
        }
        AuthData::Bearer { token } => {
            rb = rb.bearer_auth(token);
        }
        AuthData::Apikey { key, value, add_to } => {
            if add_to == "query" {
                rb = rb.query(&[(key.as_str(), value.as_str())]);
            } else {
                rb = rb.header(key, value);
            }
        }
    }

    match spec.body.mode.as_str() {
        "json" => {
            if !spec.body.json.is_empty() {
                let has_content_type =
                    enabled(&spec.headers).any(|kv| kv.key.eq_ignore_ascii_case("content-type"));
                if !has_content_type {
                    rb = rb.header("Content-Type", "application/json");
                }
                rb = rb.body(spec.body.json.clone());
            }
        }
        "form-urlencoded" => {
            let pairs: Vec<(&str, &str)> = enabled(&spec.body.form)
                .map(|kv| (kv.key.as_str(), kv.value.as_str()))
                .collect();
            rb = rb.form(&pairs);
        }
        "form-multipart" => return Err("multipart body is not supported yet".into()),
        other => return Err(format!("unknown body mode: {other}")),
    }

    let mut req = rb.build().map_err(|e| e.to_string())?;
    for kv in enabled(&spec.headers) {
        let name = reqwest::header::HeaderName::from_bytes(kv.key.as_bytes())
            .map_err(|_| format!("invalid header name: {}", kv.key))?;
        let value = reqwest::header::HeaderValue::from_str(&kv.value)
            .map_err(|_| format!("invalid header value for: {}", kv.key))?;
        req.headers_mut().insert(name, value);
    }
    Ok(req)
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

    pub fn build(spec: &SendSpec) -> Result<reqwest::Request, String> {
        build_request(&reqwest::Client::new(), spec)
    }

    #[test]
    fn merges_enabled_params_into_existing_query() {
        let mut s = spec("https://api.dev/items?page=2");
        s.params = vec![kv("q", "witch", true), kv("skip", "me", false)];
        let req = build(&s).unwrap();
        assert_eq!(req.url().as_str(), "https://api.dev/items?page=2&q=witch");
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
        assert_eq!(build(&s).unwrap().method(), &reqwest::Method::DELETE);
    }

    #[test]
    fn applies_basic_auth() {
        let mut s = spec("https://api.dev");
        s.auth = AuthData::Basic {
            username: "ada".into(),
            password: "pw".into(),
        };
        let req = build(&s).unwrap();
        let v = req
            .headers()
            .get("authorization")
            .unwrap()
            .to_str()
            .unwrap();
        assert!(v.starts_with("Basic "));
    }

    #[test]
    fn applies_bearer_auth() {
        let mut s = spec("https://api.dev");
        s.auth = AuthData::Bearer {
            token: "tok123".into(),
        };
        let req = build(&s).unwrap();
        assert_eq!(req.headers().get("authorization").unwrap(), "Bearer tok123");
    }

    #[test]
    fn applies_apikey_in_header() {
        let mut s = spec("https://api.dev");
        s.auth = AuthData::Apikey {
            key: "X-Api-Key".into(),
            value: "k1".into(),
            add_to: "header".into(),
        };
        let req = build(&s).unwrap();
        assert_eq!(req.headers().get("x-api-key").unwrap(), "k1");
    }

    #[test]
    fn applies_apikey_in_query() {
        let mut s = spec("https://api.dev/x");
        s.auth = AuthData::Apikey {
            key: "api_key".into(),
            value: "k1".into(),
            add_to: "query".into(),
        };
        let req = build(&s).unwrap();
        assert_eq!(req.url().as_str(), "https://api.dev/x?api_key=k1");
    }

    #[test]
    fn sets_enabled_headers_and_skips_disabled() {
        let mut s = spec("https://api.dev");
        s.headers = vec![kv("X-Trace", "1", true), kv("X-Off", "no", false)];
        let req = build(&s).unwrap();
        assert_eq!(req.headers().get("x-trace").unwrap(), "1");
        assert!(req.headers().get("x-off").is_none());
    }

    #[test]
    fn user_authorization_header_overrides_auth_config() {
        let mut s = spec("https://api.dev");
        s.auth = AuthData::Bearer {
            token: "tok".into(),
        };
        s.headers = vec![kv("Authorization", "Custom abc", true)];
        let req = build(&s).unwrap();
        let all: Vec<_> = req.headers().get_all("authorization").iter().collect();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0], "Custom abc");
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
        let req = build(&s).unwrap();
        assert_eq!(
            req.headers().get("content-type").unwrap(),
            "application/json"
        );
        let body = req.body().unwrap().as_bytes().unwrap();
        assert_eq!(body, br#"{"a":1}"#);
    }

    #[test]
    fn json_body_respects_user_content_type() {
        let mut s = spec("https://api.dev");
        s.method = "POST".into();
        s.body.json = "<x/>".into();
        s.headers = vec![kv("Content-Type", "application/xml", true)];
        let req = build(&s).unwrap();
        let all: Vec<_> = req.headers().get_all("content-type").iter().collect();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0], "application/xml");
    }

    #[test]
    fn empty_json_body_sends_no_body() {
        let mut s = spec("https://api.dev");
        s.method = "POST".into();
        let req = build(&s).unwrap();
        assert!(req.body().is_none());
        assert!(req.headers().get("content-type").is_none());
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
        let req = build(&s).unwrap();
        assert_eq!(
            req.headers().get("content-type").unwrap(),
            "application/x-www-form-urlencoded"
        );
        let body = req.body().unwrap().as_bytes().unwrap();
        assert_eq!(body, b"a=1&b=x+y");
    }

    #[test]
    fn multipart_body_is_rejected() {
        let mut s = spec("https://api.dev");
        s.body.mode = "form-multipart".into();
        let err = build(&s).unwrap_err();
        assert!(err.contains("not supported yet"));
    }
}
