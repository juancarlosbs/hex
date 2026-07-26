# Send History per Request — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record every Send of a saved request (spec snapshot + full response or error) in SQLite, with a drawer UI to view past responses and restore past request specs.

**Architecture:** A new `persistence/history.rs` module owns a SQLite DB (`app_data_dir/history.db`) driven by `rusqlite` from Rust — never from the webview. The three send commands (`send_request`, `send_soap`, `send_soap_raw`) gain an optional `request_id` and append an entry after each send. Three new thin commands expose list/get/clear. The frontend adds a `useHistoryStore`, a clock-button-triggered drawer overlaying the Response Panel, and a `applyHistorySpec` restore action on `useRequestStore`.

**Tech Stack:** Rust (rusqlite bundled, serde, tauri-specta), React 19 + TS, zustand, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-25-send-history-design.md`

## Global Constraints

- All code, comments, docs in **English**.
- `src/bindings.ts` is **generated** — never edit by hand; regenerate with `cargo test export_bindings` (inside `src-tauri/`).
- Commands are **thin**: validate + delegate. All fs/DB access in `persistence/`.
- rustls only — `rusqlite` must use the `bundled` feature (pure C SQLite, no OpenSSL involvement).
- TS: no `any`; components never call `invoke`/bindings directly — only `api` wrappers from `src/lib/api.ts`.
- UI: tokens from `styles/tokens.css` only, CVA + `cn()`, named exports, no hardcoded hex.
- Commits: Conventional Commits, single line, no body, plain English (no "via" — use "with"/"using").
- History cap: **50** entries per request. Body truncation: **1 MB** (1_048_576 bytes).
- Run `cargo fmt` and `cargo clippy` before each Rust commit; `pnpm lint` before each TS commit.
- Spec deviations locked in this plan (Task 7 updates the spec doc): `executed_at_ms INTEGER` (unix ms) instead of ISO 8601 TEXT; extra derived columns `method`, `status`, `duration_ms`, `size_bytes` so `list_history` never loads bodies.

---

### Task 1: History persistence layer (`persistence/history.rs`)

**Files:**
- Modify: `src-tauri/Cargo.toml` (add rusqlite)
- Modify: `src-tauri/src/engine/mod.rs:14-37` (derives + `truncated` field)
- Modify: `src-tauri/src/engine/connector.rs:16` (derives)
- Modify: `src-tauri/src/engine/fault.rs:4` (derives)
- Create: `src-tauri/src/persistence/history.rs` (module + inline tests)
- Modify: `src-tauri/src/persistence/mod.rs` (register module)

**Interfaces:**
- Consumes: `engine::SendSpec`, `engine::HttpResponse`, `domain::wsdl::QName`, `domain::value::FormValue` (all existing).
- Produces (used by Tasks 2–3):
  - `history::HistorySpec` (enum: `Rest`/`Soap`/`SoapRaw`)
  - `history::HistoryEntrySummary`, `history::HistoryEntry`
  - `history::append(db: &Path, request_id: &str, spec: HistorySpec, result: &Result<HttpResponse, String>) -> anyhow::Result<()>`
  - `history::list(db: &Path, request_id: &str) -> anyhow::Result<Vec<HistoryEntrySummary>>`
  - `history::get(db: &Path, entry_id: i64) -> anyhow::Result<HistoryEntry>`
  - `history::clear(db: &Path, request_id: &str) -> anyhow::Result<()>`

- [ ] **Step 1: Add rusqlite**

Run inside `src-tauri/`:

```bash
cargo add rusqlite --features bundled
```

`bundled` compiles SQLite from source — no system lib, no TLS stack involved.

- [ ] **Step 2: Add missing derives so responses/specs round-trip through JSON**

In `src-tauri/src/engine/mod.rs`, `SendSpec` currently derives `(Debug, Deserialize, specta::Type)`. Change to:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct SendSpec {
```

`HttpResponse` currently derives `(Debug, Serialize, specta::Type)`. Change to:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct HttpResponse {
```

and add one field at the end of the struct (after `fault`):

```rust
    /// True when a history entry's body was cut at 1 MB before storing.
    /// Always false on live responses.
    #[serde(default)]
    pub truncated: bool,
}
```

Then fix the two construction sites of `HttpResponse` (`to_http_response` at `engine/mod.rs:151` and any other struct literal `cargo check` flags) by adding `truncated: false,`.

In `src-tauri/src/engine/connector.rs:16`, `TimingBreakdown`: change `#[derive(Debug, Serialize, specta::Type)]` to `#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]` and add `use serde::Deserialize;` alongside the existing `use serde::Serialize;` (i.e. `use serde::{Deserialize, Serialize};`).

In `src-tauri/src/engine/fault.rs:4`, `SoapFault`: same change — `#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]`, import `Deserialize`.

Run `cargo check` and fix any remaining missing-field/missing-derive errors it reports (they will all be `truncated: false` insertions).

- [ ] **Step 3: Create `history.rs` with types and failing tests**

Create `src-tauri/src/persistence/history.rs`:

