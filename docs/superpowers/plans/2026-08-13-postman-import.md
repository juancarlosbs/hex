# Postman Collection Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user import a Postman Collection v2.1 JSON export (plus an optional Postman Environment export) into a Hex collection, via a preview-then-confirm flow that mirrors the existing WSDL import.

**Architecture:** New pure `src-tauri/src/postman/` module (`parse.rs` deserializes the Postman JSON, `map.rs`/`map_environment.rs` transform it into Hex's existing domain types). Two new thin commands (`import_postman_collection`, `confirm_postman_import`) mirror WSDL's F2 preview/confirm pair. A new frontend modal reads a local file via the Tauri `dialog`+`fs` plugins (net-new to this repo) and drives a new `postmanImportStore`. A new `raw` body mode is added to the existing body-editing domain to represent Postman's non-JSON raw/GraphQL bodies.

**Tech Stack:** Rust (serde/serde_json, already a dependency), Tauri v2 `dialog`/`fs` plugins (net new), React 19 + zustand + TS.

**Spec:** `docs/superpowers/specs/2026-08-13-postman-import-design.md`

## Global Constraints

- Only Postman Collection **v2.1** and the matching Environment export format are supported — no v1/v2.0.
- Import is **file-based only** (local file picker), no fetch-by-URL.
- Only `basic`/`bearer`/`apikey` auth map to `AuthData`; everything else (OAuth2, AWS Sig, Digest, scripts, `noauth`) maps to no auth and is reported in `ImportSummary.skipped`.
- Body modes: `urlencoded`→`form-urlencoded`, `formdata`→`form-multipart`, `raw`/`graphql`→new `raw` mode, `file`→unsupported (empty `raw` body, reported).
- Folder nesting is 1:1, no depth limit.
- No new abstraction for future import formats (OpenAPI/cURL) — Postman-specific code only.
- `src/bindings.ts` is generated — never hand-edit it; regenerate with `cargo test export_bindings` (run inside `src-tauri/`) after any command signature change.
- Rust: `cargo fmt` + `cargo clippy` clean before each commit. TS: no `any`, tokens only from `src/App.css`, CVA + `cn()` for variants.

---

## Task 1: Add Tauri `dialog` + `fs` plugins

This repo has never needed a local file picker before — `@tauri-apps/plugin-dialog` and `@tauri-apps/plugin-fs` (and their Rust counterparts) don't exist here yet. This task only wires the plugins in; no Postman logic yet.

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs:58-60`
- Modify: `src-tauri/capabilities/default.json`
- Modify: `package.json:18-20`

**Interfaces:**
- Produces: the `dialog::open()` (JS) and `readTextFile()` (JS) APIs available for Task 7 to import and call.

- [ ] **Step 1: Add the Rust plugin dependencies**

In `src-tauri/Cargo.toml`, in the `[dependencies]` block, right after the existing `tauri-plugin-store = "2"` line, add:

```toml
tauri-plugin-dialog = "2"
tauri-plugin-fs = "2"
```

- [ ] **Step 2: Register the plugins**

In `src-tauri/src/lib.rs`, the `run()` function currently reads:

```rust
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .invoke_handler(builder.invoke_handler())
```

Change it to:

```rust
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(builder.invoke_handler())
```

- [ ] **Step 3: Grant capabilities**

In `src-tauri/capabilities/default.json`, the `permissions` array currently ends with `"store:default"`. Add the dialog and fs permissions after it:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Capability for the main window",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "opener:default",
    "store:default",
    "dialog:default",
    "fs:default",
    "fs:allow-read-text-file"
  ]
}
```

- [ ] **Step 4: Add the JS plugin packages**

In `package.json`, in `dependencies`, add these two lines (kept alphabetically, right after `"@tauri-apps/api": "^2",`):

```json
    "@tauri-apps/plugin-dialog": "^2",
    "@tauri-apps/plugin-fs": "^2",
```

Then install:

```bash
pnpm install
```

- [ ] **Step 5: Verify it builds**

Run:

```bash
cd src-tauri && cargo check
```

Expected: compiles with no errors (new deps resolve).

```bash
pnpm install
```

Expected: lockfile updates, no errors.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/lib.rs src-tauri/capabilities/default.json package.json pnpm-lock.yaml
git commit -m "chore: add Tauri dialog and fs plugins for local file import"
```

---

## Task 2: Postman collection JSON parsing

**Files:**
- Create: `src-tauri/src/postman/mod.rs`
- Create: `src-tauri/src/postman/parse.rs`
- Create: `src-tauri/src/postman/testdata/sample_collection.json`
- Create: `src-tauri/src/postman/testdata/sample_environment.json`
- Modify: `src-tauri/src/lib.rs:1-5`

**Interfaces:**
- Produces: `postman::parse::{PostmanCollection, PostmanInfo, PostmanItem, PostmanRequest, PostmanUrl, PostmanQueryParam, PostmanKeyValue, PostmanBody, PostmanGraphql, PostmanAuth, PostmanAuthParam, PostmanEnvironment, PostmanEnvValue}`, `parse_collection(json: &str) -> Result<PostmanCollection, String>`, `parse_environment(json: &str) -> Result<PostmanEnvironment, String>`.

- [ ] **Step 1: Register the module**

In `src-tauri/src/lib.rs`, change:

```rust
mod commands;
mod domain;
mod engine;
mod persistence;
mod wsdl;
```

to:

```rust
mod commands;
mod domain;
mod engine;
mod persistence;
mod postman;
mod wsdl;
```

- [ ] **Step 2: Write the test fixtures**

Create `src-tauri/src/postman/testdata/sample_collection.json`:

```json
{
  "info": {
    "name": "Sample API",
    "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
  },
  "item": [
    {
      "name": "Auth",
      "item": [
        {
          "name": "Basic Auth Request",
          "request": {
            "method": "GET",
            "url": { "raw": "https://api.example.com/basic", "query": [] },
            "header": [
              { "key": "X-Test", "value": "1", "disabled": false },
              { "key": "X-Off", "value": "2", "disabled": true }
            ],
            "auth": {
              "type": "basic",
              "basic": [
                { "key": "username", "value": "alice" },
                { "key": "password", "value": "secret" }
              ]
            }
          }
        },
        {
          "name": "Bearer Request",
          "request": {
            "method": "GET",
            "url": { "raw": "https://api.example.com/bearer" },
            "auth": {
              "type": "bearer",
              "bearer": [{ "key": "token", "value": "tok123" }]
            }
          }
        },
        {
          "name": "ApiKey Request",
          "request": {
            "method": "GET",
            "url": { "raw": "https://api.example.com/apikey" },
            "auth": {
              "type": "apikey",
              "apikey": [
                { "key": "key", "value": "X-Api-Key" },
                { "key": "value", "value": "abc" },
                { "key": "in", "value": "header" }
              ]
            }
          }
        },
        {
          "name": "OAuth2 Request",
          "request": {
            "method": "GET",
            "url": { "raw": "https://api.example.com/oauth2" },
            "auth": { "type": "oauth2" }
          }
        },
        {
          "name": "Nested",
          "item": [
            {
              "name": "Deep Request",
              "request": {
                "method": "GET",
                "url": { "raw": "https://api.example.com/deep" }
              }
            }
          ]
        }
      ]
    },
    {
      "name": "Bodies",
      "item": [
        {
          "name": "Raw JSON Body",
          "request": {
            "method": "POST",
            "url": { "raw": "https://api.example.com/raw" },
            "body": {
              "mode": "raw",
              "raw": "{\"a\":1}",
              "options": { "raw": { "language": "json" } }
            }
          }
        },
        {
          "name": "Urlencoded Body",
          "request": {
            "method": "POST",
            "url": { "raw": "https://api.example.com/form" },
            "body": {
              "mode": "urlencoded",
              "urlencoded": [{ "key": "a", "value": "1", "disabled": false }]
            }
          }
        },
        {
          "name": "Formdata Body",
          "request": {
            "method": "POST",
            "url": { "raw": "https://api.example.com/multipart" },
            "body": {
              "mode": "formdata",
              "formdata": [{ "key": "file", "value": "x", "disabled": false }]
            }
          }
        },
        {
          "name": "GraphQL Body",
          "request": {
            "method": "POST",
            "url": { "raw": "https://api.example.com/graphql" },
            "body": {
              "mode": "graphql",
              "graphql": { "query": "{ hello }", "variables": "{}" }
            }
          }
        },
        {
          "name": "File Body",
          "request": {
            "method": "POST",
            "url": { "raw": "https://api.example.com/file" },
            "body": { "mode": "file" }
          }
        }
      ]
    }
  ]
}
```

Create `src-tauri/src/postman/testdata/sample_environment.json`:

```json
{
  "name": "Sample Env",
  "values": [
    { "key": "base_url", "value": "https://api.example.com", "enabled": true },
    { "key": "disabled_var", "value": "nope", "enabled": false }
  ]
}
```

- [ ] **Step 3: Write the failing tests**

Create `src-tauri/src/postman/parse.rs` with just the test module first:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = include_str!("testdata/sample_collection.json");
    const SAMPLE_ENV: &str = include_str!("testdata/sample_environment.json");

    #[test]
    fn parses_sample_collection() {
        let pc = parse_collection(SAMPLE).unwrap();
        assert_eq!(pc.info.name, "Sample API");
        assert_eq!(pc.item.len(), 2);
        assert_eq!(pc.item[0].name, "Auth");
        assert!(pc.item[0].item.is_some());
        assert!(pc.item[0].request.is_none());
    }

    #[test]
    fn parses_sample_environment() {
        let pe = parse_environment(SAMPLE_ENV).unwrap();
        assert_eq!(pe.name, "Sample Env");
        assert_eq!(pe.values.len(), 2);
    }

    #[test]
    fn rejects_invalid_json() {
        let err = parse_collection("not json").unwrap_err();
        assert!(err.contains("invalid Postman collection"));
    }
}
```

- [ ] **Step 2: Run it to confirm it fails to compile**

Run: `cd src-tauri && cargo test -p hex postman::parse`
Expected: FAIL to compile — `parse_collection`, `PostmanCollection`, etc. don't exist yet.

- [ ] **Step 3: Implement the structs and parse functions**

Add above the test module in `src-tauri/src/postman/parse.rs`:

```rust
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct PostmanCollection {
    pub info: PostmanInfo,
    pub item: Vec<PostmanItem>,
}

#[derive(Debug, Deserialize)]
pub struct PostmanInfo {
    pub name: String,
}

#[derive(Debug, Deserialize)]
pub struct PostmanItem {
    pub name: String,
    #[serde(default)]
    pub item: Option<Vec<PostmanItem>>,
    #[serde(default)]
    pub request: Option<PostmanRequest>,
}

#[derive(Debug, Deserialize)]
pub struct PostmanRequest {
    pub method: String,
    #[serde(default)]
    pub url: Option<PostmanUrl>,
    #[serde(default)]
    pub header: Vec<PostmanKeyValue>,
    #[serde(default)]
    pub body: Option<PostmanBody>,
    #[serde(default)]
    pub auth: Option<PostmanAuth>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub enum PostmanUrl {
    Detailed {
        raw: String,
        #[serde(default)]
        query: Vec<PostmanQueryParam>,
    },
    Raw(String),
}

#[derive(Debug, Deserialize)]
pub struct PostmanQueryParam {
    pub key: String,
    #[serde(default)]
    pub value: String,
    #[serde(default)]
    pub disabled: bool,
}

#[derive(Debug, Deserialize)]
pub struct PostmanKeyValue {
    pub key: String,
    #[serde(default)]
    pub value: String,
    #[serde(default)]
    pub disabled: bool,
}

#[derive(Debug, Deserialize)]
pub struct PostmanBody {
    pub mode: String,
    #[serde(default)]
    pub raw: Option<String>,
    #[serde(default)]
    pub urlencoded: Vec<PostmanKeyValue>,
    #[serde(default)]
    pub formdata: Vec<PostmanKeyValue>,
    #[serde(default)]
    pub graphql: Option<PostmanGraphql>,
}

#[derive(Debug, Deserialize)]
pub struct PostmanGraphql {
    #[serde(default)]
    pub query: String,
    #[serde(default)]
    pub variables: String,
}

#[derive(Debug, Deserialize)]
pub struct PostmanAuth {
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub basic: Vec<PostmanAuthParam>,
    #[serde(default)]
    pub bearer: Vec<PostmanAuthParam>,
    #[serde(default)]
    pub apikey: Vec<PostmanAuthParam>,
}

#[derive(Debug, Deserialize)]
pub struct PostmanAuthParam {
    pub key: String,
    #[serde(default)]
    pub value: String,
}

#[derive(Debug, Deserialize)]
pub struct PostmanEnvironment {
    pub name: String,
    #[serde(default)]
    pub values: Vec<PostmanEnvValue>,
}

#[derive(Debug, Deserialize)]
pub struct PostmanEnvValue {
    pub key: String,
    #[serde(default)]
    pub value: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

fn default_true() -> bool {
    true
}

pub fn parse_collection(json: &str) -> Result<PostmanCollection, String> {
    serde_json::from_str(json).map_err(|e| format!("invalid Postman collection: {e}"))
}

pub fn parse_environment(json: &str) -> Result<PostmanEnvironment, String> {
    serde_json::from_str(json).map_err(|e| format!("invalid Postman environment: {e}"))
}
```

Add `pub mod parse;` to `src-tauri/src/postman/mod.rs`:

```rust
pub mod parse;
```

- [ ] **Step 4: Run tests to confirm they pass**

Run: `cd src-tauri && cargo test -p hex postman::parse`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/postman/mod.rs src-tauri/src/postman/parse.rs src-tauri/src/postman/testdata src-tauri/src/lib.rs
git commit -m "feat: parse Postman collection and environment JSON"
```

---

## Task 3: Map parsed Postman collection into Hex domain types

**Files:**
- Create: `src-tauri/src/postman/map.rs`
- Modify: `src-tauri/src/postman/mod.rs`

**Interfaces:**
- Consumes: `postman::parse::{PostmanCollection, PostmanItem, PostmanRequest, PostmanUrl, PostmanKeyValue, PostmanBody, PostmanAuth}` (Task 2). `persistence::collection::{CollectionNode, RequestNode, RequestFile, RequestKind, KeyValueEntry, BodyData, AuthData}` (existing).
- Produces: `postman::map::{ImportSummary, map_collection}`, where `map_collection(pc: PostmanCollection) -> (String, Vec<CollectionNode>, Vec<RequestFile>, ImportSummary)` and `ImportSummary { pub skipped: Vec<String> }` (derives `Debug, Clone, Default, Serialize, Deserialize, specta::Type` — used directly as a wire type in Task 5).

- [ ] **Step 1: Write the failing tests**

Create `src-tauri/src/postman/map.rs` with the implementation stubbed as `todo!()` plus tests:

```rust
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
    _pc: PostmanCollection,
) -> (String, Vec<CollectionNode>, Vec<RequestFile>, ImportSummary) {
    todo!()
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
                CollectionNode::Folder { name, children, .. } if name == "Nested" => {
                    Some(children)
                }
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
```

- [ ] **Step 2: Run to confirm it fails**

Run: `cd src-tauri && cargo test -p hex postman::map`
Expected: FAIL (`todo!()` panics).

- [ ] **Step 3: Implement `map_collection`**

Replace the `todo!()` stub with:

```rust
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

fn map_auth(name: &str, auth: Option<PostmanAuth>, summary: &mut ImportSummary) -> Option<AuthData> {
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
```

Add `pub mod map;` to `src-tauri/src/postman/mod.rs`:

```rust
pub mod map;
pub mod parse;
```

- [ ] **Step 4: Run tests to confirm they pass**

Run: `cd src-tauri && cargo test -p hex postman::map`
Expected: 10 passed.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/postman/map.rs src-tauri/src/postman/mod.rs
git commit -m "feat: map Postman collection into Hex collection/request domain types"
```

---

## Task 4: Map Postman environment into a Hex `Environment`

**Files:**
- Create: `src-tauri/src/postman/map_environment.rs`
- Modify: `src-tauri/src/postman/mod.rs`

**Interfaces:**
- Consumes: `postman::parse::PostmanEnvironment` (Task 2). `domain::env::Environment` (existing: `{ id: String, name: String, variables: BTreeMap<String, String> }`).
- Produces: `postman::map_environment::map_environment(pe: PostmanEnvironment) -> Environment`.

- [ ] **Step 1: Write the failing test**

Create `src-tauri/src/postman/map_environment.rs`:

```rust
use super::parse::PostmanEnvironment;
use crate::domain::env::Environment;
use std::collections::BTreeMap;

pub fn map_environment(_pe: PostmanEnvironment) -> Environment {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::postman::parse::parse_environment;

    const SAMPLE_ENV: &str = include_str!("testdata/sample_environment.json");

    #[test]
    fn drops_disabled_variables() {
        let pe = parse_environment(SAMPLE_ENV).unwrap();
        let env = map_environment(pe);
        assert_eq!(env.name, "Sample Env");
        assert_eq!(env.variables.len(), 1);
        assert_eq!(
            env.variables.get("base_url"),
            Some(&"https://api.example.com".to_string())
        );
        assert!(!env.variables.contains_key("disabled_var"));
        assert!(!env.id.is_empty());
    }
}
```

- [ ] **Step 2: Run to confirm it fails**

Run: `cd src-tauri && cargo test -p hex postman::map_environment`
Expected: FAIL (`todo!()` panics).

- [ ] **Step 3: Implement it**

```rust
pub fn map_environment(pe: PostmanEnvironment) -> Environment {
    let variables: BTreeMap<String, String> = pe
        .values
        .into_iter()
        .filter(|v| v.enabled)
        .map(|v| (v.key, v.value))
        .collect();
    Environment {
        id: uuid::Uuid::new_v4().to_string(),
        name: pe.name,
        variables,
    }
}
```

Add `pub mod map_environment;` to `src-tauri/src/postman/mod.rs`:

```rust
pub mod map;
pub mod map_environment;
pub mod parse;
```

- [ ] **Step 4: Run tests to confirm they pass**

Run: `cd src-tauri && cargo test -p hex postman::map_environment`
Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/postman/map_environment.rs src-tauri/src/postman/mod.rs
git commit -m "feat: map Postman environment export into a Hex Environment"
```

---

## Task 5: `import_postman_collection` / `confirm_postman_import` commands

**Files:**
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs:8-36`

**Interfaces:**
- Consumes: `postman::parse::{parse_collection, parse_environment}` (Task 2), `postman::map::{map_collection, ImportSummary}` (Task 3), `postman::map_environment::map_environment` (Task 4), `collection::{create_collection, create_folder, create_request, update_request, RequestFile, RequestContent, RequestNode}` (existing), `env_store::save_environment` (existing, already in scope in this file from the environment commands section).
- Produces: `PostmanImportPreview { collection_name: String, nodes: Vec<CollectionNode>, requests: Vec<collection::RequestFile>, environment: Option<Environment>, summary: postman::map::ImportSummary }`, commands `import_postman_collection(collection_json: String, environment_json: Option<String>) -> Result<PostmanImportPreview, String>` and `confirm_postman_import(app, workspace_id: String, preview: PostmanImportPreview) -> Result<(), String>`.

- [ ] **Step 1: Add the commands, preview struct, and recursive disk writer**

Append to the end of `src-tauri/src/commands/mod.rs`:

```rust
// ── Postman import (mirrors WSDL's F2 preview/confirm pattern) ────────────

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PostmanImportPreview {
    pub collection_name: String,
    pub nodes: Vec<CollectionNode>,
    pub requests: Vec<collection::RequestFile>,
    pub environment: Option<Environment>,
    pub summary: crate::postman::map::ImportSummary,
}

#[tauri::command]
#[specta::specta]
pub fn import_postman_collection(
    collection_json: String,
    environment_json: Option<String>,
) -> Result<PostmanImportPreview, String> {
    let pc = crate::postman::parse::parse_collection(&collection_json)?;
    let (collection_name, nodes, requests, summary) = crate::postman::map::map_collection(pc);
    let environment = match environment_json {
        Some(json) => {
            let pe = crate::postman::parse::parse_environment(&json)?;
            Some(crate::postman::map_environment::map_environment(pe))
        }
        None => None,
    };
    Ok(PostmanImportPreview {
        collection_name,
        nodes,
        requests,
        environment,
        summary,
    })
}

#[tauri::command]
#[specta::specta]
pub fn confirm_postman_import(
    app: tauri::AppHandle,
    workspace_id: String,
    preview: PostmanImportPreview,
) -> Result<(), String> {
    let dir = data_dir(&app)?;
    write_postman_import(&dir, &workspace_id, &preview)
}

fn write_postman_import(
    dir: &std::path::Path,
    workspace_id: &str,
    preview: &PostmanImportPreview,
) -> Result<(), String> {
    let col = collection::create_collection(dir, workspace_id, &preview.collection_name)
        .map_err(|e| e.to_string())?;
    let CollectionNode::Folder { id: root_id, .. } = &col else {
        return Err("created collection is not a folder".into());
    };
    write_postman_nodes(
        dir,
        workspace_id,
        vec![root_id.clone()],
        &preview.nodes,
        &preview.requests,
    )?;
    if let Some(env) = &preview.environment {
        env_store::save_environment(dir, workspace_id, env).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn write_postman_nodes(
    dir: &std::path::Path,
    workspace_id: &str,
    parent_path: Vec<String>,
    nodes: &[CollectionNode],
    requests: &[collection::RequestFile],
) -> Result<(), String> {
    for node in nodes {
        match node {
            CollectionNode::Folder { name, children, .. } => {
                let created =
                    collection::create_folder(dir, workspace_id, parent_path.clone(), name)
                        .map_err(|e| e.to_string())?;
                let CollectionNode::Folder { id: new_id, .. } = created else {
                    return Err("created folder is not a folder".into());
                };
                let mut child_path = parent_path.clone();
                child_path.push(new_id);
                write_postman_nodes(dir, workspace_id, child_path, children, requests)?;
            }
            CollectionNode::Request(collection::RequestNode { id, name, kind }) => {
                let rf = requests.iter().find(|r| &r.id == id).ok_or_else(|| {
                    format!("import data inconsistency: request \"{name}\" not found")
                })?;
                let created = collection::create_request(
                    dir,
                    workspace_id,
                    parent_path.clone(),
                    name,
                    kind.clone(),
                )
                .map_err(|e| e.to_string())?;
                let CollectionNode::Request(collection::RequestNode { id: new_id, .. }) = created
                else {
                    return Err("created request is not a request".into());
                };
                let mut req_path = parent_path.clone();
                req_path.push(new_id);
                collection::update_request(
                    dir,
                    workspace_id,
                    req_path,
                    collection::RequestContent {
                        kind: kind.clone(),
                        params: rf.params.clone(),
                        headers: rf.headers.clone(),
                        body: rf.body.clone(),
                        auth: rf.auth.clone(),
                    },
                )
                .map_err(|e| e.to_string())?;
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod postman_import_tests {
    use super::*;
    use std::fs;

    fn tmp(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("hex-postman-cmd-test-{name}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    const SAMPLE: &str = include_str!("../postman/testdata/sample_collection.json");
    const SAMPLE_ENV: &str = include_str!("../postman/testdata/sample_environment.json");

    fn find_path(
        nodes: &[CollectionNode],
        target: &str,
        path: &mut Vec<String>,
    ) -> Option<Vec<String>> {
        for node in nodes {
            match node {
                CollectionNode::Folder { id, name, children } => {
                    path.push(id.clone());
                    if name == target {
                        return Some(path.clone());
                    }
                    if let Some(found) = find_path(children, target, path) {
                        return Some(found);
                    }
                    path.pop();
                }
                CollectionNode::Request(collection::RequestNode { id, name, .. }) => {
                    if name == target {
                        path.push(id.clone());
                        return Some(path.clone());
                    }
                }
            }
        }
        None
    }

    #[test]
    fn confirm_writes_nested_folders_and_requests_to_disk() {
        let dir = tmp("confirm");
        let pc = crate::postman::parse::parse_collection(SAMPLE).unwrap();
        let (collection_name, nodes, requests, summary) = crate::postman::map::map_collection(pc);
        let preview = PostmanImportPreview {
            collection_name,
            nodes,
            requests,
            environment: None,
            summary,
        };
        write_postman_import(&dir, "ws1", &preview).unwrap();

        let cols = collection::list_collections(&dir, "ws1").unwrap();
        assert_eq!(cols.len(), 1);

        let path =
            find_path(&cols, "Basic Auth Request", &mut vec![]).expect("request not found on disk");
        let rf = collection::get_request(&dir, "ws1", path).unwrap();
        match rf.auth {
            Some(collection::AuthData::Basic { username, password }) => {
                assert_eq!(username, "alice");
                assert_eq!(password, "secret");
            }
            other => panic!("expected Basic auth, got {other:?}"),
        }

        let deep_path =
            find_path(&cols, "Deep Request", &mut vec![]).expect("nested request not found");
        assert_eq!(deep_path.len(), 4); // collection root > Auth > Nested > Deep Request
    }

    #[test]
    fn confirm_writes_environment_when_present() {
        let dir = tmp("env");
        let pe = crate::postman::parse::parse_environment(SAMPLE_ENV).unwrap();
        let environment = crate::postman::map_environment::map_environment(pe);
        let preview = PostmanImportPreview {
            collection_name: "Empty".into(),
            nodes: vec![],
            requests: vec![],
            environment: Some(environment),
            summary: crate::postman::map::ImportSummary::default(),
        };
        write_postman_import(&dir, "ws1", &preview).unwrap();

        let list = env_store::list_environments(&dir, "ws1").unwrap();
        assert_eq!(list.environments.len(), 1);
        assert_eq!(list.environments[0].name, "Sample Env");
    }
}
```

- [ ] **Step 2: Register the commands**

In `src-tauri/src/lib.rs`, add the two new commands to the `collect_commands!` list, right after `commands::confirm_wsdl_import,`:

```rust
        commands::import_wsdl,
        commands::confirm_wsdl_import,
        commands::import_postman_collection,
        commands::confirm_postman_import,
        commands::get_operation_schema,
```

- [ ] **Step 3: Run tests**

Run: `cd src-tauri && cargo test -p hex commands::postman_import_tests`
Expected: 2 passed.

- [ ] **Step 4: Regenerate bindings**

Run: `cd src-tauri && cargo test export_bindings`
Expected: passes, `src/bindings.ts` is rewritten with `importPostmanCollection`, `confirmPostmanImport`, and the `PostmanImportPreview` type.

- [ ] **Step 5: Full backend test + lint pass**

Run: `cd src-tauri && cargo test -p hex && cargo fmt && cargo clippy`
Expected: all tests pass, clippy clean.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/commands/mod.rs src-tauri/src/lib.rs src/bindings.ts
git commit -m "feat: add import_postman_collection and confirm_postman_import commands"
```

---

## Task 6: `raw` body mode (frontend domain change)

Postman's `raw` and `graphql` bodies map to `BodyData { mode: "raw", .. }` (Task 3). Today the frontend only renders `json` / `form-urlencoded` / `form-multipart` — `raw` would either get silently coerced to `json` on load (`requestStore.ts`) or render a blank pane (`BodyTab.tsx`). This task makes `raw` a first-class mode, reusing the existing JSON text editor with no JSON-specific validation.

**Files:**
- Modify: `src/lib/request-types.ts`
- Modify: `src/components/request/ContentTypeDropdown.tsx`
- Modify: `src/components/request/body/BodyTab.tsx`
- Modify: `src/store/requestStore.ts:452`

**Interfaces:**
- Produces: `BodyMode` now includes `"raw"`; the body editor renders and persists it like any other mode.

- [ ] **Step 1: Extend the `BodyMode` type**

In `src/lib/request-types.ts`, change:

```ts
export type BodyMode = "json" | "form-urlencoded" | "form-multipart";
```

to:

```ts
export type BodyMode = "json" | "form-urlencoded" | "form-multipart" | "raw";
```

- [ ] **Step 2: Add the `raw` option to the content-type dropdown**

In `src/components/request/ContentTypeDropdown.tsx`, change the import:

```tsx
import { Braces, Check, ChevronDown, ChevronUp, Code, Paperclip, LucideIcon } from "lucide-react";
```

to:

```tsx
import { Braces, Check, ChevronDown, ChevronUp, Code, FileText, Paperclip, LucideIcon } from "lucide-react";
```

And change `OPTIONS`:

```tsx
const OPTIONS: ContentTypeOption[] = [
  { mode: "json", icon: Code, label: "application/json" },
  { mode: "form-urlencoded", icon: Braces, label: "application/x-www-form-urlencoded" },
  { mode: "form-multipart", icon: Paperclip, label: "multipart/form-data" },
  { mode: "raw", icon: FileText, label: "raw" },
];
```

- [ ] **Step 3: Fix the form/raw predicate and add the raw render branch**

In `src/components/request/body/BodyTab.tsx`, change:

```tsx
  const isForm = body.mode !== "json";
```

to:

```tsx
  const isForm = body.mode === "form-urlencoded" || body.mode === "form-multipart";
```

(Without this, `raw` mode would incorrectly show the form "+" add-row button instead of the beautify button — `raw` isn't a form.)

Then change:

```tsx
      <div className="flex-1 min-h-0">
        {body.mode === "json" && <BodyJsonEditor value={body.json} onChange={(v) => setBodyJson(requestId, v)} />}
        {body.mode === "form-urlencoded" && <BodyFormEditor requestId={requestId} multipart={false} />}
        {body.mode === "form-multipart" && <BodyFormEditor requestId={requestId} multipart={true} />}
      </div>
```

to:

```tsx
      <div className="flex-1 min-h-0">
        {body.mode === "json" && <BodyJsonEditor value={body.json} onChange={(v) => setBodyJson(requestId, v)} />}
        {body.mode === "raw" && <BodyJsonEditor value={body.json} onChange={(v) => setBodyJson(requestId, v)} />}
        {body.mode === "form-urlencoded" && <BodyFormEditor requestId={requestId} multipart={false} />}
        {body.mode === "form-multipart" && <BodyFormEditor requestId={requestId} multipart={true} />}
      </div>
```

- [ ] **Step 4: Stop coercing `raw` down to `json` on load**

In `src/store/requestStore.ts`, around line 452, change:

```ts
          mode: mode === "form-urlencoded" || mode === "form-multipart" ? mode : "json",
```

to:

```ts
          mode: mode === "form-urlencoded" || mode === "form-multipart" || mode === "raw" ? mode : "json",
```

- [ ] **Step 5: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Manual verification**

Run `pnpm tauri dev`. Open any request, switch its body content-type to "raw", type some non-JSON text (e.g. `<xml>hi</xml>`), save, close and reopen the request. Confirm the text persists exactly and the content-type dropdown still shows "raw" (not silently reset to "application/json").

- [ ] **Step 7: Commit**

```bash
git add src/lib/request-types.ts src/components/request/ContentTypeDropdown.tsx src/components/request/body/BodyTab.tsx src/store/requestStore.ts
git commit -m "feat: add raw body mode for non-JSON/form request bodies"
```

---

## Task 7: Postman import UI

**Files:**
- Modify: `src/lib/api.ts`
- Create: `src/store/postmanImportStore.ts`
- Create: `src/components/ImportPostmanModal.tsx`
- Modify: `src/components/Sidebar.tsx`

**Interfaces:**
- Consumes: `commands.importPostmanCollection`, `commands.confirmPostmanImport`, `PostmanImportPreview` (generated in `src/bindings.ts` by Task 5). `useCollectionStore.getState().load(workspaceId)`, `useEnvStore.getState().load(workspaceId)` (existing stores).
- Produces: `usePostmanImportStore` (phase state machine `idle|loading|preview|error`), `<ImportPostmanModal open onClose />`, a second sidebar icon wired to it.

- [ ] **Step 1: Add the `api.ts` wrappers**

In `src/lib/api.ts`, add `PostmanImportPreview` to the `import type { ... } from "../bindings";` block and to the `export type { ... } from "../bindings";` block (both alphabetically, next to `WsdlImportPreview`):

```ts
import type {
  DefinitionUpdatePreview,
  Environment,
  FormValue,
  PostmanImportPreview,
  QName,
  RequestContent,
  RequestKind,
  SchemaNode,
  SendSpec,
  WsdlImportPreview,
} from "../bindings";
```

```ts
export type {
  Attribute,
  CollectionNode,
  DefinitionDiff,
  DefinitionUpdatePreview,
  Environment,
  EnvironmentList,
  FormValue,
  HttpResponse,
  MaxOccurs,
  NodeKind,
  Occurs,
  PostmanImportPreview,
  RequestContent,
  RequestKind,
  SchemaNode,
  SendSpec,
  WsdlImportPreview,
  XsdType,
} from "../bindings";
```

Then add the wrapper functions right after `confirmWsdlImport`:

```ts
  importWsdl: (url: string) => unwrap(commands.importWsdl(url)),

  confirmWsdlImport: (workspaceId: string, preview: WsdlImportPreview) =>
    unwrap(commands.confirmWsdlImport(workspaceId, preview)),

  importPostmanCollection: (collectionJson: string, environmentJson: string | null) =>
    unwrap(commands.importPostmanCollection(collectionJson, environmentJson)),

  confirmPostmanImport: (workspaceId: string, preview: PostmanImportPreview) =>
    unwrap(commands.confirmPostmanImport(workspaceId, preview)),
```

- [ ] **Step 2: Create the import store**

Create `src/store/postmanImportStore.ts`:

```ts
import { create } from "zustand";
import { api, type PostmanImportPreview } from "../lib/api";
import { useCollectionStore } from "./collectionStore";
import { useEnvStore } from "./envStore";

type Phase =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "preview"; preview: PostmanImportPreview }
  | { state: "error"; message: string };

interface PostmanImportState {
  phase: Phase;
  importCollection: (collectionJson: string, environmentJson: string | null) => Promise<void>;
  confirm: (workspaceId: string) => Promise<void>;
  reset: () => void;
}

export const usePostmanImportStore = create<PostmanImportState>((set, get) => ({
  phase: { state: "idle" },

  async importCollection(collectionJson, environmentJson) {
    set({ phase: { state: "loading" } });
    try {
      const preview = await api.importPostmanCollection(collectionJson, environmentJson);
      set({ phase: { state: "preview", preview } });
    } catch (e) {
      set({ phase: { state: "error", message: String(e) } });
    }
  },

  async confirm(workspaceId) {
    const phase = get().phase;
    if (phase.state !== "preview") return;
    try {
      await api.confirmPostmanImport(workspaceId, phase.preview);
      await useCollectionStore.getState().load(workspaceId);
      if (phase.preview.environment) {
        await useEnvStore.getState().load(workspaceId);
      }
      set({ phase: { state: "idle" } });
    } catch (e) {
      set({ phase: { state: "error", message: String(e) } });
    }
  },

  reset() {
    set({ phase: { state: "idle" } });
  },
}));
```

- [ ] **Step 3: Create the modal**

Create `src/components/ImportPostmanModal.tsx`:

```tsx
import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { FileJson, RefreshCw, X } from "lucide-react";
import { cn } from "../lib/utils";
import { usePostmanImportStore } from "../store/postmanImportStore";
import { useWorkspaceStore } from "../store/workspaceStore";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function ImportPostmanModal({ open: isOpen, onClose }: Props) {
  const [collectionPath, setCollectionPath] = useState<string | null>(null);
  const [environmentPath, setEnvironmentPath] = useState<string | null>(null);
  const phase = usePostmanImportStore((s) => s.phase);
  const importCollection = usePostmanImportStore((s) => s.importCollection);
  const confirm = usePostmanImportStore((s) => s.confirm);
  const reset = usePostmanImportStore((s) => s.reset);
  const workspaceId = useWorkspaceStore((s) => s.activeId);

  if (!isOpen) return null;

  const loading = phase.state === "loading";

  function close() {
    reset();
    setCollectionPath(null);
    setEnvironmentPath(null);
    onClose();
  }

  async function pickCollection() {
    const path = await open({ filters: [{ name: "Postman Collection", extensions: ["json"] }] });
    if (typeof path === "string") setCollectionPath(path);
  }

  async function pickEnvironment() {
    const path = await open({ filters: [{ name: "Postman Environment", extensions: ["json"] }] });
    if (typeof path === "string") setEnvironmentPath(path);
  }

  async function handlePrimary() {
    if (phase.state === "preview") {
      await confirm(workspaceId);
      if (usePostmanImportStore.getState().phase.state !== "error") {
        setCollectionPath(null);
        setEnvironmentPath(null);
        onClose();
      }
      return;
    }
    if (!collectionPath || loading) return;
    const collectionJson = await readTextFile(collectionPath);
    const environmentJson = environmentPath ? await readTextFile(environmentPath) : null;
    importCollection(collectionJson, environmentJson);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onPointerDown={(e) => { if (e.target === e.currentTarget) close(); }}
    >
      <div className="w-[480px] rounded-[6px] bg-card border border-border overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4">
          <span className="text-[15px] font-semibold text-foreground">Import Postman Collection</span>
          <X size={16} className="text-muted cursor-pointer hover:text-foreground" onClick={close} />
        </div>

        <div className="h-px bg-border" />

        <div className="flex flex-col gap-4 px-5 py-5">
          <div className="flex flex-col gap-[6px]">
            <label className="text-[12px] font-semibold text-foreground">Collection file</label>
            <button
              type="button"
              disabled={loading || phase.state === "preview"}
              className="w-full flex items-center justify-between rounded-[4px] bg-secondary border border-border px-3 py-2 text-[13px] text-foreground disabled:opacity-60 cursor-pointer"
              onClick={pickCollection}
            >
              <span className={collectionPath ? "text-foreground" : "text-muted"}>
                {collectionPath ?? "Choose a Postman collection .json…"}
              </span>
            </button>
          </div>

          <div className="flex flex-col gap-[6px]">
            <label className="text-[12px] font-semibold text-foreground">Environment file (optional)</label>
            <button
              type="button"
              disabled={loading || phase.state === "preview"}
              className="w-full flex items-center justify-between rounded-[4px] bg-secondary border border-border px-3 py-2 text-[13px] text-foreground disabled:opacity-60 cursor-pointer"
              onClick={pickEnvironment}
            >
              <span className={environmentPath ? "text-foreground" : "text-muted"}>
                {environmentPath ?? "Choose a Postman environment .json…"}
              </span>
            </button>
          </div>

          {loading && (
            <div className="flex items-center gap-2 text-[13px] text-muted">
              <RefreshCw size={14} className="animate-spin" />
              Parsing collection…
            </div>
          )}

          {phase.state === "error" && (
            <div className="rounded-[4px] border border-border bg-secondary px-3 py-2 text-[12px] text-destructive break-all">
              {phase.message}
            </div>
          )}

          {phase.state === "preview" && (
            <div className="flex flex-col gap-2">
              <span className="text-[12px] font-semibold text-foreground">
                {phase.preview.collectionName}
                <span className="text-muted font-normal">
                  {" "}· {phase.preview.requests.length} requests
                  {phase.preview.environment ? " · environment imported" : ""}
                </span>
              </span>
              {phase.preview.summary.skipped.length > 0 && (
                <div className="max-h-[160px] overflow-y-auto rounded-[4px] border border-border">
                  {phase.preview.summary.skipped.map((line, i) => (
                    <div key={i} className="flex items-center gap-2 px-3 py-[6px] text-[12px] text-muted">
                      <FileJson size={13} className="text-muted shrink-0" />
                      {line}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="h-px bg-border" />

        <div className="flex items-center justify-end gap-[10px] px-5 py-[14px]">
          <button
            className="px-4 py-[7px] rounded-[4px] text-[13px] font-medium text-foreground bg-secondary border border-border hover:bg-secondary/80 cursor-pointer"
            onClick={close}
          >
            Cancel
          </button>
          <button
            className={cn(
              "px-4 py-[7px] rounded-[4px] text-[13px] font-semibold cursor-pointer",
              (phase.state === "preview" || (collectionPath && !loading))
                ? "bg-accent text-accent-foreground hover:bg-accent/90"
                : "bg-accent/40 text-accent-foreground/50 cursor-not-allowed"
            )}
            onClick={handlePrimary}
            disabled={loading || (phase.state !== "preview" && !collectionPath)}
          >
            {phase.state === "preview"
              ? `Import ${phase.preview.requests.length} Requests`
              : "Import"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Wire the sidebar entry point**

In `src/components/Sidebar.tsx`, change the import line:

```tsx
import { FolderPlus, Globe, Plus, RefreshCw, Search } from "lucide-react";
```

to:

```tsx
import { FileJson, FolderPlus, Globe, Plus, RefreshCw, Search } from "lucide-react";
```

Add the modal import, right after `ImportWsdlModal`:

```tsx
import { ImportWsdlModal } from "./ImportWsdlModal";
import { ImportPostmanModal } from "./ImportPostmanModal";
```

Add state, right after `importOpen`:

```tsx
  const [importOpen, setImportOpen] = useState(false);
  const [postmanImportOpen, setPostmanImportOpen] = useState(false);
```

Add the icon, right after the `Globe` icon:

```tsx
          <Globe
            size={14}
            className="text-sidebar-muted cursor-pointer hover:text-foreground"
            aria-label="Import WSDL"
            onClick={() => setImportOpen(true)}
          >
            <title>Import WSDL</title>
          </Globe>
          <FileJson
            size={14}
            className="text-sidebar-muted cursor-pointer hover:text-foreground"
            aria-label="Import Postman Collection"
            onClick={() => setPostmanImportOpen(true)}
          >
            <title>Import Postman Collection</title>
          </FileJson>
```

Mount the modal, right after `ImportWsdlModal`:

```tsx
      <ImportWsdlModal open={importOpen} onClose={() => setImportOpen(false)} />
      <ImportPostmanModal open={postmanImportOpen} onClose={() => setPostmanImportOpen(false)} />
      <UpdateDefinitionModal />
```

- [ ] **Step 5: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Manual verification**

Run `pnpm tauri dev`. Click the new "Import Postman Collection" icon in the sidebar. Pick a real Postman collection export (or `src-tauri/src/postman/testdata/sample_collection.json`) — confirm the preview shows the collection name, request count, and the skipped-items list (OAuth2/file body lines for the sample fixture). Click Import, confirm a new collection appears in the sidebar tree with the right folder nesting, and that "Basic Auth Request" opens with Basic auth pre-filled. Optionally also pick `sample_environment.json` and confirm a new environment appears in the environment selector with `base_url` set (and no `disabled_var`).

- [ ] **Step 7: Commit**

```bash
git add src/lib/api.ts src/store/postmanImportStore.ts src/components/ImportPostmanModal.tsx src/components/Sidebar.tsx
git commit -m "feat: add Postman collection import UI"
```

---

## Post-implementation

- [ ] Update `docs/product.md`: move "Import OpenAPI / Postman / cURL [R]" — narrow it to reflect Postman is now done; OpenAPI/cURL remain 🔵.
