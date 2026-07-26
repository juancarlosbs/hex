use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::Path;

use crate::domain::value::FormValue;
use crate::domain::wsdl::QName;
use crate::engine::{HttpResponse, SendSpec};

#[allow(dead_code)]
const MAX_ENTRIES_PER_REQUEST: usize = 50;
#[allow(dead_code)]
const MAX_BODY_BYTES: usize = 1_048_576; // 1 MB

/// What was sent — enough to restore the request in the editor.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
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

#[allow(dead_code)]
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

#[allow(dead_code)]
fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Cut `body` at MAX_BODY_BYTES on a char boundary. Returns true when cut.
#[allow(dead_code)]
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

#[allow(dead_code)]
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
#[allow(dead_code)]
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

#[allow(dead_code)]
pub fn get(db: &Path, entry_id: i64) -> anyhow::Result<HistoryEntry> {
    let conn = open(db)?;
    let (executed_at_ms, spec_json, response_json, error): (
        i64,
        String,
        Option<String>,
        Option<String>,
    ) = conn
        .query_row(
            "SELECT executed_at_ms, spec_json, response_json, error FROM history WHERE id = ?1",
            params![entry_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .map_err(|_| anyhow::anyhow!("history entry {entry_id} not found"))?;
    Ok(HistoryEntry {
        id: entry_id,
        executed_at_ms,
        spec: serde_json::from_str(&spec_json)?,
        response: response_json
            .as_deref()
            .map(serde_json::from_str)
            .transpose()?,
        error,
    })
}

#[allow(dead_code)]
pub fn clear(db: &Path, request_id: &str) -> anyhow::Result<()> {
    let conn = open(db)?;
    conn.execute(
        "DELETE FROM history WHERE request_id = ?1",
        params![request_id],
    )?;
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
                body: BodyData {
                    mode: "json".into(),
                    json: "".into(),
                    form: vec![],
                },
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