```rust
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::Path;

use crate::domain::value::FormValue;
use crate::domain::wsdl::QName;
use crate::engine::{HttpResponse, SendSpec};

const MAX_ENTRIES_PER_REQUEST: usize = 50;
const MAX_BODY_BYTES: usize = 1_048_576; // 1 MB

/// What was sent — enough to restore the request in the editor.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum HistorySpec {
    Rest {
        spec: SendSpec,
    },
    Soap {
        wsdl_url: String,
        input_element: QName,
        endpoint: String,
        soap_action: String,
        soap_version: String,
        value: FormValue,
    },
    SoapRaw {
        endpoint: String,
        envelope: String,
        soap_action: String,
        soap_version: String,
    },
}

/// Light row for the drawer list — no bodies.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntrySummary {
    pub id: i64,
    pub executed_at_ms: i64,
    /// "GET"/"POST"/… for REST, "SOAP" for both SOAP paths.
    pub method: String,
    /// None when the send failed before an HTTP response existed.
    pub status: Option<u16>,
    pub duration_ms: Option<u64>,
    pub size_bytes: Option<u64>,
    pub error: Option<String>,
}

/// Full entry, loaded on demand. `response` and `error` are mutually exclusive.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub id: i64,
    pub executed_at_ms: i64,
    pub spec: HistorySpec,
    pub response: Option<HttpResponse>,
    pub error: Option<String>,
}

fn open(db: &Path) -> anyhow::Result<Connection> {
    if let Some(parent) = db.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let conn = Connection::open(db)?;
    conn.busy_timeout(std::time::Duration::from_secs(1))?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS history (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            request_id     TEXT NOT NULL,
            executed_at_ms INTEGER NOT NULL,
            method         TEXT NOT NULL,
            status         INTEGER,
            duration_ms    INTEGER,
            size_bytes     INTEGER,
            spec_json      TEXT NOT NULL,
            response_json  TEXT,
            error          TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_history_request ON history(request_id, id DESC);",
    )?;
    Ok(conn)
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Cut `body` at MAX_BODY_BYTES on a char boundary. Returns true when cut.
fn truncate_body(body: &mut String) -> bool {
    if body.len() <= MAX_BODY_BYTES {
        return false;
    }
    let mut cut = MAX_BODY_BYTES;
    while !body.is_char_boundary(cut) {
        cut -= 1;
    }
    body.truncate(cut);
    true
}

pub fn append(
    db: &Path,
    request_id: &str,
    spec: HistorySpec,
    result: &Result<HttpResponse, String>,
) -> anyhow::Result<()> {
    let method = match &spec {
        HistorySpec::Rest { spec } => spec.method.clone(),
        HistorySpec::Soap { .. } | HistorySpec::SoapRaw { .. } => "SOAP".to_string(),
    };
    let (status, duration_ms, size_bytes, response_json, error) = match result {
        Ok(resp) => {
            let mut stored = resp.clone();
            stored.truncated = truncate_body(&mut stored.body);
            (
                Some(stored.status),
                Some(stored.time_ms),
                Some(stored.size_bytes),
                Some(serde_json::to_string(&stored)?),
                None,
            )
        }
        Err(e) => (None, None, None, None, Some(e.clone())),
    };
    let conn = open(db)?;
    conn.execute(
        "INSERT INTO history
            (request_id, executed_at_ms, method, status, duration_ms, size_bytes, spec_json, response_json, error)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            request_id,
            now_ms(),
            method,
            status,
            duration_ms,
            size_bytes,
            serde_json::to_string(&spec)?,
            response_json,
            error,
        ],
    )?;
    conn.execute(
        "DELETE FROM history WHERE request_id = ?1 AND id NOT IN
            (SELECT id FROM history WHERE request_id = ?1 ORDER BY id DESC LIMIT ?2)",
        params![request_id, MAX_ENTRIES_PER_REQUEST as i64],
    )?;
    Ok(())
}

/// Newest first. Missing DB or no rows → empty, not an error.
pub fn list(db: &Path, request_id: &str) -> anyhow::Result<Vec<HistoryEntrySummary>> {
    let conn = open(db)?;
    let mut stmt = conn.prepare(
        "SELECT id, executed_at_ms, method, status, duration_ms, size_bytes, error
         FROM history WHERE request_id = ?1 ORDER BY id DESC",
    )?;
    let rows = stmt.query_map(params![request_id], |row| {
        Ok(HistoryEntrySummary {
            id: row.get(0)?,
            executed_at_ms: row.get(1)?,
            method: row.get(2)?,
            status: row.get(3)?,
            duration_ms: row.get(4)?,
            size_bytes: row.get(5)?,
            error: row.get(6)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn get(db: &Path, entry_id: i64) -> anyhow::Result<HistoryEntry> {
    let conn = open(db)?;
    let (executed_at_ms, spec_json, response_json, error): (i64, String, Option<String>, Option<String>) =
        conn.query_row(
            "SELECT executed_at_ms, spec_json, response_json, error FROM history WHERE id = ?1",
            params![entry_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .map_err(|_| anyhow::anyhow!("history entry {entry_id} not found"))?;
    Ok(HistoryEntry {
        id: entry_id,
        executed_at_ms,
        spec: serde_json::from_str(&spec_json)?,
        response: response_json.as_deref().map(serde_json::from_str).transpose()?,
        error,
    })
}

pub fn clear(db: &Path, request_id: &str) -> anyhow::Result<()> {
    let conn = open(db)?;
    conn.execute("DELETE FROM history WHERE request_id = ?1", params![request_id])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::persistence::collection::{AuthData, BodyData};
    use std::collections::HashMap;
    use std::path::PathBuf;

    fn tmp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("hex-test-history-{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir.join("history.db")
    }

    fn rest_spec(method: &str) -> HistorySpec {
        HistorySpec::Rest {
            spec: SendSpec {
                method: method.to_string(),
                url: "https://example.com".to_string(),
                params: vec![],
                headers: vec![],
                body: BodyData { mode: "json".into(), json: "".into(), form: vec![] },
                auth: AuthData::None,
            },
        }
    }

    fn response(body: &str) -> HttpResponse {
        HttpResponse {
            status: 200,
            status_text: "OK".into(),
            time_ms: 12,
            size_bytes: body.len() as u64,
            headers: HashMap::new(),
            body: body.into(),
            timing: crate::engine::connector::TimingBreakdown {
                dns_ms: None,
                tcp_ms: None,
                tls_ms: None,
                ttfb_ms: 10,
                download_ms: 2,
                total_ms: 12,
            },
            fault: None,
            truncated: false,
        }
    }

    #[test]
    fn append_then_list_newest_first() {
        let db = tmp("append-list");
        append(&db, "r1", rest_spec("GET"), &Ok(response("a"))).unwrap();
        append(&db, "r1", rest_spec("POST"), &Ok(response("b"))).unwrap();
        let rows = list(&db, "r1").unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].method, "POST"); // newest first
        assert_eq!(rows[0].status, Some(200));
        assert!(rows[0].error.is_none());
    }

    #[test]
    fn list_unknown_request_is_empty() {
        let db = tmp("empty");
        assert!(list(&db, "nope").unwrap().is_empty());
    }

    #[test]
    fn prunes_to_50_entries() {
        let db = tmp("prune");
        for _ in 0..51 {
            append(&db, "r1", rest_spec("GET"), &Ok(response("x"))).unwrap();
        }
        let rows = list(&db, "r1").unwrap();
        assert_eq!(rows.len(), 50);
        // ids are monotonic; the oldest (id 1) must be gone
        assert!(rows.iter().all(|r| r.id > 1));
    }

    #[test]
    fn prune_is_per_request() {
        let db = tmp("prune-scope");
        append(&db, "other", rest_spec("GET"), &Ok(response("keep"))).unwrap();
        for _ in 0..51 {
            append(&db, "r1", rest_spec("GET"), &Ok(response("x"))).unwrap();
        }
        assert_eq!(list(&db, "other").unwrap().len(), 1);
    }

    #[test]
    fn big_body_is_truncated_and_flagged() {
        let db = tmp("truncate");
        let big = "é".repeat(700_000); // 1.4 MB of 2-byte chars
        append(&db, "r1", rest_spec("GET"), &Ok(response(&big))).unwrap();
        let id = list(&db, "r1").unwrap()[0].id;
        let entry = get(&db, id).unwrap();
        let resp = entry.response.unwrap();
        assert!(resp.truncated);
        assert!(resp.body.len() <= 1_048_576);
        assert!(resp.body.chars().all(|c| c == 'é')); // cut on a char boundary
    }

    #[test]
    fn failed_send_stores_error_and_no_response() {
        let db = tmp("error");
        append(&db, "r1", rest_spec("GET"), &Err("dns failure".to_string())).unwrap();
        let rows = list(&db, "r1").unwrap();
        assert_eq!(rows[0].error.as_deref(), Some("dns failure"));
        assert_eq!(rows[0].status, None);
        let entry = get(&db, rows[0].id).unwrap();
        assert!(entry.response.is_none());
        assert_eq!(entry.error.as_deref(), Some("dns failure"));
    }

    #[test]
    fn get_round_trips_the_spec() {
        let db = tmp("roundtrip");
        append(&db, "r1", rest_spec("PUT"), &Ok(response("ok"))).unwrap();
        let id = list(&db, "r1").unwrap()[0].id;
        let entry = get(&db, id).unwrap();
        match entry.spec {
            HistorySpec::Rest { spec } => assert_eq!(spec.method, "PUT"),
            _ => panic!("expected Rest spec"),
        }
    }

    #[test]
    fn get_missing_entry_is_an_error() {
        let db = tmp("missing");
        assert!(get(&db, 999).is_err());
    }

    #[test]
    fn clear_removes_only_that_request() {
        let db = tmp("clear");
        append(&db, "r1", rest_spec("GET"), &Ok(response("a"))).unwrap();
        append(&db, "r2", rest_spec("GET"), &Ok(response("b"))).unwrap();
        clear(&db, "r1").unwrap();
        assert!(list(&db, "r1").unwrap().is_empty());
        assert_eq!(list(&db, "r2").unwrap().len(), 1);
    }
}
```

