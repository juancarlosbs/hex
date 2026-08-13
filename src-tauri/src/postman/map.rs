use super::parse::{
    PostmanAuth, PostmanBody, PostmanCollection, PostmanGraphql, PostmanItem, PostmanKeyValue,
    PostmanRequest, PostmanUrl,
};
use crate::persistence::collection::{
    AuthData, BodyData, CollectionNode, KeyValueEntry, RequestFile, RequestKind, RequestNode,
};

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize, specta::Type)]
pub struct ImportSummary {
    pub skipped: Vec<String>,
}

pub fn map_collection(
    pc: PostmanCollection,
) -> (String, Vec<CollectionNode>, Vec<RequestFile>, ImportSummary) {
    let mut requests = Vec::new();
    let mut summary = ImportSummary::default();
    let nodes = pc
        .item
        .into_iter()
        .map(|item| map_item(item, &mut requests, &mut summary))
        .collect();
    (pc.info.name, nodes, requests, summary)
}

fn map_item(
    item: PostmanItem,
    requests: &mut Vec<RequestFile>,
    summary: &mut ImportSummary,
) -> CollectionNode {
    if let Some(children) = item.item {
        let mapped = children
            .into_iter()
            .map(|c| map_item(c, requests, summary))
            .collect();
        CollectionNode::Folder {
            id: uuid::Uuid::new_v4().to_string(),
            name: item.name,
            children: mapped,
        }
    } else if let Some(req) = item.request {
        let id = uuid::Uuid::new_v4().to_string();
        let (kind, params, headers, body, auth) = map_request(&item.name, req, summary);
        requests.push(RequestFile {
            id: id.clone(),
            name: item.name.clone(),
            kind: kind.clone(),
            params,
            headers,
            body,
            auth,
        });
        CollectionNode::Request(RequestNode {
            id,
            name: item.name,
            kind,
        })
    } else {
        summary.skipped.push(format!(
            "Item \"{}\": neither a folder nor a request, skipped",
            item.name
        ));
        CollectionNode::Folder {
            id: uuid::Uuid::new_v4().to_string(),
            name: item.name,
            children: vec![],
        }
    }
}

fn map_request(
    name: &str,
    req: PostmanRequest,
    summary: &mut ImportSummary,
) -> (
    RequestKind,
    Vec<KeyValueEntry>,
    Vec<KeyValueEntry>,
    Option<BodyData>,
    Option<AuthData>,
) {
    let (url, params) = map_url(req.url);
    let kind = RequestKind::Rest {
        method: req.method,
        url,
    };
    let headers = req.header.into_iter().map(map_key_value).collect();
    let body = req.body.map(|b| map_body(name, b, summary));
    let auth = map_auth(name, req.auth, summary);
    (kind, params, headers, body, auth)
}

fn map_url(url: Option<PostmanUrl>) -> (String, Vec<KeyValueEntry>) {
    match url {
        Some(PostmanUrl::Raw(raw)) => (raw, vec![]),
        Some(PostmanUrl::Detailed { raw, query }) => {
            let params = query
                .into_iter()
                .map(|q| KeyValueEntry {
                    id: uuid::Uuid::new_v4().to_string(),
                    key: q.key,
                    value: q.value,
                    description: None,
                    enabled: !q.disabled,
                    entry_type: None,
                })
                .collect();
            (raw, params)
        }
        None => (String::new(), vec![]),
    }
}

fn map_key_value(kv: PostmanKeyValue) -> KeyValueEntry {
    KeyValueEntry {
        id: uuid::Uuid::new_v4().to_string(),
        key: kv.key,
        value: kv.value,
        description: None,
        enabled: !kv.disabled,
        entry_type: None,
    }
}

fn map_body(name: &str, body: PostmanBody, summary: &mut ImportSummary) -> BodyData {
    match body.mode.as_str() {
        "urlencoded" => BodyData {
            mode: "form-urlencoded".into(),
            json: String::new(),
            form: body.urlencoded.into_iter().map(map_key_value).collect(),
        },
        "formdata" => BodyData {
            mode: "form-multipart".into(),
            json: String::new(),
            form: body.formdata.into_iter().map(map_key_value).collect(),
        },
        "raw" => BodyData {
            mode: "raw".into(),
            json: body.raw.unwrap_or_default(),
            form: vec![],
        },
        "graphql" => {
            let gql = body.graphql.unwrap_or(PostmanGraphql {
                query: String::new(),
                variables: String::new(),
            });
            let text = if gql.variables.trim().is_empty() {
                gql.query
            } else {
                format!("{}\n\n# variables:\n# {}", gql.query, gql.variables)
            };
            BodyData {
                mode: "raw".into(),
                json: text,
                form: vec![],
            }
        }
        "file" => {
            summary.skipped.push(format!(
                "Request \"{name}\": file body not supported, body left empty"
            ));
            BodyData {
                mode: "raw".into(),
                json: String::new(),
                form: vec![],
            }
        }
        other => {
            summary.skipped.push(format!(
                "Request \"{name}\": unsupported body mode \"{other}\", body left empty"
            ));
            BodyData {
                mode: "raw".into(),
                json: String::new(),
                form: vec![],
            }
        }
    }
}

