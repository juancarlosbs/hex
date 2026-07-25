use crate::domain::env::Environment;
use std::path::{Path, PathBuf};

// One TOML file per environment (git-friendly, ADR-011), mirroring collections.

fn envs_root(data_dir: &Path, workspace_id: &str) -> PathBuf {
    data_dir
        .join("workspaces")
        .join(workspace_id)
        .join("environments")
}

fn validate_id(id: &str) -> anyhow::Result<()> {
    if id.is_empty() || id.contains('/') || id.contains('\\') || id == ".." || id == "." {
        anyhow::bail!("invalid id: {id}");
    }
    Ok(())
}

pub fn list_environments(data_dir: &Path, workspace_id: &str) -> anyhow::Result<Vec<Environment>> {
    let root = envs_root(data_dir, workspace_id);
    if !root.is_dir() {
        return Ok(vec![]);
    }
    let mut envs = vec![];
    for entry in std::fs::read_dir(root)? {
        let path = entry?.path();
        if path.extension().is_some_and(|e| e == "toml") {
            envs.push(toml::from_str(&std::fs::read_to_string(path)?)?);
        }
    }
    // read_dir order is platform-dependent; sort by name for a stable list
    envs.sort_by(|a: &Environment, b: &Environment| a.name.cmp(&b.name));
    Ok(envs)
}

/// Creates or overwrites the environment file (upsert by id).
pub fn save_environment(
    data_dir: &Path,
    workspace_id: &str,
    env: &Environment,
) -> anyhow::Result<()> {
    validate_id(&env.id)?;
    let root = envs_root(data_dir, workspace_id);
    std::fs::create_dir_all(&root)?;
    std::fs::write(root.join(format!("{}.toml", env.id)), toml::to_string(env)?)?;
    Ok(())
}

pub fn delete_environment(data_dir: &Path, workspace_id: &str, id: &str) -> anyhow::Result<()> {
    validate_id(id)?;
    let file = envs_root(data_dir, workspace_id).join(format!("{id}.toml"));
    if file.exists() {
        std::fs::remove_file(file)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;
    use std::fs;

    fn tmp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("hex-env-test-{name}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn env(id: &str, name: &str, pairs: &[(&str, &str)]) -> Environment {
        Environment {
            id: id.into(),
            name: name.into(),
            variables: pairs
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect::<BTreeMap<_, _>>(),
        }
    }

    #[test]
    fn list_without_dir_returns_empty() {
        let dir = tmp("list-empty");
        assert!(list_environments(&dir, "ws1").unwrap().is_empty());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn save_list_roundtrip_sorted_by_name() {
        let dir = tmp("roundtrip");
        save_environment(&dir, "ws1", &env("s", "Staging", &[("host", "s.api")])).unwrap();
        save_environment(&dir, "ws1", &env("d", "Development", &[("host", "d.api")])).unwrap();
        let envs = list_environments(&dir, "ws1").unwrap();
        assert_eq!(envs.len(), 2);
        assert_eq!(envs[0].name, "Development");
        assert_eq!(envs[0].variables.get("host").unwrap(), "d.api");
        assert_eq!(envs[1].name, "Staging");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn save_overwrites_existing_id() {
        let dir = tmp("upsert");
        save_environment(&dir, "ws1", &env("d", "Dev", &[])).unwrap();
        save_environment(&dir, "ws1", &env("d", "Dev", &[("a", "1")])).unwrap();
        let envs = list_environments(&dir, "ws1").unwrap();
        assert_eq!(envs.len(), 1);
        assert_eq!(envs[0].variables.get("a").unwrap(), "1");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn delete_removes_the_file_and_is_idempotent() {
        let dir = tmp("delete");
        save_environment(&dir, "ws1", &env("d", "Dev", &[])).unwrap();
        delete_environment(&dir, "ws1", "d").unwrap();
        delete_environment(&dir, "ws1", "d").unwrap();
        assert!(list_environments(&dir, "ws1").unwrap().is_empty());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn rejects_path_traversal_ids() {
        let dir = tmp("traversal");
        assert!(save_environment(&dir, "ws1", &env("../evil", "X", &[])).is_err());
        assert!(delete_environment(&dir, "ws1", "..").is_err());
        fs::remove_dir_all(dir).unwrap();
    }
}