Register the module — in `src-tauri/src/persistence/mod.rs` add:

```rust
pub mod history;
```

Note: `TimingBreakdown` is constructed in the test — if `engine::connector` is not already `pub` enough for that path, use the re-export `crate::engine::connector::TimingBreakdown` as written (connector is a `pub mod`).

- [ ] **Step 4: Run the tests, verify they fail only for the right reason**

Run inside `src-tauri/`: `cargo test persistence::history`
Expected: compilation succeeds after Step 2/3; if it doesn't compile, fix compile errors first — all 9 tests should then PASS (the module and tests land together; the "failing" phase here is the `cargo check` iteration in Steps 2–3).

- [ ] **Step 5: Full check**

Run inside `src-tauri/`: `cargo test && cargo fmt && cargo clippy -- -D warnings`
Expected: all tests pass (including existing engine/collection tests — the new `truncated` field must not break `engine::tests`), no clippy warnings.

- [ ] **Step 6: Commit**

```bash
git add src-tauri
git commit -m "feat(history): SQLite persistence layer for send history"
```

---

### Task 2: Record history in the three send commands

**Files:**
- Modify: `src-tauri/src/commands/mod.rs:114-120` (`send_request`), `:246-278` (`send_soap`), `:306-316` (`send_soap_raw`)

**Interfaces:**
- Consumes: `persistence::history::{append, HistorySpec}` (Task 1), existing `data_dir` helper (`commands/mod.rs:4`).
- Produces: the three send commands each gain a trailing `request_id: Option<String>` parameter. Generated bindings (Task 3) become `sendRequest(spec, requestId)`, `sendSoap(wsdlUrl, inputElement, endpoint, soapAction, soapVersion, value, requestId)`, `sendSoapRaw(endpoint, envelope, soapAction, soapVersion, requestId)`.

- [ ] **Step 1: Add a record helper and thread it through the commands**

In `src-tauri/src/commands/mod.rs`, add near the `data_dir` helper:

```rust
/// Best-effort history append — a history failure must never fail the send.
fn record_history(
    app: &tauri::AppHandle,
    request_id: Option<String>,
    spec: crate::persistence::history::HistorySpec,
    result: &Result<crate::engine::HttpResponse, String>,
) {
    let Some(request_id) = request_id else { return };
    let Ok(dir) = data_dir(app) else { return };
    if let Err(e) = crate::persistence::history::append(&dir.join("history.db"), &request_id, spec, result) {
        eprintln!("history: append failed for {request_id}: {e:#}");
    }
}
```

Replace `send_request` (lines 114–120) with:

```rust
#[tauri::command]
#[specta::specta]
pub async fn send_request(
    app: tauri::AppHandle,
    spec: crate::engine::SendSpec,
    request_id: Option<String>,
) -> Result<crate::engine::HttpResponse, String> {
    let snapshot = crate::persistence::history::HistorySpec::Rest { spec: spec.clone() };
    let result = crate::engine::send(spec).await;
    record_history(&app, request_id, snapshot, &result);
    result
}
```

In `send_soap`, add the two parameters `app: tauri::AppHandle` (first) and `request_id: Option<String>` (last), build the snapshot from the arguments **before** they are moved, and record around the final send:

```rust
#[tauri::command]
#[specta::specta]
pub async fn send_soap(
    app: tauri::AppHandle,
    wsdl_url: String,
    input_element: QName,
    endpoint: String,
    soap_action: String,
    soap_version: String,
    value: FormValue,
    request_id: Option<String>,
) -> Result<engine::HttpResponse, String> {
    let snapshot = crate::persistence::history::HistorySpec::Soap {
        wsdl_url: wsdl_url.clone(),
        input_element: input_element.clone(),
        endpoint: endpoint.clone(),
        soap_action: soap_action.clone(),
        soap_version: soap_version.clone(),
        value: value.clone(),
    };
    // ... existing body unchanged up to the last line, then:
    let result = engine::send_soap_envelope(&endpoint, envelope, meta).await;
    record_history(&app, request_id, snapshot, &result);
    result
}
```

Keep the existing WSDL fetch/resolve/serialize body exactly as it is — only the signature, the `snapshot` construction at the top, and the final three lines change. Note the early `?` returns (WSDL fetch/parse errors) intentionally do **not** record history: nothing was sent yet.

In `send_soap_raw` likewise:

