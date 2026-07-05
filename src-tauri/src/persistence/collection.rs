use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

// ── Types ────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum CollectionNode {
    Folder {
        id: String,
        name: String,
        children: Vec<CollectionNode>,
    },
    Request {
        id: String,
        name: String,
        #[serde(flatten)]
        kind: RequestKind,
    },
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum RequestKind {
    Rest { method: String, url: String },
    Soap { wsdl_url: String, operation: String },
}

#[derive(Serialize, Deserialize, Default)]
struct RootMeta {
    #[serde(default)]
    children_order: Vec<String>,
}

#[derive(Serialize, Deserialize)]
struct FolderMeta {
    name: String,
    #[serde(default)]
    children_order: Vec<String>,
}

#[derive(Serialize, Deserialize)]
struct RequestFile {
    id: String,
    name: String,
    #[serde(flatten)]
    kind: RequestKind,
}

// ── Path helpers ─────────────────────────────────────────────────────────────

fn collections_root(data_dir: &Path, workspace_id: &str) -> PathBuf {
    data_dir
        .join("workspaces")
        .join(workspace_id)
        .join("collections")
}

fn resolve_path(root: &Path, ids: &[String]) -> PathBuf {
    ids.iter().fold(root.to_path_buf(), |p, id| p.join(id))
}

fn validate_ids(ids: &[String]) -> anyhow::Result<()> {
    for id in ids {
        if id.contains('/') || id.contains('\\') || id == ".." || id == "." {
            anyhow::bail!("invalid id: {}", id);
        }
    }
    Ok(())
}

fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

// ── Meta I/O ─────────────────────────────────────────────────────────────────

fn read_root_meta(root: &Path) -> anyhow::Result<RootMeta> {
    let p = root.join("_meta.toml");
    if !p.exists() {
        return Ok(RootMeta::default());
    }
    Ok(toml::from_str(&std::fs::read_to_string(p)?)?)
}

fn write_root_meta(root: &Path, meta: &RootMeta) -> anyhow::Result<()> {
    std::fs::create_dir_all(root)?;
    std::fs::write(root.join("_meta.toml"), toml::to_string(meta)?)?;
    Ok(())
}

fn read_folder_meta(dir: &Path) -> anyhow::Result<FolderMeta> {
    Ok(toml::from_str(&std::fs::read_to_string(
        dir.join("_meta.toml"),
    )?)?)
}

fn write_folder_meta(dir: &Path, meta: &FolderMeta) -> anyhow::Result<()> {
    std::fs::write(dir.join("_meta.toml"), toml::to_string(meta)?)?;
    Ok(())
}

// ── Tree read ────────────────────────────────────────────────────────────────

fn read_folder_children(dir: &Path, order: &[String]) -> anyhow::Result<Vec<CollectionNode>> {
    let mut nodes = vec![];
    for id in order {
        let subfolder = dir.join(id);
        let req_file = dir.join(format!("{}.toml", id));
        if subfolder.is_dir() {
            let meta = read_folder_meta(&subfolder)?;
            let children = read_folder_children(&subfolder, &meta.children_order)?;
            nodes.push(CollectionNode::Folder {
                id: id.clone(),
                name: meta.name,
                children,
            });
        } else if req_file.exists() {
            let rf: RequestFile = toml::from_str(&std::fs::read_to_string(&req_file)?)?;
            nodes.push(CollectionNode::Request {
                id: rf.id,
                name: rf.name,
                kind: rf.kind,
            });
        }
    }
    Ok(nodes)
}

pub fn list_collections(data_dir: &Path, workspace_id: &str) -> anyhow::Result<Vec<CollectionNode>> {
    let root = collections_root(data_dir, workspace_id);
    let root_meta = read_root_meta(&root)?;
    let mut cols = vec![];
    for id in &root_meta.children_order {
        let col_dir = root.join(id);
        if col_dir.is_dir() {
            let meta = read_folder_meta(&col_dir)?;
            let children = read_folder_children(&col_dir, &meta.children_order)?;
            cols.push(CollectionNode::Folder {
                id: id.clone(),
                name: meta.name,
                children,
            });
        }
    }
    Ok(cols)
}

// ── Mutations ────────────────────────────────────────────────────────────────

pub fn create_collection(data_dir: &Path, workspace_id: &str, name: &str) -> anyhow::Result<CollectionNode> {
    let root = collections_root(data_dir, workspace_id);
    let id = new_id();
    let col_dir = root.join(&id);
    std::fs::create_dir_all(&col_dir)?;
    write_folder_meta(&col_dir, &FolderMeta { name: name.to_string(), children_order: vec![] })?;
    let mut root_meta = read_root_meta(&root)?;
    root_meta.children_order.push(id.clone());
    write_root_meta(&root, &root_meta)?;
    Ok(CollectionNode::Folder { id, name: name.to_string(), children: vec![] })
}

