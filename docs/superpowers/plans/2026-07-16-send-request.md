# Send Request (reqwest shortcut) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Send button fire the active request through a Rust HTTP engine and render the real response in the response panel.

**Architecture:** New `engine/` module in Rust (the only place that speaks HTTP) built on reqwest with rustls, exposed through a thin async `send_request` Tauri command. On the frontend, a new zustand `responseStore` keyed by request id holds loading/done/error entries with a send-sequence guard against stale results; `UrlBar` dispatches send/cancel and `ResponsePanel` renders the entry for the active tab.

**Tech Stack:** Rust (reqwest 0.12 + rustls, tokio for tests), Tauri v2 IPC, React 19 + zustand, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-16-send-request-design.md`

## Global Constraints

- **rustls only** — reqwest must use `default-features = false` with `rustls-tls`; never native-tls/OpenSSL, not even transitively via a feature.
- **Commands are thin** — `send_request` only delegates to `engine::send`; no business logic in `commands/`.
- **No `any` in TypeScript.** All invokes go through wrappers in `src/lib/api.ts` — never a bare `invoke` string in a component.
- **UI uses only tokens** from `styles/tokens.css` (e.g. `text-status-5xx`, `bg-card`, `text-muted`); no hardcoded hex.
- **All code, comments, and commits in English.** Commits: Conventional Commits, single line, no body.
- **Rust hygiene:** `cargo fmt` + `cargo clippy` clean before each commit.
- Rust tests run from `src-tauri/`: `cargo test`. Frontend tests: `pnpm test`.
- **TDD exception (approved):** UI wiring tasks (7, 8) have no component tests — the repo has no testing-library/jsdom and adding them is out of scope. All logic lives in stores (tested); UI tasks are verified by `pnpm build` type-check and a manual dev check.

---

### Task 1: Engine skeleton — method, URL, params

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Create: `src-tauri/src/engine/mod.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod engine;`)

**Interfaces:**
- Consumes: `KeyValueEntry`, `BodyData`, `AuthData` from `crate::persistence::collection` (existing serde types that already mirror the TS shapes).
- Produces: `pub struct SendSpec`, `fn build_request(client: &reqwest::Client, spec: &SendSpec) -> Result<reqwest::Request, String>` (crate-visible for tests), used by every later engine task.

- [ ] **Step 1: Add dependencies**

In `src-tauri/Cargo.toml` under `[dependencies]` add:

```toml
reqwest = { version = "0.12", default-features = false, features = ["rustls-tls", "gzip", "json"] }
```

And at the end of the file add:

```toml
[dev-dependencies]
tokio = { version = "1", features = ["rt", "macros"] }
```

- [ ] **Step 2: Write the failing tests**

Create `src-tauri/src/engine/mod.rs`:

```rust
use crate::persistence::collection::{AuthData, BodyData, KeyValueEntry};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

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
            body: BodyData { mode: "json".into(), json: String::new(), form: vec![] },
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run (from `src-tauri/`): `cargo test engine`
Expected: compilation FAILS — `build_request` not found. (A compile failure of the test target is the RED state here.)

Also add `mod engine;` to `src-tauri/src/lib.rs` (below `mod commands;`) so the module compiles as part of the crate:

```rust
mod commands;
mod engine;
mod persistence;
```

- [ ] **Step 4: Write minimal implementation**

In `src-tauri/src/engine/mod.rs`, above the `tests` module:

```rust
fn enabled(list: &[KeyValueEntry]) -> impl Iterator<Item = &KeyValueEntry> {
    list.iter().filter(|kv| kv.enabled && !kv.key.is_empty())
}

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
```