```rust
#[tauri::command]
#[specta::specta]
pub async fn send_soap_raw(
    app: tauri::AppHandle,
    endpoint: String,
    envelope: String,
    soap_action: String,
    soap_version: String,
    request_id: Option<String>,
) -> Result<engine::HttpResponse, String> {
    let snapshot = crate::persistence::history::HistorySpec::SoapRaw {
        endpoint: endpoint.clone(),
        envelope: envelope.clone(),
        soap_action: soap_action.clone(),
        soap_version: soap_version.clone(),
    };
    let meta = engine::serialize::soap_meta(&soap_version, &soap_action);
    let result = engine::send_soap_envelope(&endpoint, envelope, meta).await;
    record_history(&app, request_id, snapshot, &result);
    result
}
```

Watch the move order in `send_soap_raw`: `envelope` is moved into `send_soap_envelope`, so the snapshot (which clones it) must be built first — as shown.

- [ ] **Step 2: Verify it compiles and nothing regressed**

Run inside `src-tauri/`: `cargo test && cargo clippy -- -D warnings`
Expected: PASS. The command wiring itself is 3 thin call sites over the fully-tested `append` — no dedicated Rust test (constructing an `AppHandle` needs the tauri mock harness; not worth it for a delegation line). The frontend flow is covered by Vitest in Task 4.

- [ ] **Step 3: Commit**

```bash
git add src-tauri
git commit -m "feat(history): record REST and SOAP sends in history"
```

---

### Task 3: History query commands + regenerated bindings

**Files:**
- Modify: `src-tauri/src/commands/mod.rs` (3 new commands at the end)
- Modify: `src-tauri/src/lib.rs:8-27` (register commands)
- Regenerate: `src/bindings.ts` (never by hand)

**Interfaces:**
- Consumes: `history::{list, get, clear}` (Task 1), `data_dir` helper.
- Produces (frontend, via generated bindings): `commands.listHistory(requestId)`, `commands.getHistoryEntry(entryId)`, `commands.clearHistory(requestId)`; generated types `HistoryEntrySummary`, `HistoryEntry`, `HistorySpec` exported from `src/bindings.ts`.

- [ ] **Step 1: Add the commands**

At the end of `src-tauri/src/commands/mod.rs`:

```rust
#[tauri::command]
#[specta::specta]
pub fn list_history(
    app: tauri::AppHandle,
    request_id: String,
) -> Result<Vec<crate::persistence::history::HistoryEntrySummary>, String> {
    let dir = data_dir(&app)?;
    crate::persistence::history::list(&dir.join("history.db"), &request_id).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn get_history_entry(
    app: tauri::AppHandle,
    entry_id: i64,
) -> Result<crate::persistence::history::HistoryEntry, String> {
    let dir = data_dir(&app)?;
    crate::persistence::history::get(&dir.join("history.db"), entry_id).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn clear_history(app: tauri::AppHandle, request_id: String) -> Result<(), String> {
    let dir = data_dir(&app)?;
    crate::persistence::history::clear(&dir.join("history.db"), &request_id).map_err(|e| e.to_string())
}
```

- [ ] **Step 2: Register in the specta builder**

In `src-tauri/src/lib.rs`, extend `collect_commands![...]` (after `commands::parse_envelope`):

```rust
        commands::list_history,
        commands::get_history_entry,
        commands::clear_history,
```

- [ ] **Step 3: Regenerate bindings and verify**

Run inside `src-tauri/`: `cargo test export_bindings`
Expected: PASS. Then verify: `grep -n "listHistory\|getHistoryEntry\|clearHistory\|HistoryEntrySummary" ../src/bindings.ts` shows the new commands and types, and `git diff --stat ../src/bindings.ts` shows the file changed. `i64` exports as `number` (the builder sets `BigIntExportBehavior::Number`).

- [ ] **Step 4: Full Rust check**

Run inside `src-tauri/`: `cargo test && cargo fmt && cargo clippy -- -D warnings`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri src/bindings.ts
git commit -m "feat(history): list, get and clear commands with regenerated bindings"
```

---

### Task 4: Frontend plumbing — api wrappers, historyStore, requestId on send

**Files:**
- Modify: `src/lib/api.ts`
- Modify: `src/store/responseStore.ts:26-62` (pass requestId)
- Modify: `src/store/responseStore.test.ts` (update send-call assertions)
- Create: `src/store/historyStore.ts`
- Test: `src/store/historyStore.test.ts`

**Interfaces:**
- Consumes: `commands.listHistory / getHistoryEntry / clearHistory / sendRequest / sendSoap / sendSoapRaw` from regenerated bindings (Task 3). Bindings signatures: `sendRequest(spec, requestId)`, `sendSoap(wsdlUrl, inputElement, endpoint, soapAction, soapVersion, value, requestId)`, `sendSoapRaw(endpoint, envelope, soapAction, soapVersion, requestId)` where `requestId: string | null`.
- Produces (used by Tasks 5–6):
  - `api.listHistory(requestId: string): Promise<HistoryEntrySummary[]>`
  - `api.getHistoryEntry(entryId: number): Promise<HistoryEntry>`
  - `api.clearHistory(requestId: string): Promise<void>`
  - Re-exported types `HistoryEntry`, `HistoryEntrySummary`, `HistorySpec` from `lib/api.ts`
  - `useHistoryStore` with state `{ openFor: string | null; entries: HistoryEntrySummary[]; loading: boolean; viewing: Record<string, HttpResponse> }` and actions `toggle(requestId)`, `close()`, `refresh(requestId)`, `view(requestId, entryId)`, `backToLive(requestId)`, `clear(requestId)`

- [ ] **Step 1: api.ts — new wrappers and updated send signatures**

In `src/lib/api.ts`, add to the re-export block:

```ts
export type { HistoryEntry, HistoryEntrySummary, HistorySpec } from "../bindings";
```

Change the three send wrappers to accept the id (nullable — `null` for scratch requests never saved to a collection):

```ts
  sendRequest: (spec: SendSpec, requestId: string | null) =>
    unwrap(commands.sendRequest(spec, requestId)),
```

and add `requestId: string | null` as the last property of the `sendSoap` / `sendSoapRaw` spec objects, forwarding it as the last argument of `commands.sendSoap(...)` / `commands.sendSoapRaw(...)`.

Add the history wrappers:

```ts
  listHistory: (requestId: string) => unwrap(commands.listHistory(requestId)),
  getHistoryEntry: (entryId: number) => unwrap(commands.getHistoryEntry(entryId)),
  clearHistory: (requestId: string) => unwrap(commands.clearHistory(requestId)),
