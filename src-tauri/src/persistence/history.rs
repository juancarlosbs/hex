use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::{Path, PathBuf};

use super::collection::validate_ids;

/// One recorded Send for a request. `status` is None when the send failed
/// before an HTTP response existed (DNS/connect error) — `error` carries why.
#[derive(Debug, Serialize, Deserialize, Clone, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub timestamp_ms: u64,
    pub status: Option<u16>,
    pub time_ms: u64,
    pub size_bytes: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

// History lives OUTSIDE the collections tree (ADR-011: request files stay
// git-friendly; history is voluminous and not versionable).
// ponytail: JSONL sibling file instead of SQLite — append-only, zero new deps;
// move to tauri-plugin-sql if history ever needs querying.
fn history_file(data_dir: &Path, workspace_id: &str, request_id: &str) -> PathBuf {
    data_dir
        .join("workspaces")
        .join(workspace_id)
        .join("history")
        .join(format!("{request_id}.jsonl"))
}

pub fn append_entry(
    data_dir: &Path,
    workspace_id: &str,
    request_id: &str,
    entry: &HistoryEntry,
) -> anyhow::Result<()> {
    validate_ids(&[request_id.to_string()])?;
    let file = history_file(data_dir, workspace_id, request_id);
    std::fs::create_dir_all(file.parent().expect("history file has a parent"))?;
    let mut f = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(file)?;
    writeln!(f, "{}", serde_json::to_string(entry)?)?;
    Ok(())
}

/// Newest first. A missing file means no sends yet — empty, not an error.
pub fn list_entries(
    data_dir: &Path,
    workspace_id: &str,
    request_id: &str,
) -> anyhow::Result<Vec<HistoryEntry>> {
    validate_ids(&[request_id.to_string()])?;
    let file = history_file(data_dir, workspace_id, request_id);
    if !file.exists() {
        return Ok(vec![]);
    }
    let text = std::fs::read_to_string(file)?;
    let mut entries: Vec<HistoryEntry> = text
        .lines()
        // a half-written line from a crash must not poison the whole history
        .filter_map(|l| serde_json::from_str(l).ok())
        .collect();
    entries.reverse();
    Ok(entries)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("hex-test-history-{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn entry(status: Option<u16>, time_ms: u64) -> HistoryEntry {
        HistoryEntry {
            timestamp_ms: 1000 + time_ms,
            status,
            time_ms,
            size_bytes: 42,
            error: status.is_none().then(|| "connection refused".into()),
        }
    }

    #[test]
    fn list_without_history_is_empty() {
        let dir = tmp("empty");
        assert!(list_entries(&dir, "ws1", "r1").unwrap().is_empty());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn append_then_list_newest_first() {
        let dir = tmp("roundtrip");
        append_entry(&dir, "ws1", "r1", &entry(Some(200), 10)).unwrap();
        append_entry(&dir, "ws1", "r1", &entry(None, 20)).unwrap();
        let entries = list_entries(&dir, "ws1", "r1").unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].time_ms, 20);
        assert_eq!(entries[0].status, None);
        assert_eq!(entries[0].error.as_deref(), Some("connection refused"));
        assert_eq!(entries[1].status, Some(200));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn history_is_isolated_per_request() {
        let dir = tmp("per-request");
        append_entry(&dir, "ws1", "r1", &entry(Some(200), 1)).unwrap();
        assert!(list_entries(&dir, "ws1", "r2").unwrap().is_empty());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn corrupt_lines_are_skipped() {
        let dir = tmp("corrupt");
        append_entry(&dir, "ws1", "r1", &entry(Some(200), 1)).unwrap();
        let file = history_file(&dir, "ws1", "r1");
        let mut text = std::fs::read_to_string(&file).unwrap();
        text.push_str("{truncated");
        std::fs::write(&file, text).unwrap();
        assert_eq!(list_entries(&dir, "ws1", "r1").unwrap().len(), 1);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn path_traversal_request_id_is_rejected() {
        let dir = tmp("traversal");
        assert!(list_entries(&dir, "ws1", "..").is_err());
        assert!(append_entry(&dir, "ws1", "a/b", &entry(Some(200), 1)).is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }
}
