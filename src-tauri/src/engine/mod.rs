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

    rb.build().map_err(|e| e.to_string())
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
}