```

- [ ] **Step 2: responseStore passes the request id**

In `src/store/responseStore.ts` `send()`, compute once at the top:

```ts
    // ponytail: path.length === 0 means a scratch request that was never
    // saved to a collection — no id to attach history to.
    const historyId = request.path.length > 0 ? request.id : null;
```

and pass it: `api.sendRequest({...}, historyId)`, `api.sendSoap({ ...request.soap.meta, value: request.soap.value, requestId: historyId })`, `api.sendSoapRaw({ ...existing fields..., requestId: historyId })`.

- [ ] **Step 3: Update responseStore tests, watch them fail then pass**

Run: `pnpm test -- responseStore`
Expected: FAIL on assertions like `expect(api.sendRequest).toHaveBeenCalledWith({...})` — the calls now carry a second argument / extra field. Update those assertions: `makeEmptyRequest("r1", "R1", "GET", ["c1", "r1"])` has a non-empty path, so expect `"r1"` as the history id (e.g. `toHaveBeenCalledWith({...}, "r1")`). Add one new test: a request with `path: []` sends `null`:

```ts
  it("sends null history id for scratch requests", async () => {
    vi.mocked(api.sendRequest).mockResolvedValue(RESP);
    await useResponseStore.getState().send(makeEmptyRequest("tmp", "Tmp"));
    expect(vi.mocked(api.sendRequest).mock.calls[0][1]).toBeNull();
  });
```

Re-run: `pnpm test -- responseStore` → PASS.

- [ ] **Step 4: historyStore with failing tests first**

Create `src/store/historyStore.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/api", () => ({
  api: {
    listHistory: vi.fn(),
    getHistoryEntry: vi.fn(),
    clearHistory: vi.fn(),
  },
}));

import { useHistoryStore } from "./historyStore";
import { api } from "../lib/api";
import type { HistoryEntry, HistoryEntrySummary, HttpResponse } from "../lib/api";

const SUMMARY: HistoryEntrySummary = {
  id: 1,
  executedAtMs: 1_753_500_000_000,
  method: "GET",
  status: 200,
  durationMs: 12,
  sizeBytes: 2,
  error: null,
};

const RESPONSE: HttpResponse = {
  status: 200,
  statusText: "OK",
  timeMs: 12,
  sizeBytes: 2,
  headers: {},
  body: "{}",
  timing: { dnsMs: null, tcpMs: null, tlsMs: null, ttfbMs: 10, downloadMs: 2, totalMs: 12 },
  fault: null,
  truncated: false,
};

const ENTRY: HistoryEntry = {
  id: 1,
  executedAtMs: 1_753_500_000_000,
  spec: {
    kind: "rest",
    spec: {
      method: "GET",
      url: "https://x.dev",
      params: [],
      headers: [],
      body: { mode: "json", json: "", form: [] },
      auth: { type: "none" },
    },
  },
  response: RESPONSE,
  error: null,
};

beforeEach(() => {
  useHistoryStore.setState({ openFor: null, entries: [], loading: false, viewing: {} });
  vi.clearAllMocks();
});

describe("toggle", () => {
  it("opens for a request and loads its entries", async () => {
    vi.mocked(api.listHistory).mockResolvedValue([SUMMARY]);
    await useHistoryStore.getState().toggle("r1");
    expect(useHistoryStore.getState().openFor).toBe("r1");
    expect(useHistoryStore.getState().entries).toEqual([SUMMARY]);
  });

  it("closes when toggled for the same request", async () => {
    vi.mocked(api.listHistory).mockResolvedValue([]);
    await useHistoryStore.getState().toggle("r1");
    await useHistoryStore.getState().toggle("r1");
    expect(useHistoryStore.getState().openFor).toBeNull();
  });
});

describe("view / backToLive", () => {
  it("loads the entry response for viewing", async () => {
    vi.mocked(api.getHistoryEntry).mockResolvedValue(ENTRY);
    await useHistoryStore.getState().view("r1", 1);
    expect(useHistoryStore.getState().viewing.r1).toEqual(RESPONSE);
  });

  it("backToLive drops the viewed response", async () => {
    vi.mocked(api.getHistoryEntry).mockResolvedValue(ENTRY);
    await useHistoryStore.getState().view("r1", 1);
    useHistoryStore.getState().backToLive("r1");
    expect(useHistoryStore.getState().viewing.r1).toBeUndefined();
  });
});

describe("clear", () => {
  it("clears backend history and the list", async () => {
    vi.mocked(api.clearHistory).mockResolvedValue(undefined);
    useHistoryStore.setState({ openFor: "r1", entries: [SUMMARY], loading: false, viewing: {} });
    await useHistoryStore.getState().clear("r1");
    expect(api.clearHistory).toHaveBeenCalledWith("r1");
    expect(useHistoryStore.getState().entries).toEqual([]);
  });
});
```

Note on `SUMMARY`/`ENTRY` field names: they mirror the generated camelCase bindings — if tsc complains a field name differs (e.g. `executedAtMs`), fix the test to match `src/bindings.ts`, not the other way around.

- [ ] **Step 5: Run tests, verify they fail**

Run: `pnpm test -- historyStore`
Expected: FAIL — `./historyStore` module does not exist.

- [ ] **Step 6: Implement the store**

Create `src/store/historyStore.ts`:

```ts
import { create } from "zustand";
import { api } from "../lib/api";
import type { HistoryEntrySummary, HttpResponse } from "../lib/api";

interface HistoryState {
  /** Request id the drawer is open for; null = closed. */
  openFor: string | null;
  entries: HistoryEntrySummary[];
  loading: boolean;
  /** Per request: a saved response being viewed instead of the live one. */
  viewing: Record<string, HttpResponse>;

  toggle(requestId: string): Promise<void>;
  close(): void;
  refresh(requestId: string): Promise<void>;
  view(requestId: string, entryId: number): Promise<void>;
  backToLive(requestId: string): void;
  clear(requestId: string): Promise<void>;
}