pub fn create_folder(data_dir: &Path, workspace_id: &str, parent_path: Vec<String>, name: &str) -> anyhow::Result<CollectionNode> {
    validate_ids(&parent_path)?;
    let root = collections_root(data_dir, workspace_id);
    let parent_dir = resolve_path(&root, &parent_path);
    let id = new_id();
    let folder_dir = parent_dir.join(&id);
    std::fs::create_dir_all(&folder_dir)?;
    write_folder_meta(&folder_dir, &FolderMeta { name: name.to_string(), children_order: vec![] })?;
    let mut parent_meta = read_folder_meta(&parent_dir)?;
    parent_meta.children_order.push(id.clone());
    write_folder_meta(&parent_dir, &parent_meta)?;
    Ok(CollectionNode::Folder { id, name: name.to_string(), children: vec![] })
}

pub fn create_request(data_dir: &Path, workspace_id: &str, parent_path: Vec<String>, name: &str, kind: RequestKind) -> anyhow::Result<CollectionNode> {
    validate_ids(&parent_path)?;
    let root = collections_root(data_dir, workspace_id);
    let parent_dir = resolve_path(&root, &parent_path);
    let id = new_id();
    let rf = RequestFile { id: id.clone(), name: name.to_string(), kind: kind.clone() };
    std::fs::write(parent_dir.join(format!("{}.toml", id)), toml::to_string(&rf)?)?;
    let mut parent_meta = read_folder_meta(&parent_dir)?;
    parent_meta.children_order.push(id.clone());
    write_folder_meta(&parent_dir, &parent_meta)?;
    Ok(CollectionNode::Request { id, name: name.to_string(), kind })
}

pub fn rename_node(data_dir: &Path, workspace_id: &str, path: Vec<String>, name: &str) -> anyhow::Result<()> {
    validate_ids(&path)?;
    let root = collections_root(data_dir, workspace_id);
    let id = path.last().ok_or_else(|| anyhow::anyhow!("empty path"))?;
    let parent = resolve_path(&root, &path[..path.len() - 1]);
    let as_dir = parent.join(id);
    if as_dir.is_dir() {
        let mut meta = read_folder_meta(&as_dir)?;
        meta.name = name.to_string();
        write_folder_meta(&as_dir, &meta)?;
    } else {
        let req_path = parent.join(format!("{}.toml", id));
        let mut rf: RequestFile = toml::from_str(&std::fs::read_to_string(&req_path)?)?;
        rf.name = name.to_string();
        std::fs::write(req_path, toml::to_string(&rf)?)?;
    }
    Ok(())
}

pub fn delete_node(data_dir: &Path, workspace_id: &str, path: Vec<String>) -> anyhow::Result<()> {
    validate_ids(&path)?;
    let root = collections_root(data_dir, workspace_id);
    let id = path.last().ok_or_else(|| anyhow::anyhow!("empty path"))?;
    if path.len() == 1 {
        std::fs::remove_dir_all(root.join(id))?;
        let mut root_meta = read_root_meta(&root)?;
        root_meta.children_order.retain(|x| x != id);
        write_root_meta(&root, &root_meta)?;
    } else {
        let parent = resolve_path(&root, &path[..path.len() - 1]);
        let as_dir = parent.join(id);
        if as_dir.is_dir() {
            std::fs::remove_dir_all(&as_dir)?;
        } else {
            std::fs::remove_file(parent.join(format!("{}.toml", id)))?;
        }
        let mut meta = read_folder_meta(&parent)?;
        meta.children_order.retain(|x| x != id);
        write_folder_meta(&parent, &meta)?;
    }
    Ok(())
}

pub fn reorder_children(data_dir: &Path, workspace_id: &str, parent_path: Vec<String>, ordered_ids: Vec<String>) -> anyhow::Result<()> {
    validate_ids(&parent_path)?;
    let root = collections_root(data_dir, workspace_id);
    if parent_path.is_empty() {
        let mut meta = read_root_meta(&root)?;
        meta.children_order = ordered_ids;
        write_root_meta(&root, &meta)?;
    } else {
        let parent = resolve_path(&root, &parent_path);
        let mut meta = read_folder_meta(&parent)?;
        meta.children_order = ordered_ids;
        write_folder_meta(&parent, &meta)?;
    }
    Ok(())
}

// ── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn tmp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("hex-test-{}", name));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn list_empty_workspace_returns_empty() {
        let dir = tmp("list-empty");
        let result = list_collections(&dir, "ws1").unwrap();
        assert!(result.is_empty());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn list_with_no_root_meta_returns_empty() {
        let dir = tmp("list-no-meta");
        fs::create_dir_all(dir.join("workspaces/ws1/collections")).unwrap();
        let result = list_collections(&dir, "ws1").unwrap();
        assert!(result.is_empty());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn create_and_list_collection() {
        let dir = tmp("create-col");
        create_collection(&dir, "ws1", "My API").unwrap();
        let cols = list_collections(&dir, "ws1").unwrap();
        assert_eq!(cols.len(), 1);
        let CollectionNode::Folder { name, children, .. } = &cols[0] else {
            panic!("expected folder")
        };
        assert_eq!(name, "My API");
        assert!(children.is_empty());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn create_folder_inside_collection() {
        let dir = tmp("create-folder");
        let col = create_collection(&dir, "ws1", "Root").unwrap();
        let CollectionNode::Folder { id: col_id, .. } = col else { panic!() };
        create_folder(&dir, "ws1", vec![col_id.clone()], "Sub").unwrap();
        let cols = list_collections(&dir, "ws1").unwrap();
        let CollectionNode::Folder { children, .. } = &cols[0] else { panic!() };
        assert_eq!(children.len(), 1);
        let CollectionNode::Folder { name, .. } = &children[0] else { panic!() };
        assert_eq!(name, "Sub");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn create_request_in_collection() {
        let dir = tmp("create-req");
        let col = create_collection(&dir, "ws1", "Root").unwrap();
        let CollectionNode::Folder { id: col_id, .. } = col else { panic!() };
        create_request(
            &dir,
            "ws1",
            vec![col_id.clone()],
            "Get Users",
            RequestKind::Rest { method: "GET".into(), url: "https://example.com/users".into() },
        ).unwrap();
        let cols = list_collections(&dir, "ws1").unwrap();
        let CollectionNode::Folder { children, .. } = &cols[0] else { panic!() };
        assert_eq!(children.len(), 1);
        let CollectionNode::Request { name, kind: RequestKind::Rest { method, .. }, .. } = &children[0] else { panic!() };
        assert_eq!(name, "Get Users");
        assert_eq!(method, "GET");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn rename_collection() {
        let dir = tmp("rename-col");
        let col = create_collection(&dir, "ws1", "Old").unwrap();
        let CollectionNode::Folder { id, .. } = col else { panic!() };
        rename_node(&dir, "ws1", vec![id], "New").unwrap();
        let cols = list_collections(&dir, "ws1").unwrap();
        let CollectionNode::Folder { name, .. } = &cols[0] else { panic!() };
        assert_eq!(name, "New");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn rename_request() {
        let dir = tmp("rename-req");
        let col = create_collection(&dir, "ws1", "Col").unwrap();
        let CollectionNode::Folder { id: col_id, .. } = col else { panic!() };
        let req = create_request(&dir, "ws1", vec![col_id.clone()], "Old", RequestKind::Rest { method: "GET".into(), url: "u".into() }).unwrap();
        let CollectionNode::Request { id: req_id, .. } = req else { panic!() };
        rename_node(&dir, "ws1", vec![col_id, req_id], "New").unwrap();
        let cols = list_collections(&dir, "ws1").unwrap();
        let CollectionNode::Folder { children, .. } = &cols[0] else { panic!() };
        let CollectionNode::Request { name, .. } = &children[0] else { panic!() };
        assert_eq!(name, "New");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn delete_collection() {
        let dir = tmp("delete-col");
        create_collection(&dir, "ws1", "A").unwrap();
        create_collection(&dir, "ws1", "B").unwrap();
        let cols = list_collections(&dir, "ws1").unwrap();
        let CollectionNode::Folder { id: first_id, .. } = &cols[0] else { panic!() };
        let first_id = first_id.clone();
        delete_node(&dir, "ws1", vec![first_id]).unwrap();
        let cols = list_collections(&dir, "ws1").unwrap();
        assert_eq!(cols.len(), 1);
        let CollectionNode::Folder { name, .. } = &cols[0] else { panic!() };
        assert_eq!(name, "B");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn reorder_collections() {
        let dir = tmp("reorder-cols");
        let a = create_collection(&dir, "ws1", "A").unwrap();
        let b = create_collection(&dir, "ws1", "B").unwrap();
        let CollectionNode::Folder { id: a_id, .. } = a else { panic!() };
        let CollectionNode::Folder { id: b_id, .. } = b else { panic!() };
        reorder_children(&dir, "ws1", vec![], vec![b_id.clone(), a_id.clone()]).unwrap();
        let cols = list_collections(&dir, "ws1").unwrap();
        let CollectionNode::Folder { name: n0, .. } = &cols[0] else { panic!() };
        let CollectionNode::Folder { name: n1, .. } = &cols[1] else { panic!() };
        assert_eq!(n0, "B");
        assert_eq!(n1, "A");
        fs::remove_dir_all(dir).unwrap();
    }
}
