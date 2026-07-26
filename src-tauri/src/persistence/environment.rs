use crate::domain::env::Environment;
use std::fs;
use std::path::{Path, PathBuf};

use super::collection::validate_ids;

/// Environments live beside collections: workspaces/<ws>/environments/<id>.toml
/// (one file per environment — git-friendly, ADR-011 spirit).
fn environments_root(data_dir: &Path, workspace_id: &str) -> PathBuf {
    data_dir
        .join("workspaces")
        .join(workspace_id)
        .join("environments")
}

#[derive(Debug, serde::Serialize, specta::Type)]
pub struct EnvironmentList {
    pub environments: Vec<Environment>,
    /// Per-file load failures ("file.toml: message") — corrupt files are
    /// reported, never silently skipped (F2 spirit).
    pub errors: Vec<String>,
}

pub fn list_environments(data_dir: &Path, workspace_id: &str) -> anyhow::Result<EnvironmentList> {
    validate_ids(&[workspace_id.to_string()])?;
    let mut out = EnvironmentList {
        environments: Vec::new(),
        errors: Vec::new(),
    };
    let root = environments_root(data_dir, workspace_id);
    let entries = match fs::read_dir(&root) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(out), // no dir yet = no environments
        Err(e) => {
            // Any other read_dir failure (permissions, not-a-directory, ...) must NOT
            // read as "empty" — the frontend seeds on empty+no-errors, so silently
            // returning Ok(empty) here would trigger unwanted seed writes.
            out.errors.push(format!("environments: {e}"));
            return Ok(out);
        }
    };
    for entry in entries {
        let entry = match entry {
            Ok(entry) => entry,
            Err(e) => {
                out.errors.push(format!("environments: {e}"));
                continue;
            }
        };
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("toml") {
            continue;
        }
        let file = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        let parsed = fs::read_to_string(&path)
            .map_err(anyhow::Error::from)
            .and_then(|s| toml::from_str::<Environment>(&s).map_err(anyhow::Error::from));
        match parsed {
            Ok(env) => out.environments.push(env),
            Err(e) => out.errors.push(format!("{file}: {e}")),
        }
    }
    out.environments.sort_by_key(|e| e.name.to_lowercase());
    Ok(out)
}

pub fn save_environment(
    data_dir: &Path,
    workspace_id: &str,
    env: &Environment,
) -> anyhow::Result<()> {
    validate_ids(&[workspace_id.to_string(), env.id.clone()])?;
    let root = environments_root(data_dir, workspace_id);
    fs::create_dir_all(&root)?;
    fs::write(
        root.join(format!("{}.toml", env.id)),
        toml::to_string_pretty(env)?,
    )?;
    Ok(())
}

pub fn load_environment(
    data_dir: &Path,
    workspace_id: &str,
    id: &str,
) -> anyhow::Result<Option<Environment>> {
    validate_ids(&[workspace_id.to_string(), id.to_string()])?;
    let path = environments_root(data_dir, workspace_id).join(format!("{id}.toml"));
    match fs::read_to_string(&path) {
        Ok(s) => Ok(Some(toml::from_str(&s)?)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.into()),
    }
}

pub fn delete_environment(data_dir: &Path, workspace_id: &str, id: &str) -> anyhow::Result<()> {
    validate_ids(&[workspace_id.to_string(), id.to_string()])?;
    let path = environments_root(data_dir, workspace_id).join(format!("{id}.toml"));
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::env::Environment;
    use std::collections::BTreeMap;

    fn setup(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("hex-env-test-{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    fn sample(id: &str, name: &str) -> Environment {
        let mut variables = BTreeMap::new();
        variables.insert("host".to_string(), "api.dev".to_string());
        Environment {
            id: id.into(),
            name: name.into(),
            variables,
        }
    }

    #[test]
    fn save_then_list_roundtrips() {
        let dir = setup("roundtrip");
        save_environment(&dir, "ws", &sample("e1", "Dev")).unwrap();
        let out = list_environments(&dir, "ws").unwrap();
        assert_eq!(out.environments.len(), 1);
        assert_eq!(out.environments[0].name, "Dev");
        assert_eq!(out.environments[0].variables["host"], "api.dev");
        assert!(out.errors.is_empty());
    }

    #[test]
    fn list_missing_dir_is_empty_not_error() {
        let dir = setup("missing");
        let out = list_environments(&dir, "ws").unwrap();
        assert!(out.environments.is_empty());
        assert!(out.errors.is_empty());
    }

    #[test]
    fn list_reports_error_when_environments_path_is_not_a_directory() {
        // A non-NotFound read_dir failure (here: a file sits where the directory
        // should be) must surface as an error, not be treated as "no environments
        // yet" — otherwise the frontend's empty+no-errors seed guard would fire.
        let dir = setup("not-a-directory");
        let ws_root = dir.join("workspaces").join("ws");
        fs::create_dir_all(&ws_root).unwrap();
        fs::write(ws_root.join("environments"), "not a directory").unwrap();

        let out = list_environments(&dir, "ws").unwrap();

        assert!(out.environments.is_empty());
        assert_eq!(out.errors.len(), 1);
        assert!(out.errors[0].starts_with("environments:"));
    }

    #[test]
    fn list_sorts_by_name_case_insensitive() {
        let dir = setup("sorted");
        save_environment(&dir, "ws", &sample("e1", "staging")).unwrap();
        save_environment(&dir, "ws", &sample("e2", "Dev")).unwrap();
        let names: Vec<String> = list_environments(&dir, "ws")
            .unwrap()
            .environments
            .into_iter()
            .map(|e| e.name)
            .collect();
        assert_eq!(names, vec!["Dev".to_string(), "staging".to_string()]);
    }

    #[test]
    fn corrupt_file_is_reported_and_others_load() {
        let dir = setup("corrupt");
        save_environment(&dir, "ws", &sample("good", "Dev")).unwrap();
        let root = dir.join("workspaces").join("ws").join("environments");
        std::fs::write(root.join("bad.toml"), "not = [valid").unwrap();
        let out = list_environments(&dir, "ws").unwrap();
        assert_eq!(out.environments.len(), 1);
        assert_eq!(out.errors.len(), 1);
        assert!(out.errors[0].starts_with("bad.toml:"));
    }

    #[test]
    fn load_returns_none_for_unknown_id() {
        let dir = setup("load-none");
        assert!(load_environment(&dir, "ws", "nope").unwrap().is_none());
    }

    #[test]
    fn load_returns_saved_environment() {
        let dir = setup("load-some");
        save_environment(&dir, "ws", &sample("e1", "Dev")).unwrap();
        let env = load_environment(&dir, "ws", "e1").unwrap().unwrap();
        assert_eq!(env.id, "e1");
    }

    #[test]
    fn delete_removes_file_and_is_idempotent() {
        let dir = setup("delete");
        save_environment(&dir, "ws", &sample("e1", "Dev")).unwrap();
        delete_environment(&dir, "ws", "e1").unwrap();
        assert!(load_environment(&dir, "ws", "e1").unwrap().is_none());
        delete_environment(&dir, "ws", "e1").unwrap(); // no error second time
    }

    #[test]
    fn rejects_path_traversal_ids() {
        let dir = setup("traversal");
        assert!(save_environment(&dir, "ws", &sample("../evil", "X")).is_err());
        assert!(load_environment(&dir, "..", "e1").is_err());
        assert!(delete_environment(&dir, "ws", "..").is_err());
    }
}