export const useHistoryStore = create<HistoryState>((set, get) => ({
  openFor: null,
  entries: [],
  loading: false,
  viewing: {},

  async toggle(requestId) {
    if (get().openFor === requestId) {
      set({ openFor: null, entries: [] });
      return;
    }
    set({ openFor: requestId, entries: [], loading: true });
    await get().refresh(requestId);
  },

  close() {
    set({ openFor: null, entries: [] });
  },

  async refresh(requestId) {
    set({ loading: true });
    try {
      const entries = await api.listHistory(requestId);
      if (get().openFor !== requestId) return; // drawer moved on meanwhile
      set({ entries, loading: false });
    } catch {
      if (get().openFor !== requestId) return;
      set({ entries: [], loading: false });
    }
  },

  async view(requestId, entryId) {
    const entry = await api.getHistoryEntry(entryId);
    if (entry.response) {
      set((s) => ({ viewing: { ...s.viewing, [requestId]: entry.response! } }));
    }
  },

  backToLive(requestId) {
    set((s) => {
      const { [requestId]: _dropped, ...viewing } = s.viewing;
      return { viewing };
    });
  },

  async clear(requestId) {
    await api.clearHistory(requestId);
    set({ entries: [] });
  },
}));
```

- [ ] **Step 7: Run tests, verify they pass**

Run: `pnpm test`
Expected: all suites PASS (historyStore new tests + updated responseStore + everything pre-existing).

- [ ] **Step 8: Lint and commit**

```bash
pnpm lint
git add src/lib/api.ts src/store
git commit -m "feat(history): api wrappers, history store and request id on send"
```

---

### Task 5: Restore a history spec into the editor

**Files:**
- Modify: `src/store/requestStore.ts` (new `applyHistorySpec` action)
- Test: `src/store/requestStore.test.ts` (extend existing file)

**Interfaces:**
- Consumes: `HistorySpec` type (Task 4 re-export), existing `OpenRequest` shape (`src/lib/request-types.ts:50-70`).
- Produces: `useRequestStore.getState().applyHistorySpec(id: string, spec: HistorySpec): void` — used by the drawer (Task 6). Marks the request `dirty: true`. The **confirm** for overwriting a dirty draft lives in the drawer button (Task 6), not here.

- [ ] **Step 1: Write failing tests**

Add to `src/store/requestStore.test.ts` (follow the file's existing setup helpers; create the open request the same way neighboring tests do):

```ts
describe("applyHistorySpec", () => {
  it("restores a REST spec into the open request", () => {
    // arrange: an open request "r1" (reuse the file's existing helper/setup)
    useRequestStore.getState().applyHistorySpec("r1", {
      kind: "rest",
      spec: {
        method: "POST",
        url: "https://restored.dev",
        params: [{ id: "p1", key: "a", value: "1", enabled: true }],
        headers: [],
        body: { mode: "json", json: "{\"x\":1}", form: [] },
        auth: { type: "bearer", token: "tok" },
      },
    });
    const req = useRequestStore.getState().openRequests.r1;
    expect(req.method).toBe("POST");
    expect(req.url).toBe("https://restored.dev");
    expect(req.params[0].key).toBe("a");
    expect(req.body.json).toBe("{\"x\":1}");
    expect(req.auth).toEqual({ type: "bearer", token: "tok" });
    expect(req.dirty).toBe(true);
  });

  it("restores a SOAP form spec and clears the xml draft", () => {
    // arrange: an open SOAP request "s1" with soap.meta/schema set and xmlDraft "old"
    useRequestStore.getState().applyHistorySpec("s1", {
      kind: "soap",
      wsdlUrl: "https://w.dev?wsdl",
      inputElement: { namespace: "ns", local: "Op" },
      endpoint: "https://w.dev/svc",
      soapAction: "urn:op",
      soapVersion: "1.1",
      value: { kind: "complex", children: [] },
    });
    const req = useRequestStore.getState().openRequests.s1;
    expect(req.soap?.meta.endpoint).toBe("https://w.dev/svc");
    expect(req.soap?.value).toEqual({ kind: "complex", children: [] });
    expect(req.soap?.xmlDraft).toBeNull();
    expect(req.dirty).toBe(true);
  });

  it("restores a raw SOAP envelope as the xml draft", () => {
    useRequestStore.getState().applyHistorySpec("s1", {
      kind: "soapRaw",
      endpoint: "https://w.dev/svc",
      envelope: "<Envelope/>",
      soapAction: "urn:op",
      soapVersion: "1.2",
    });
    const req = useRequestStore.getState().openRequests.s1;
    expect(req.soap?.xmlDraft).toBe("<Envelope/>");
    expect(req.soap?.meta.soapVersion).toBe("1.2");
    expect(req.dirty).toBe(true);
  });
});
```

Adjust the literal shapes (`FormValue` variant names, `QName` fields, `HistorySpec` tag casing) to whatever `src/bindings.ts` actually generated — the bindings are the source of truth. The arrange comments must be replaced with the file's real helpers for opening a request (mirror how existing tests in that file set `openRequests`).

- [ ] **Step 2: Run, verify failure**

Run: `pnpm test -- requestStore`
Expected: FAIL — `applyHistorySpec` is not a function.

- [ ] **Step 3: Implement**

In `src/store/requestStore.ts`, add to the interface:

```ts
  applyHistorySpec(id: string, spec: HistorySpec): void;
```

(import `HistorySpec`, `KeyValue` types; `HistorySpec` comes from `../lib/api`). Implementation, following the store's existing `set` patterns:

```ts
  applyHistorySpec(id, spec) {
    set((s) => {
      const req = s.openRequests[id];
      if (!req) return s;
      let next = req;
      if (spec.kind === "rest") {
        const r = spec.spec;
        next = {
          ...req,
          method: r.method as HttpMethod,
          url: r.url,
          params: r.params as KeyValue[],
          headers: r.headers as KeyValue[],
          body: r.body as RestBody,
          auth: r.auth as AuthConfig,
          dirty: true,
        };
      } else if (spec.kind === "soap" && req.soap) {
        next = {
          ...req,
          dirty: true,
          soap: {
            ...req.soap,
            meta: {
              wsdlUrl: spec.wsdlUrl,
              inputElement: spec.inputElement,
              endpoint: spec.endpoint,
              soapAction: spec.soapAction,
              soapVersion: spec.soapVersion,
            },
            value: spec.value,
            xmlDraft: null,
          },
        };
      } else if (spec.kind === "soapRaw" && req.soap) {
        next = {
          ...req,
          dirty: true,
          soap: {
            ...req.soap,
            meta: { ...req.soap.meta, endpoint: spec.endpoint, soapAction: spec.soapAction, soapVersion: spec.soapVersion },
            xmlDraft: spec.envelope,
          },
        };
      }
      return { openRequests: { ...s.openRequests, [id]: next } };
    });
  },