fn map_auth(
    name: &str,
    auth: Option<PostmanAuth>,
    summary: &mut ImportSummary,
) -> Option<AuthData> {
    let auth = auth?;
    let find = |params: &[super::parse::PostmanAuthParam], key: &str| {
        params
            .iter()
            .find(|p| p.key == key)
            .map(|p| p.value.clone())
            .unwrap_or_default()
    };
    match auth.kind.as_str() {
        "basic" => Some(AuthData::Basic {
            username: find(&auth.basic, "username"),
            password: find(&auth.basic, "password"),
        }),
        "bearer" => Some(AuthData::Bearer {
            token: find(&auth.bearer, "token"),
        }),
        "apikey" => {
            let add_to = find(&auth.apikey, "in");
            Some(AuthData::Apikey {
                key: find(&auth.apikey, "key"),
                value: find(&auth.apikey, "value"),
                add_to: if add_to == "query" {
                    "query".into()
                } else {
                    "header".into()
                },
            })
        }
        "noauth" => None,
        other => {
            summary.skipped.push(format!(
                "Request \"{name}\": {other} auth not supported, imported without auth"
            ));
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::postman::parse::parse_collection;

    const SAMPLE: &str = include_str!("testdata/sample_collection.json");

    fn mapped() -> (Vec<CollectionNode>, Vec<RequestFile>, ImportSummary) {
        let pc = parse_collection(SAMPLE).unwrap();
        let (_, nodes, requests, summary) = map_collection(pc);
        (nodes, requests, summary)
    }

    fn find<'a>(requests: &'a [RequestFile], name: &str) -> &'a RequestFile {
        requests
            .iter()
            .find(|r| r.name == name)
            .unwrap_or_else(|| panic!("request {name} not found"))
    }

    #[test]
    fn maps_collection_name_and_counts() {
        let pc = parse_collection(SAMPLE).unwrap();
        let (name, nodes, requests, _summary) = map_collection(pc);
        assert_eq!(name, "Sample API");
        assert_eq!(nodes.len(), 2); // Auth, Bodies
        assert_eq!(requests.len(), 10);
    }

    #[test]
    fn maps_nested_folder_recursively() {
        let (nodes, _, _) = mapped();
        let CollectionNode::Folder { name, children, .. } = &nodes[0] else {
            panic!("expected folder")
        };
        assert_eq!(name, "Auth");
        let nested = children
            .iter()
            .find_map(|c| match c {
                CollectionNode::Folder { name, children, .. } if name == "Nested" => Some(children),
                _ => None,
            })
            .expect("Nested folder not found");
        assert_eq!(nested.len(), 1);
    }

    #[test]
    fn maps_basic_auth_and_disabled_header() {
        let (_, requests, _) = mapped();
        let req = find(&requests, "Basic Auth Request");
        match &req.auth {
            Some(AuthData::Basic { username, password }) => {
                assert_eq!(username, "alice");
                assert_eq!(password, "secret");
            }
            other => panic!("expected Basic auth, got {other:?}"),
        }
        assert_eq!(req.headers.len(), 2);
        let off = req.headers.iter().find(|h| h.key == "X-Off").unwrap();
        assert!(!off.enabled);
    }

    #[test]
    fn maps_bearer_auth() {
        let (_, requests, _) = mapped();
        let req = find(&requests, "Bearer Request");
        match &req.auth {
            Some(AuthData::Bearer { token }) => assert_eq!(token, "tok123"),
            other => panic!("expected Bearer auth, got {other:?}"),
        }
    }

    #[test]
    fn maps_apikey_auth() {
        let (_, requests, _) = mapped();
        let req = find(&requests, "ApiKey Request");
        match &req.auth {
            Some(AuthData::Apikey { key, value, add_to }) => {
                assert_eq!(key, "X-Api-Key");
                assert_eq!(value, "abc");
                assert_eq!(add_to, "header");
            }
            other => panic!("expected Apikey auth, got {other:?}"),
        }
    }

    #[test]
    fn oauth2_auth_is_unsupported_and_reported() {
        let (_, requests, summary) = mapped();
        let req = find(&requests, "OAuth2 Request");
        assert!(req.auth.is_none());
        assert!(summary
            .skipped
            .iter()
            .any(|s| s.contains("OAuth2 Request") && s.contains("oauth2")));
    }

    #[test]
    fn maps_raw_body() {
        let (_, requests, _) = mapped();
        let body = find(&requests, "Raw JSON Body").body.clone().unwrap();
        assert_eq!(body.mode, "raw");
        assert_eq!(body.json, "{\"a\":1}");
    }

    #[test]
    fn maps_urlencoded_body() {
        let (_, requests, _) = mapped();
        let body = find(&requests, "Urlencoded Body").body.clone().unwrap();
        assert_eq!(body.mode, "form-urlencoded");
        assert_eq!(body.form.len(), 1);
        assert_eq!(body.form[0].key, "a");
    }

    #[test]
    fn maps_formdata_body() {
        let (_, requests, _) = mapped();
        let body = find(&requests, "Formdata Body").body.clone().unwrap();
        assert_eq!(body.mode, "form-multipart");
        assert_eq!(body.form.len(), 1);
        assert_eq!(body.form[0].key, "file");
    }

    #[test]
    fn maps_graphql_body_into_raw_mode() {
        let (_, requests, _) = mapped();
        let body = find(&requests, "GraphQL Body").body.clone().unwrap();
        assert_eq!(body.mode, "raw");
        assert!(body.json.contains("{ hello }"));
        assert!(body.json.contains("{}")); // variables appended
    }

    #[test]
    fn file_body_is_unsupported_and_reported() {
        let (_, requests, summary) = mapped();
        let body = find(&requests, "File Body").body.clone().unwrap();
        assert_eq!(body.mode, "raw");
        assert_eq!(body.json, "");
        assert!(summary.skipped.iter().any(|s| s.contains("File Body")));
    }
}