Note: `rb.build()` returns an error for unparseable URLs — that covers `rejects_invalid_url`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cargo test engine`
Expected: 4 passed. Then `cargo fmt && cargo clippy` — clean (allow `dead_code` warnings for `HttpResponse` until Task 4; if clippy flags them, add `#[allow(dead_code)]` temporarily and remove it in Task 4).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/engine/mod.rs src-tauri/src/lib.rs
git commit -m "feat(engine): request builder with method, url and param merging"
```

---

### Task 2: Engine — auth and header application

**Files:**
- Modify: `src-tauri/src/engine/mod.rs`

**Interfaces:**
- Consumes: `build_request`, test helpers `kv`/`spec`/`build` from Task 1.
- Produces: `build_request` now applies `spec.auth` and `spec.headers`; user headers replace (not duplicate) anything set earlier.

- [ ] **Step 1: Write the failing tests**

Add to the `tests` module:

```rust
    #[test]
    fn applies_basic_auth() {
        let mut s = spec("https://api.dev");
        s.auth = AuthData::Basic { username: "ada".into(), password: "pw".into() };
        let req = build(&s).unwrap();
        let v = req.headers().get("authorization").unwrap().to_str().unwrap();
        assert!(v.starts_with("Basic "));
    }

    #[test]
    fn applies_bearer_auth() {
        let mut s = spec("https://api.dev");
        s.auth = AuthData::Bearer { token: "tok123".into() };
        let req = build(&s).unwrap();
        assert_eq!(req.headers().get("authorization").unwrap(), "Bearer tok123");
    }

    #[test]
    fn applies_apikey_in_header() {
        let mut s = spec("https://api.dev");
        s.auth = AuthData::Apikey { key: "X-Api-Key".into(), value: "k1".into(), add_to: "header".into() };
        let req = build(&s).unwrap();
        assert_eq!(req.headers().get("x-api-key").unwrap(), "k1");
    }

    #[test]
    fn applies_apikey_in_query() {
        let mut s = spec("https://api.dev/x");
        s.auth = AuthData::Apikey { key: "api_key".into(), value: "k1".into(), add_to: "query".into() };
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
        s.auth = AuthData::Bearer { token: "tok".into() };
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test engine`
Expected: the 7 new tests FAIL (auth/headers never applied — assertions on missing headers).

- [ ] **Step 3: Write minimal implementation**

In `build_request`, after the params block and before `rb.build()`, add the auth application:

```rust
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
```

Then replace the final `rb.build().map_err(|e| e.to_string())` with a build-then-insert so user headers **replace** earlier values instead of appending duplicates (reqwest's builder `.header()` appends):

```rust
    let mut req = rb.build().map_err(|e| e.to_string())?;
    for kv in enabled(&spec.headers) {
        let name = reqwest::header::HeaderName::from_bytes(kv.key.as_bytes())
            .map_err(|_| format!("invalid header name: {}", kv.key))?;
        let value = reqwest::header::HeaderValue::from_str(&kv.value)
            .map_err(|_| format!("invalid header value for: {}", kv.key))?;
        req.headers_mut().insert(name, value);
    }
    Ok(req)
```

Note: `.header(key, value)` in the apikey arm can panic-free fail at `build()` for invalid names — acceptable; the user-headers path is the one with the explicit error message.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test engine`
Expected: all engine tests pass. `cargo fmt && cargo clippy` clean.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/engine/mod.rs
git commit -m "feat(engine): apply auth config and user headers to built request"
```

---

### Task 3: Engine — body modes

**Files:**
- Modify: `src-tauri/src/engine/mod.rs`

**Interfaces:**
- Consumes: `build_request` from Tasks 1–2.
- Produces: `build_request` handles `mode: "json" | "form-urlencoded" | "form-multipart"`; multipart returns `Err("multipart body is not supported yet")`.

- [ ] **Step 1: Write the failing tests**

Add to the `tests` module:

```rust
    #[test]
    fn json_body_sets_content_type_when_absent() {
        let mut s = spec("https://api.dev");
        s.method = "POST".into();
        s.body.json = r#"{"a":1}"#.into();
        let req = build(&s).unwrap();
        assert_eq!(req.headers().get("content-type").unwrap(), "application/json");
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
        s.body.form = vec![kv("a", "1", true), kv("b", "x y", true), kv("c", "no", false)];
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test engine`
Expected: the 5 new tests FAIL (no body ever set; multipart not rejected).

- [ ] **Step 3: Write minimal implementation**

In `build_request`, after the auth block and **before** the `rb.build()` line, add:

```rust
    match spec.body.mode.as_str() {
        "json" => {
            if !spec.body.json.is_empty() {
                let has_content_type = enabled(&spec.headers)
                    .any(|kv| kv.key.eq_ignore_ascii_case("content-type"));
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
```

(The user-header insert loop from Task 2 runs after `build()`, so a user Content-Type still replaces the one `.form()`/json set — that's what makes `json_body_respects_user_content_type` pass with a single value.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test engine`
Expected: all engine tests pass. `cargo fmt && cargo clippy` clean.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/engine/mod.rs
git commit -m "feat(engine): json and urlencoded bodies with multipart rejection"
```

---

### Task 4: Engine — `send()` end to end

**Files:**
- Modify: `src-tauri/src/engine/mod.rs`

**Interfaces:**
- Consumes: `build_request`, `HttpResponse` from earlier tasks.
- Produces: `pub async fn send(spec: SendSpec) -> Result<HttpResponse, String>` — the function the command layer calls.

- [ ] **Step 1: Write the failing tests**

Add to the `tests` module:

```rust
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
        assert_eq!(resp.headers.get("content-type").unwrap(), "application/json");
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test engine`
Expected: compilation FAILS — `send` not found.

- [ ] **Step 3: Write minimal implementation**

Add above the `tests` module (and add `use std::time::{Duration, Instant};` to the imports):

```rust
pub async fn send(spec: SendSpec) -> Result<HttpResponse, String> {
    // ponytail: per-send client, no pooling; shared OnceLock client when reuse matters
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;
    let req = build_request(&client, &spec)?;

    let start = Instant::now();
    let resp = client.execute(req).await.map_err(|e| {
        if e.is_timeout() {
            "request timed out after 30s".to_string()
        } else {
            e.to_string()
        }
    })?;

    let status = resp.status();
    let mut headers: HashMap<String, String> = HashMap::new();
    for (name, value) in resp.headers() {
        let v = value.to_str().unwrap_or("<binary>").to_string();
        headers
            .entry(name.to_string())
            .and_modify(|existing| {
                existing.push_str(", ");
                existing.push_str(&v);
            })
            .or_insert(v.clone());
    }

    let body = resp.text().await.map_err(|e| e.to_string())?;
    Ok(HttpResponse {
        status: status.as_u16(),
        status_text: status.canonical_reason().unwrap_or("").to_string(),
        time_ms: start.elapsed().as_millis() as u64,
        size_bytes: body.len() as u64,
        headers,
        body,
    })
}
```

Remove any `#[allow(dead_code)]` left from Task 1.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test engine`
Expected: all engine tests pass (14 total). `cargo fmt && cargo clippy` clean.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/engine/mod.rs
git commit -m "feat(engine): async send with timeout, timing and response mapping"
```

---

### Task 5: `send_request` command + `api.ts` wrapper

**Files:**
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/lib/api.ts`

**Interfaces:**
- Consumes: `engine::send`, `engine::SendSpec`, `engine::HttpResponse`.
- Produces: Tauri command `send_request(spec)`; TS `api.sendRequest(spec: SendSpec): Promise<HttpResponse>` and `interface SendSpec` in `src/lib/api.ts`.

- [ ] **Step 1: Add the command**

In `src-tauri/src/commands/mod.rs`, add at the end:

```rust
#[tauri::command]
pub async fn send_request(spec: crate::engine::SendSpec) -> Result<crate::engine::HttpResponse, String> {
    crate::engine::send(spec).await
}
```

- [ ] **Step 2: Register it**

In `src-tauri/src/lib.rs`, add to `generate_handler!`:

```rust
            commands::update_request,
            commands::send_request,
```

- [ ] **Step 3: Verify Rust compiles and tests still pass**

Run: `cargo test`
Expected: all tests pass, no warnings. `cargo fmt && cargo clippy` clean.

- [ ] **Step 4: Add the TS wrapper**

In `src/lib/api.ts`:

Add to the imports at the top:

```ts
import { HttpResponse } from "./response-types";
```

Add below the `RequestContent` interface:

```ts
export interface SendSpec {
  method: string;
  url: string;
  params: KeyValue[];
  headers: KeyValue[];
  body: RestBody;
  auth: AuthConfig;
}
```

Add to the `api` object:

```ts
  sendRequest: (spec: SendSpec) =>
    invoke<HttpResponse>("send_request", { spec }),
```

- [ ] **Step 5: Verify frontend type-checks**

Run: `pnpm build`
Expected: builds with no TS errors.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/commands/mod.rs src-tauri/src/lib.rs src/lib/api.ts
git commit -m "feat(commands): expose send_request with api.ts wrapper"
```

---

### Task 6: `responseStore`

**Files:**
- Create: `src/store/responseStore.ts`
- Test: `src/store/responseStore.test.ts`

**Interfaces:**
- Consumes: `api.sendRequest` (Task 5), `OpenRequest` from `src/lib/request-types.ts`, `HttpResponse` from `src/lib/response-types.ts`.
- Produces:
  - `type ResponseEntry = { state: "loading" } | { state: "done"; response: HttpResponse } | { state: "error"; error: string }`
  - `useResponseStore` with `responses: Record<string, ResponseEntry>`, `seq: Record<string, number>`, `send(request: OpenRequest): Promise<void>`, `cancel(id: string): void`, `clear(id: string): void`, `clearAll(): void`.

- [ ] **Step 1: Write the failing tests**

Create `src/store/responseStore.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/api", () => ({
  api: { sendRequest: vi.fn() },
}));

import { useResponseStore } from "./responseStore";
import { makeEmptyRequest } from "../lib/request-types";
import { HttpResponse } from "../lib/response-types";
import { api } from "../lib/api";

const RESP: HttpResponse = {
  status: 200,
  statusText: "OK",
  timeMs: 5,
  sizeBytes: 2,
  headers: {},
  body: "{}",
};

const request = () => makeEmptyRequest("r1", "R1", "GET", ["c1", "r1"]);

beforeEach(() => {
  useResponseStore.setState({ responses: {}, seq: {} });
  vi.clearAllMocks();
});

describe("send", () => {
  it("sets loading then done with the response", async () => {
    let resolve!: (r: HttpResponse) => void;
    vi.mocked(api.sendRequest).mockReturnValue(
      new Promise((res) => { resolve = res; })
    );
    const p = useResponseStore.getState().send(request());
    expect(useResponseStore.getState().responses.r1).toEqual({ state: "loading" });
    resolve(RESP);
    await p;
    expect(useResponseStore.getState().responses.r1).toEqual({ state: "done", response: RESP });
  });

  it("builds the spec from the open request", async () => {
    vi.mocked(api.sendRequest).mockResolvedValue(RESP);
    const req = request();
    req.url = "https://api.dev";
    req.method = "POST";
    await useResponseStore.getState().send(req);
    expect(api.sendRequest).toHaveBeenCalledWith({
      method: "POST",
      url: "https://api.dev",
      params: req.params,
      headers: req.headers,
      body: req.body,
      auth: req.auth,
    });
  });

  it("stores the error message on failure", async () => {
    vi.mocked(api.sendRequest).mockRejectedValue("connection refused");
    await useResponseStore.getState().send(request());
    expect(useResponseStore.getState().responses.r1).toEqual({
      state: "error",
      error: "connection refused",
    });
  });

  it("a newer send wins over an older one resolving late", async () => {
    let resolveFirst!: (r: HttpResponse) => void;
    vi.mocked(api.sendRequest)
      .mockReturnValueOnce(new Promise((res) => { resolveFirst = res; }))
      .mockResolvedValueOnce({ ...RESP, status: 201 });
    const first = useResponseStore.getState().send(request());
    await useResponseStore.getState().send(request());
    resolveFirst(RESP);
    await first;
    const entry = useResponseStore.getState().responses.r1;
    expect(entry).toEqual({ state: "done", response: { ...RESP, status: 201 } });
  });
});

describe("cancel", () => {
  it("clears the loading entry and discards the late result", async () => {
    let resolve!: (r: HttpResponse) => void;
    vi.mocked(api.sendRequest).mockReturnValue(
      new Promise((res) => { resolve = res; })
    );
    const p = useResponseStore.getState().send(request());
    useResponseStore.getState().cancel("r1");
    expect(useResponseStore.getState().responses.r1).toBeUndefined();
    resolve(RESP);
    await p;
    expect(useResponseStore.getState().responses.r1).toBeUndefined();
  });
});

describe("clear", () => {
  it("removes the entry and its sequence", async () => {
    vi.mocked(api.sendRequest).mockResolvedValue(RESP);
    await useResponseStore.getState().send(request());
    useResponseStore.getState().clear("r1");
    expect(useResponseStore.getState().responses.r1).toBeUndefined();
    expect(useResponseStore.getState().seq.r1).toBeUndefined();
  });

  it("clearAll empties the store", async () => {
    vi.mocked(api.sendRequest).mockResolvedValue(RESP);
    await useResponseStore.getState().send(request());
    useResponseStore.getState().clearAll();
    expect(useResponseStore.getState().responses).toEqual({});
    expect(useResponseStore.getState().seq).toEqual({});
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/store/responseStore.test.ts`
Expected: FAIL — cannot resolve `./responseStore`.

- [ ] **Step 3: Write minimal implementation**

Create `src/store/responseStore.ts`:

```ts
// src/store/responseStore.ts
import { create } from "zustand";
import { HttpResponse } from "../lib/response-types";
import { OpenRequest } from "../lib/request-types";
import { api } from "../lib/api";

export type ResponseEntry =
  | { state: "loading" }
  | { state: "done"; response: HttpResponse }
  | { state: "error"; error: string };

interface ResponseState {
  responses: Record<string, ResponseEntry>;
  /** per-request send sequence; a result older than the current seq is discarded */
  seq: Record<string, number>;

  send(request: OpenRequest): Promise<void>;
  cancel(id: string): void;
  clear(id: string): void;
  clearAll(): void;
}

export const useResponseStore = create<ResponseState>((set, get) => ({
  responses: {},
  seq: {},

  async send(request) {
    const id = request.id;
    const mySeq = (get().seq[id] ?? 0) + 1;
    set((s) => ({
      seq: { ...s.seq, [id]: mySeq },
      responses: { ...s.responses, [id]: { state: "loading" } },
    }));

    let entry: ResponseEntry;
    try {
      const response = await api.sendRequest({
        method: request.method,
        url: request.url,
        params: request.params,
        headers: request.headers,
        body: request.body,
        auth: request.auth,
      });
      entry = { state: "done", response };
    } catch (e) {
      entry = { state: "error", error: String(e) };
    }

    if (get().seq[id] !== mySeq) return; // cancelled or superseded
    set((s) => ({ responses: { ...s.responses, [id]: entry } }));
  },

  cancel(id) {
    set((s) => {
      const { [id]: _removed, ...responses } = s.responses;
      return { seq: { ...s.seq, [id]: (s.seq[id] ?? 0) + 1 }, responses };
    });
  },

  clear(id) {
    set((s) => {
      const { [id]: _r, ...responses } = s.responses;
      const { [id]: _q, ...seq } = s.seq;
      return { responses, seq };
    });
  },

  clearAll() {
    set({ responses: {}, seq: {} });
  },
}));
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test`
Expected: all tests pass (responseStore + existing requestStore suites), no warnings.

- [ ] **Step 5: Commit**

```bash
git add src/store/responseStore.ts src/store/responseStore.test.ts
git commit -m "feat(response): responseStore with send, cancel and stale-result guard"
```

---

### Task 7: UrlBar — Send/Cancel button

**Files:**
- Modify: `src/components/request/UrlBar.tsx`

**Interfaces:**
- Consumes: `useResponseStore` (`responses`, `send`, `cancel`) from Task 6.
- Produces: working Send button; renders as Cancel while its request is loading.

- [ ] **Step 1: Wire the button**

Replace `src/components/request/UrlBar.tsx` content:

```tsx
// src/components/request/UrlBar.tsx
import { CornerDownLeft, X } from "lucide-react";
import { MethodDropdown } from "./MethodDropdown";
import { useRequestStore } from "../../store/requestStore";
import { useResponseStore } from "../../store/responseStore";

interface UrlBarProps {
  requestId: string;
}

export function UrlBar({ requestId }: UrlBarProps) {
  const req = useRequestStore((s) => s.openRequests[requestId]);
  const setUrl = useRequestStore((s) => s.setUrl);
  const setMethod = useRequestStore((s) => s.setMethod);
  const loading = useResponseStore((s) => s.responses[requestId]?.state === "loading");
  const send = useResponseStore((s) => s.send);
  const cancel = useResponseStore((s) => s.cancel);

  if (!req) return null;

  return (
    <div className="flex items-center gap-2 p-2 bg-card rounded-[8px] border border-border">
      <MethodDropdown method={req.method} onChange={(m) => setMethod(requestId, m)} />

      <input
        value={req.url}
        onChange={(e) => setUrl(requestId, e.target.value)}
        placeholder="https://api.example.com/resource"
        className="flex-1 min-w-0 px-3 py-[9px] text-[13px] bg-background border border-border rounded-[6px] text-foreground placeholder:text-muted outline-none focus:border-ring"
        style={{ fontFamily: "var(--font-mono)" }}
      />

      <button
        type="button"
        onClick={() => (loading ? cancel(requestId) : send(req))}
        className="flex items-center gap-2 px-5 py-[10px] rounded-[6px] bg-primary text-primary-foreground text-[13px] font-semibold cursor-pointer hover:opacity-90"
        style={{ fontFamily: "var(--font-sans)" }}
        title={loading ? "Cancel" : "Send (⌘↵)"}
      >
        {loading ? "Cancel" : "Send"}
        {loading ? <X size={14} /> : <CornerDownLeft size={14} />}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Verify**

Run: `pnpm build`
Expected: no TS errors.
Manual check (`pnpm tauri dev`): open a request, set URL to `https://httpbin.org/get`, click Send — button flips to Cancel while in flight.

- [ ] **Step 3: Commit**

```bash
git add src/components/request/UrlBar.tsx
git commit -m "feat(request): wire Send button to responseStore with cancel while loading"
```

---

### Task 8: ResponsePanel wiring + clear on tab close

**Files:**
- Modify: `src/components/response/ResponsePanel.tsx`
- Modify: `src/store/requestStore.ts`
- Test: `src/store/requestStore.test.ts`
- Modify: `docs/product.md`

**Interfaces:**
- Consumes: `useResponseStore` (`responses`, `clear`, `clearAll`), `useRequestStore.activeId`, existing `ResponsePlaceholder`/`ResponseStatusBar`/`ResponseTabsStrip`/`ResponseFilterBar`/`ResponseBodyView`.
- Produces: response panel driven by real state; closing tabs clears response entries.

- [ ] **Step 1: Write the failing test (clear on close)**

Add to `src/store/requestStore.test.ts` (the existing `vi.mock("../lib/api", ...)` factory must also gain `sendRequest: vi.fn()` inside `api` so responseStore can import it):

```ts
import { useResponseStore } from "./responseStore";

describe("response cleanup", () => {
  it("closing a request clears its response entry", () => {
    useResponseStore.setState({
      responses: { r1: { state: "error", error: "x" } },
      seq: { r1: 1 },
    });
    useRequestStore.getState().closeRequest("r1");
    expect(useResponseStore.getState().responses.r1).toBeUndefined();
  });

  it("closeAll clears all response entries", () => {
    useResponseStore.setState({
      responses: { r1: { state: "error", error: "x" } },
      seq: { r1: 1 },
    });
    useRequestStore.getState().closeAll();
    expect(useResponseStore.getState().responses).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/store/requestStore.test.ts`
Expected: the 2 new tests FAIL (entries survive close).

- [ ] **Step 3: Implement cleanup in requestStore**

In `src/store/requestStore.ts`:

Add import:

```ts
import { useResponseStore } from "./responseStore";
```

In `closeRequest`, after the `set(...)` call:

```ts
    useResponseStore.getState().clear(id);
```

Replace `closeRequestsUnder` entirely — same logic, but `removedIds` is computed before `set` so the entries can be cleared afterwards:

```ts
  closeRequestsUnder(prefix) {
    const isUnder = (path: string[]) =>
      path.length >= prefix.length && prefix.every((v, i) => path[i] === v);
    const removedIds = Object.keys(get().openRequests).filter((id) =>
      isUnder(get().openRequests[id].path)
    );
    if (removedIds.length === 0) return;
    const removed = new Set(removedIds);
    set((s) => {
      const openRequests = Object.fromEntries(
        Object.entries(s.openRequests).filter(([id]) => !removed.has(id))
      );
      const order = s.order.filter((id) => !removed.has(id));
      const activeId = s.activeId && removed.has(s.activeId) ? (order[order.length - 1] ?? null) : s.activeId;
      return { openRequests, order, activeId };
    });
    removedIds.forEach((rid) => useResponseStore.getState().clear(rid));
  },
```

In `closeAll`:

```ts
  closeAll() {
    set({ openRequests: {}, order: [], activeId: null });
    useResponseStore.getState().clearAll();
  },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test`
Expected: all pass.

- [ ] **Step 5: Rewire ResponsePanel**

In `src/components/response/ResponsePanel.tsx`:

Delete the `STATIC_FIXTURE` constant and its `ponytail` comments. Replace the top of the component:

```tsx
import { useState } from "react";
import { Loader2, CircleAlert } from "lucide-react";
import { ResponseBodyView as BodyViewKind, ResponseTab } from "../../lib/response-types";
import { ResponsePlaceholder } from "./ResponsePlaceholder";
import { ResponseStatusBar } from "./ResponseStatusBar";
import { ResponseTabsStrip } from "./ResponseTabsStrip";
import { ResponseFilterBar } from "./ResponseFilterBar";
import { ResponseBodyView as BodyView } from "./body/ResponseBodyView";
import { useRequestStore } from "../../store/requestStore";
import { useResponseStore } from "../../store/responseStore";

export function ResponsePanel() {
  const activeId = useRequestStore((s) => s.activeId);
  const entry = useResponseStore((s) => (activeId ? s.responses[activeId] : undefined));
  const [activeTab, setActiveTab] = useState<ResponseTab>("body");
  const [bodyView, setBodyView] = useState<BodyViewKind>("tree");
  const [filter, setFilter] = useState("");

  if (!entry) return <ResponsePlaceholder />;
  if (entry.state === "loading") return <LoadingView />;
  if (entry.state === "error") return <ErrorView message={entry.error} />;

  const response = entry.response;
  // ...existing JSX unchanged, using `response`
```

(Note the rename: the type import `ResponseBodyView` becomes `BodyViewKind` to keep the existing `BodyView` component alias unambiguous. The `<HttpResponse>` type import is no longer needed.)

Add below the component, next to `HeadersView`/`TimingStub`:

```tsx
function LoadingView() {
  return (
    <aside className="flex flex-col h-full bg-card border-l border-border">
      <div className="flex flex-col items-center justify-center gap-3 flex-1 text-muted">
        <Loader2 size={28} className="animate-spin opacity-50" />
        <span className="text-[13px]" style={{ fontFamily: "var(--font-sans)" }}>
          Sending…
        </span>
      </div>
    </aside>
  );
}

function ErrorView({ message }: { message: string }) {
  return (
    <aside className="flex flex-col h-full bg-card border-l border-border">
      <div className="flex flex-col items-center justify-center gap-3 flex-1 px-6 text-center">
        <CircleAlert size={28} className="text-status-5xx opacity-80" />
        <span className="text-[13px] text-status-5xx" style={{ fontFamily: "var(--font-mono)" }}>
          {message}
        </span>
      </div>
    </aside>
  );
}
```

Update `TimingStub` copy to reflect the shortcut:

```tsx
function TimingStub() {
  return (
    <div className="flex-1 flex items-center justify-center text-muted text-[13px]" style={{ fontFamily: "var(--font-sans)" }}>
      Total time only for now — per-phase waterfall coming with the instrumented engine.
    </div>
  );
}
```

- [ ] **Step 6: Note the shortcut in product.md**

In `docs/product.md`, under the `### F3 — Send request 🟢` section, append one line at the end:

```markdown
Current engine: reqwest shortcut (ADR-005) — total time only; per-phase waterfall and phase-attributed errors land with the instrumented engine.
```

- [ ] **Step 7: Verify end to end**

Run: `pnpm test` → all pass. `pnpm build` → no TS errors.
Manual check (`pnpm tauri dev`): Send a GET to `https://httpbin.org/get` → status bar, body tree, headers tab populated; error case (`https://localhost:1/`) shows the error view; switching tabs shows each tab's own response; closing a tab and reopening shows the placeholder.

- [ ] **Step 8: Commit**

```bash
git add src/components/response/ResponsePanel.tsx src/store/requestStore.ts src/store/requestStore.test.ts docs/product.md
git commit -m "feat(response): drive response panel from responseStore with loading and error states"
```