```

The `as` casts bridge the generated wire types (`KeyValueEntry`, `BodyData`, `AuthData`) to the UI types (`KeyValue`, `RestBody`, `AuthConfig`) — they are structurally identical (same serde field names, `KeyValueEntry` carries `id`); if tsc rejects a direct cast, go through `as unknown as` **only** for that field and leave a one-line comment naming the two types. Match the exact tag literals (`"rest"` / `"soap"` / `"soapRaw"`) against the generated `HistorySpec` union in `src/bindings.ts` and use what's there.

- [ ] **Step 4: Run tests, verify pass**

Run: `pnpm test`
Expected: PASS, all suites.

- [ ] **Step 5: Lint and commit**

```bash
pnpm lint
git add src/store/requestStore.ts src/store/requestStore.test.ts
git commit -m "feat(history): restore a history entry spec into the editor"
```

---

### Task 6: History drawer UI + clock buttons + history-view banner

**Files:**
- Create: `src/components/response/HistoryDrawer.tsx`
- Test: `src/components/response/HistoryDrawer.test.tsx`
- Modify: `src/components/CentralPanel.tsx:15-17` (relative wrapper + drawer mount)
- Modify: `src/components/request/UrlBar.tsx` (clock button)
- Modify: `src/components/request/soap/SoapUrlBar.tsx` (clock button)
- Modify: `src/components/response/ResponsePanel.tsx` (render viewed history response + banner)

**Interfaces:**
- Consumes: `useHistoryStore` (Task 4), `useRequestStore.applyHistorySpec` (Task 5), `api.getHistoryEntry` (Task 4), existing `ResponseStatusBar`/`ResponseTabsStrip`/`Waterfall` composition in `ResponsePanel.tsx`.
- Produces: user-facing feature — no downstream tasks consume code from this one.

- [ ] **Step 1: Clock buttons**

In `src/components/request/UrlBar.tsx`, import `History` from `lucide-react` and `useHistoryStore`; insert between the URL input and the Send button:

```tsx
      <button
        type="button"
        onClick={() => toggle(requestId)}
        className={cn(
          "flex items-center justify-center px-3 py-[10px] rounded-[6px] border border-border cursor-pointer transition-colors",
          drawerOpen ? "bg-secondary text-foreground" : "bg-background text-muted hover:text-foreground",
        )}
        title="Send history"
      >
        <History size={15} />
      </button>
```

with, alongside the other store hooks:

```tsx
  const toggle = useHistoryStore((s) => s.toggle);
  const drawerOpen = useHistoryStore((s) => s.openFor === requestId);
```

(import `cn` from `../../lib/utils`). Add the same button to `SoapUrlBar.tsx` in the equivalent position before its Send button (imports adjusted for its `../../../` depth).

- [ ] **Step 2: Drawer component with failing test first**

Create `src/components/response/HistoryDrawer.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("../../lib/api", () => ({
  api: { listHistory: vi.fn(), getHistoryEntry: vi.fn(), clearHistory: vi.fn() },
}));

import { HistoryDrawer } from "./HistoryDrawer";
import { useHistoryStore } from "../../store/historyStore";
import type { HistoryEntrySummary } from "../../lib/api";

const ENTRIES: HistoryEntrySummary[] = [
  { id: 2, executedAtMs: Date.now() - 60_000, method: "GET", status: 200, durationMs: 12, sizeBytes: 5, error: null },
  { id: 1, executedAtMs: Date.now() - 120_000, method: "GET", status: null, durationMs: null, sizeBytes: null, error: "dns failure" },
];

beforeEach(() => {
  vi.clearAllMocks();
  useHistoryStore.setState({ openFor: "r1", entries: ENTRIES, loading: false, viewing: {} });
});

describe("HistoryDrawer", () => {
  it("renders one row per entry with status and error badges", () => {
    render(<HistoryDrawer />);
    expect(screen.getByText("200")).toBeInTheDocument();
    expect(screen.getByText("Error")).toBeInTheDocument();
  });

  it("renders nothing when closed", () => {
    useHistoryStore.setState({ openFor: null });
    const { container } = render(<HistoryDrawer />);
    expect(container.firstChild).toBeNull();
  });

  it("clicking a row views that entry", () => {
    const view = vi.fn();
    useHistoryStore.setState({ view } as never);
    render(<HistoryDrawer />);
    fireEvent.click(screen.getByText("200"));
    expect(view).toHaveBeenCalledWith("r1", 2);
  });

  it("shows an empty state when there are no entries", () => {
    useHistoryStore.setState({ entries: [] });
    render(<HistoryDrawer />);
    expect(screen.getByText(/no sends yet/i)).toBeInTheDocument();
  });
});
```

(If the repo's component tests use a different render helper/setup file, mirror the pattern from `SoapFaultBanner.test.tsx`.)

Run: `pnpm test -- HistoryDrawer` → Expected: FAIL, module missing.

- [ ] **Step 3: Implement the drawer**

Create `src/components/response/HistoryDrawer.tsx`:

```tsx
import { RotateCcw, Trash2, X } from "lucide-react";
import { cn } from "../../lib/utils";
import { api } from "../../lib/api";
import { useHistoryStore } from "../../store/historyStore";
import { useRequestStore } from "../../store/requestStore";

function relativeTime(ms: number): string {
  const diff = Math.max(0, Date.now() - ms);
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export function HistoryDrawer() {
  const openFor = useHistoryStore((s) => s.openFor);
  const entries = useHistoryStore((s) => s.entries);
  const loading = useHistoryStore((s) => s.loading);
  const view = useHistoryStore((s) => s.view);
  const close = useHistoryStore((s) => s.close);
  const clear = useHistoryStore((s) => s.clear);
  const applyHistorySpec = useRequestStore((s) => s.applyHistorySpec);
  const dirty = useRequestStore((s) => (openFor ? s.openRequests[openFor]?.dirty : false));

  if (!openFor) return null;

  const restore = async (entryId: number) => {
    if (dirty && !window.confirm("Overwrite the current draft with this execution's request?")) return;
    const entry = await api.getHistoryEntry(entryId);
    applyHistorySpec(openFor, entry.spec);
  };

  return (
    <div className="absolute inset-y-0 right-0 w-[300px] z-10 flex flex-col bg-card border-l border-border shadow-lg">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="text-[12px] font-semibold text-foreground">History</span>
        <button type="button" onClick={close} className="text-muted hover:text-foreground cursor-pointer" title="Close">
          <X size={14} />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {loading && <div className="p-3 text-[12px] text-muted">Loading…</div>}
        {!loading && entries.length === 0 && (
          <div className="p-3 text-[12px] text-muted">No sends yet — hit Send and it will show up here.</div>
        )}
        {entries.map((e) => (
          <div
            key={e.id}
            onClick={() => view(openFor, e.id)}
            className="group flex items-center gap-2 px-3 py-2 border-b border-border/50 cursor-pointer hover:bg-secondary/60"
          >
            <span
              className={cn(
                "text-[11px] font-semibold px-[6px] py-[1px] rounded-[4px]",
                e.error != null || (e.status ?? 0) >= 400
                  ? "bg-destructive/15 text-destructive"
                  : "bg-primary/15 text-primary",
              )}
            >
              {e.error != null ? "Error" : e.status}
            </span>
            <span className="text-[12px] text-foreground">{e.method}</span>
            <span className="flex-1 text-right text-[11px] text-muted">
              {e.durationMs != null ? `${e.durationMs}ms · ` : ""}
              {relativeTime(e.executedAtMs)}
            </span>
            <button
              type="button"
              onClick={(ev) => {
                ev.stopPropagation();
                void restore(e.id);
              }}
              className="opacity-0 group-hover:opacity-100 text-muted hover:text-foreground cursor-pointer"
              title="Restore this request into the editor"
            >
              <RotateCcw size={13} />
            </button>
          </div>
        ))}
      </div>

      {entries.length > 0 && (
        <button
          type="button"
          onClick={() => {
            if (window.confirm("Clear all history for this request?")) void clear(openFor);
          }}
          className="flex items-center gap-2 px-3 py-2 text-[12px] text-muted hover:text-destructive border-t border-border cursor-pointer"
        >
          <Trash2 size={13} /> Clear history
        </button>
      )}
    </div>
  );
}
```

If `text-destructive` / `bg-destructive` tokens don't exist in `styles/tokens.css`, use the error token the codebase already uses for failed responses (check `ResponseStatusBar.tsx` for the status-color pattern) — do not invent hex values.

- [ ] **Step 4: Mount the drawer over the Response Panel**

In `src/components/CentralPanel.tsx`, wrap the response panel:

```tsx
        <Panel defaultSize={40} minSize={20}>
          <div className="relative h-full">
            <ResponsePanel />
            <HistoryDrawer />
          </div>
        </Panel>
```

(import `HistoryDrawer` from `./response/HistoryDrawer`).

- [ ] **Step 5: History-view banner in ResponsePanel**

In `src/components/response/ResponsePanel.tsx`, read the viewed response and prefer it over the live entry:

```tsx
  const viewing = useHistoryStore((s) => (activeId ? s.viewing[activeId] : undefined));
  const backToLive = useHistoryStore((s) => s.backToLive);
```

Then change the early-return chain: when `viewing` is set (and `activeId`), skip the placeholder/loading/error returns and render the normal panel body with `const response = viewing;`, prepending a banner above the status bar:

```tsx
      {viewing && activeId && (
        <div className="flex items-center justify-between px-3 py-[6px] bg-secondary border-b border-border text-[12px] text-muted">
          <span>Viewing a past response{response.truncated ? " (body truncated at 1 MB)" : ""}</span>
          <button type="button" onClick={() => backToLive(activeId)} className="text-foreground cursor-pointer hover:underline">
            Back to live
          </button>
        </div>
      )}
```

Concretely: extract the current post-`entry` JSX into the shared path so both `viewing` and `entry.state === "done"` render it — smallest edit wins; keep the existing `LoadingView`/`ErrorView` behavior when nothing is being viewed.

- [ ] **Step 6: Run all tests**

Run: `pnpm test`
Expected: PASS — drawer tests plus all pre-existing suites.

- [ ] **Step 7: Manual smoke (the real app)**

Run: `pnpm tauri dev`. Verify the hero flow additions: send a saved REST request twice → clock button → drawer lists 2 entries → click one → banner + saved response with working Timing tab → Back to live → Restore with an edited URL → confirm dialog → editor updated → Clear history empties the drawer. Send with an unreachable host → entry shows the Error badge.

- [ ] **Step 8: Lint and commit**

```bash
pnpm lint
git add src/components src/store
git commit -m "feat(history): drawer UI with view, restore and clear"
```

---

### Task 7: Docs — stack.md, spec amendments

**Files:**
- Modify: `docs/stack.md:75` (replace the `tauri-plugin-sql` line) and `:151` (SQLite note)
- Modify: `docs/superpowers/specs/2026-07-25-send-history-design.md` (schema/timestamp amendments)

**Interfaces:** none — documentation only.

- [ ] **Step 1: stack.md**

Replace the optional `tauri-plugin-sql` line (`docs/stack.md:75`) with:

```toml
rusqlite = { version = "<version cargo resolved>", features = ["bundled"] }  # history DB (ADR-011), driven from Rust — plugin-sql would expose SQL to the webview
```

(copy the exact version from `src-tauri/Cargo.toml`). Update line 151's "Heavy history in SQLite" note to mention `rusqlite` + `app_data_dir/history.db`.

- [ ] **Step 2: Spec amendments**

In `docs/superpowers/specs/2026-07-25-send-history-design.md`, update §3 to match what shipped: `executed_at_ms INTEGER` (unix ms, not ISO 8601 TEXT) and the derived columns `method TEXT`, `status INTEGER`, `duration_ms INTEGER`, `size_bytes INTEGER` (so `list_history` never parses JSON), and §4's dependency note (`rusqlite`, per-call `Connection::open`, 1s busy timeout). Keep the rest as-is.

- [ ] **Step 3: Commit**

```bash
git add docs
git commit -m "docs: rusqlite for history storage and spec amendments"
```

---

## Self-review (done at plan-writing time)

- **Spec coverage**: §3 data model → Task 1; §4 persistence/rusqlite divergence → Tasks 1, 7; §5 capture (3 send paths — `send_soap_raw` added, it's also a real send) → Task 2; §6 commands + bindings → Task 3; §7 drawer/view/restore/clear + stores + wrappers → Tasks 4–6; §8 error handling (failed sends recorded → Task 1 test; history failure never fails send → Task 2 helper; missing entry → Task 1 test; empty state → Task 6) ; §9 testing matrix → Tasks 1, 4, 5, 6; §10 order preserved.
- **Known deviations from spec (intentional, documented in Task 7)**: unix-ms timestamps; derived summary columns; `send_soap_raw` included in capture.
- **Type consistency**: `HistorySpec` tags (`rest`/`soap`/`soapRaw` via `rename_all = "camelCase"` on the tag), `HistoryEntrySummary` camelCase fields, `applyHistorySpec` name used in Tasks 5 and 6, `api.getHistoryEntry(entryId: number)` used in Tasks 4 and 6 — all cross-checked. Where generated bindings are authoritative (tag casing, field names), tasks say so explicitly.
