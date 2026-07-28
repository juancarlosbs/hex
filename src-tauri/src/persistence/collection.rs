use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

// ── Types ────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone, specta::Type)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum CollectionNode {
    Folder {
        id: String,
        name: String,
        children: Vec<CollectionNode>,
    },
    // Newtype variant (not inline fields): specta rc.22 drops `#[serde(flatten)]`
    // inside enum struct-variants, but exports struct flatten as an intersection.
    Request(RequestNode),
}

#[derive(Debug, Serialize, Deserialize, Clone, specta::Type)]
pub struct RequestNode {
    pub id: String,
    pub name: String,
    #[serde(flatten)]
    pub kind: RequestKind,
}

#[derive(Debug, Serialize, Deserialize, Clone, specta::Type)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum RequestKind {
    Rest {
        method: String,
        url: String,
    },
    #[serde(rename_all = "camelCase")]
    Soap {
        wsdl_url: String,
        operation: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        endpoint: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        soap_action: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        soap_version: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        input_element: Option<crate::domain::wsdl::QName>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        orphan: Option<bool>,
    },
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

#[derive(Debug, Serialize, Deserialize, Clone, specta::Type)]
pub struct KeyValueEntry {
    pub id: String,
    pub key: String,
    pub value: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "type")]
    pub entry_type: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, specta::Type)]
pub struct BodyData {
    pub mode: String,
    pub json: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub form: Vec<KeyValueEntry>,
}

#[derive(Debug, Serialize, Deserialize, Clone, specta::Type)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum AuthData {
    None,
    Basic {
        username: String,
        password: String,
    },
    Bearer {
        token: String,
    },
    #[serde(rename_all = "camelCase")]
    Apikey {
        key: String,
        value: String,
        add_to: String,
    },
}

#[derive(Debug, Serialize, Deserialize, Clone, specta::Type)]
pub struct RequestFile {
    pub id: String,
    pub name: String,
    #[serde(flatten)]
    pub kind: RequestKind,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub params: Vec<KeyValueEntry>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub headers: Vec<KeyValueEntry>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body: Option<BodyData>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auth: Option<AuthData>,
}

#[derive(Debug, Deserialize, Clone, specta::Type)]
pub struct RequestContent {
    #[serde(flatten)]
    pub kind: RequestKind,
    #[serde(default)]
    pub params: Vec<KeyValueEntry>,
    #[serde(default)]
    pub headers: Vec<KeyValueEntry>,
    #[serde(default)]
    pub body: Option<BodyData>,
    #[serde(default)]
    pub auth: Option<AuthData>,
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

pub(crate) fn validate_ids(ids: &[String]) -> anyhow::Result<()> {
    for id in ids {
        if id.contains('/') || id.contains('\\') || id == ".." || id == "." {
            anyhow::bail!("invalid id: {id}");
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
        let req_file = dir.join(format!("{id}.toml"));
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
            nodes.push(CollectionNode::Request(RequestNode {
                id: rf.id,
                name: rf.name,
                kind: rf.kind,
            }));
        }
    }
    Ok(nodes)
}

pub fn list_collections(
    data_dir: &Path,
    workspace_id: &str,
) -> anyhow::Result<Vec<CollectionNode>> {
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

pub fn create_collection(
    data_dir: &Path,
    workspace_id: &str,
    name: &str,
) -> anyhow::Result<CollectionNode> {
    let root = collections_root(data_dir, workspace_id);
    let id = new_id();
    let col_dir = root.join(&id);
    std::fs::create_dir_all(&col_dir)?;
    write_folder_meta(
        &col_dir,
        &FolderMeta {
            name: name.to_string(),
            children_order: vec![],
        },
    )?;
    let mut root_meta = read_root_meta(&root)?;
    root_meta.children_order.push(id.clone());
    write_root_meta(&root, &root_meta)?;
    Ok(CollectionNode::Folder {
        id,
        name: name.to_string(),
        children: vec![],
    })
}

pub fn create_folder(
    data_dir: &Path,
    workspace_id: &str,
    parent_path: Vec<String>,
    name: &str,
) -> anyhow::Result<CollectionNode> {
    validate_ids(&parent_path)?;
    let root = collections_root(data_dir, workspace_id);
    let parent_dir = resolve_path(&root, &parent_path);
    let id = new_id();
    let folder_dir = parent_dir.join(&id);
    std::fs::create_dir_all(&folder_dir)?;
    write_folder_meta(
        &folder_dir,
        &FolderMeta {
            name: name.to_string(),
            children_order: vec![],
        },
    )?;
    let mut parent_meta = read_folder_meta(&parent_dir)?;
    parent_meta.children_order.push(id.clone());
    write_folder_meta(&parent_dir, &parent_meta)?;
    Ok(CollectionNode::Folder {
        id,
        name: name.to_string(),
        children: vec![],
    })
}

pub fn create_request(
    data_dir: &Path,
    workspace_id: &str,
    parent_path: Vec<String>,
    name: &str,
    kind: RequestKind,
) -> anyhow::Result<CollectionNode> {
    validate_ids(&parent_path)?;
    let root = collections_root(data_dir, workspace_id);
    let parent_dir = resolve_path(&root, &parent_path);
    let id = new_id();
    let rf = RequestFile {
        id: id.clone(),
        name: name.to_string(),
        kind: kind.clone(),
        params: vec![],
        headers: vec![],
        body: None,
        auth: None,
    };
    std::fs::write(parent_dir.join(format!("{id}.toml")), toml::to_string(&rf)?)?;
    let mut parent_meta = read_folder_meta(&parent_dir)?;
    parent_meta.children_order.push(id.clone());
    write_folder_meta(&parent_dir, &parent_meta)?;
    Ok(CollectionNode::Request(RequestNode {
        id,
        name: name.to_string(),
        kind,
    }))
}

fn request_file_path(root: &Path, path: &[String]) -> anyhow::Result<PathBuf> {
    let id = path.last().ok_or_else(|| anyhow::anyhow!("empty path"))?;
    let parent = resolve_path(root, &path[..path.len() - 1]);
    Ok(parent.join(format!("{id}.toml")))
}

pub fn get_request(
    data_dir: &Path,
    workspace_id: &str,
    path: Vec<String>,
) -> anyhow::Result<RequestFile> {
    validate_ids(&path)?;
    let root = collections_root(data_dir, workspace_id);
    let file = request_file_path(&root, &path)?;
    Ok(toml::from_str(&std::fs::read_to_string(file)?)?)
}

pub fn update_request(
    data_dir: &Path,
    workspace_id: &str,
    path: Vec<String>,
    content: RequestContent,
) -> anyhow::Result<()> {
    validate_ids(&path)?;
    let root = collections_root(data_dir, workspace_id);
    let file = request_file_path(&root, &path)?;
    // read first so `name` (owned by rename_node) is never clobbered by a stale save
    let mut rf: RequestFile = toml::from_str(&std::fs::read_to_string(&file)?)?;
    rf.kind = content.kind;
    rf.params = content.params;
    rf.headers = content.headers;
    rf.body = content.body;
    rf.auth = content.auth;
    std::fs::write(file, toml::to_string(&rf)?)?;
    Ok(())
}

pub fn rename_node(
    data_dir: &Path,
    workspace_id: &str,
    path: Vec<String>,
    name: &str,
) -> anyhow::Result<()> {
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
        let req_path = parent.join(format!("{id}.toml"));
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
            std::fs::remove_file(parent.join(format!("{id}.toml")))?;
        }
        let mut meta = read_folder_meta(&parent)?;
        meta.children_order.retain(|x| x != id);
        write_folder_meta(&parent, &meta)?;
    }
    Ok(())
}

fn insert_after(order: &mut Vec<String>, after: &str, id: String) {
    let pos = order
        .iter()
        .position(|x| x == after)
        .map(|i| i + 1)
        .unwrap_or(order.len());
    order.insert(pos, id);
}

fn copy_folder_recursive(
    src: &Path,
    dest_parent: &Path,
    top: bool,
) -> anyhow::Result<(String, CollectionNode)> {
    let meta = read_folder_meta(src)?;
    let id = new_id();
    let name = if top {
        format!("{} copy", meta.name)
    } else {
        meta.name.clone()
    };
    let dest = dest_parent.join(&id);
    std::fs::create_dir_all(&dest)?;
    let mut new_order = vec![];
    let mut children = vec![];
    for child_id in &meta.children_order {
        let child_dir = src.join(child_id);
        let child_file = src.join(format!("{child_id}.toml"));
        if child_dir.is_dir() {
            let (cid, cnode) = copy_folder_recursive(&child_dir, &dest, false)?;
            new_order.push(cid);
            children.push(cnode);
        } else if child_file.exists() {
            let mut rf: RequestFile = toml::from_str(&std::fs::read_to_string(&child_file)?)?;
            let cid = new_id();
            rf.id = cid.clone();
            std::fs::write(dest.join(format!("{cid}.toml")), toml::to_string(&rf)?)?;
            new_order.push(cid.clone());
            children.push(CollectionNode::Request(RequestNode {
                id: cid,
                name: rf.name,
                kind: rf.kind,
            }));
        }
    }
    write_folder_meta(
        &dest,
        &FolderMeta {
            name: name.clone(),
            children_order: new_order,
        },
    )?;
    Ok((id.clone(), CollectionNode::Folder { id, name, children }))
}

pub fn duplicate_node(
    data_dir: &Path,
    workspace_id: &str,
    path: Vec<String>,
) -> anyhow::Result<CollectionNode> {
    validate_ids(&path)?;
    let root = collections_root(data_dir, workspace_id);
    let orig_id = path.last().ok_or_else(|| anyhow::anyhow!("empty path"))?;
    let parent = resolve_path(&root, &path[..path.len() - 1]);
    let as_dir = parent.join(orig_id);

    let (new_id, node) = if as_dir.is_dir() {
        copy_folder_recursive(&as_dir, &parent, true)?
    } else {
        let file = parent.join(format!("{orig_id}.toml"));
        let mut rf: RequestFile = toml::from_str(&std::fs::read_to_string(&file)?)?;
        let id = self::new_id();
        rf.id = id.clone();
        rf.name = format!("{} copy", rf.name);
        std::fs::write(parent.join(format!("{id}.toml")), toml::to_string(&rf)?)?;
        let node = CollectionNode::Request(RequestNode {
            id: id.clone(),
            name: rf.name,
            kind: rf.kind,
        });
        (id, node)
    };

    if path.len() == 1 {
        let mut meta = read_root_meta(&root)?;
        insert_after(&mut meta.children_order, orig_id, new_id);
        write_root_meta(&root, &meta)?;
    } else {
        let mut meta = read_folder_meta(&parent)?;
        insert_after(&mut meta.children_order, orig_id, new_id);
        write_folder_meta(&parent, &meta)?;
    }
    Ok(node)
}

pub fn reorder_children(
    data_dir: &Path,
    workspace_id: &str,
    parent_path: Vec<String>,
    ordered_ids: Vec<String>,
) -> anyhow::Result<()> {
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

// ── F6 Update Definition ─────────────────────────────────────────────────────

use crate::domain::wsdl::{DefinitionDiff, OperationRef, QName, SoapVersion};

const ORPHANS_FOLDER_NAME: &str = "Orphans";

fn soap_version_str(v: SoapVersion) -> &'static str {
    match v {
        SoapVersion::V11 => "1.1",
        SoapVersion::V12 => "1.2",
    }
}

/// RequestKind for a fresh operation. Also used to refresh a stale request's
/// metadata: everything the WSDL owns comes from `op`, orphan is cleared.
pub fn soap_kind(wsdl_url: &str, op: &OperationRef) -> RequestKind {
    RequestKind::Soap {
        wsdl_url: wsdl_url.to_string(),
        operation: op.name.clone(),
        endpoint: Some(op.endpoint.clone()),
        soap_action: Some(op.soap_action.clone()),
        soap_version: Some(soap_version_str(op.soap_version).to_string()),
        input_element: Some(op.input_element.clone()),
        orphan: None,
    }
}

/// OperationRef as saved on disk. Missing optional metadata (pre-slice files)
/// becomes empty defaults so the diff flags the operation as changed.
fn saved_operation_ref(kind: &RequestKind) -> Option<OperationRef> {
    let RequestKind::Soap {
        operation,
        endpoint,
        soap_action,
        soap_version,
        input_element,
        ..
    } = kind
    else {
        return None;
    };
    Some(OperationRef {
        name: operation.clone(),
        endpoint: endpoint.clone().unwrap_or_default(),
        soap_action: soap_action.clone().unwrap_or_default(),
        soap_version: match soap_version.as_deref() {
            Some("1.2") => SoapVersion::V12,
            _ => SoapVersion::V11,
        },
        input_element: input_element.clone().unwrap_or(QName {
            namespace: String::new(),
            local: String::new(),
        }),
    })
}

/// Recursively collect SOAP requests under `dir` as (id path relative to the
/// collection root, file). `skip` omits one direct child of the root (Orphans).
fn collect_soap_requests(
    dir: &Path,
    prefix: &[String],
    skip: Option<&str>,
) -> anyhow::Result<Vec<(Vec<String>, RequestFile)>> {
    let meta = read_folder_meta(dir)?;
    let mut out = vec![];
    for id in &meta.children_order {
        if prefix.is_empty() && Some(id.as_str()) == skip {
            continue;
        }
        let path: Vec<String> = prefix.iter().cloned().chain([id.clone()]).collect();
        let sub = dir.join(id);
        let file = dir.join(format!("{id}.toml"));
        if sub.is_dir() {
            out.extend(collect_soap_requests(&sub, &path, None)?);
        } else if file.exists() {
            let rf: RequestFile = toml::from_str(&std::fs::read_to_string(&file)?)?;
            if matches!(rf.kind, RequestKind::Soap { .. }) {
                out.push((path, rf));
            }
        }
    }
    Ok(out)
}

fn find_by_operation<'a>(
    reqs: &'a [(Vec<String>, RequestFile)],
    name: &str,
) -> Option<&'a (Vec<String>, RequestFile)> {
    reqs.iter().find(
        |(_, rf)| matches!(&rf.kind, RequestKind::Soap { operation, .. } if operation == name),
    )
}

fn find_orphans_folder(col_dir: &Path) -> anyhow::Result<Option<String>> {
    let meta = read_folder_meta(col_dir)?;
    for id in &meta.children_order {
        let sub = col_dir.join(id);
        if sub.is_dir() && read_folder_meta(&sub)?.name == ORPHANS_FOLDER_NAME {
            return Ok(Some(id.clone()));
        }
    }
    Ok(None)
}

/// Move a request file to another folder of the same collection, rewriting it
/// with `rf` and keeping both children_order metas consistent.
fn move_request(
    col_dir: &Path,
    from: &[String],
    to_folder: &[String],
    rf: &RequestFile,
) -> anyhow::Result<()> {
    let id = from.last().ok_or_else(|| anyhow::anyhow!("empty path"))?;
    let from_dir = resolve_path(col_dir, &from[..from.len() - 1]);
    let to_dir = resolve_path(col_dir, to_folder);
    std::fs::write(to_dir.join(format!("{id}.toml")), toml::to_string(rf)?)?;
    if from_dir != to_dir {
        std::fs::remove_file(from_dir.join(format!("{id}.toml")))?;
        let mut m = read_folder_meta(&from_dir)?;
        m.children_order.retain(|x| x != id);
        write_folder_meta(&from_dir, &m)?;
        let mut m = read_folder_meta(&to_dir)?;
        m.children_order.push(id.clone());
        write_folder_meta(&to_dir, &m)?;
    }
    Ok(())
}

/// wsdl_url + saved operation snapshot of an imported collection. Requests in
/// the Orphans folder don't count as current operations.
pub fn soap_snapshot(
    data_dir: &Path,
    workspace_id: &str,
    collection_id: &str,
) -> anyhow::Result<(String, Vec<OperationRef>)> {
    validate_ids(&[collection_id.to_string()])?;
    let col_dir = collections_root(data_dir, workspace_id).join(collection_id);
    let orphans = find_orphans_folder(&col_dir)?;
    let reqs = collect_soap_requests(&col_dir, &[], orphans.as_deref())?;
    let wsdl_url = match reqs.iter().find_map(|(_, rf)| match &rf.kind {
        RequestKind::Soap { wsdl_url, .. } => Some(wsdl_url.clone()),
        _ => None,
    }) {
        Some(url) => url,
        // Every operation is orphaned: fall back to the Orphans folder so the
        // collection can still be re-synced instead of dead-ending.
        None => orphans
            .as_deref()
            .map(|oid| collect_soap_requests(&col_dir.join(oid), &[oid.to_string()], None))
            .transpose()?
            .into_iter()
            .flatten()
            .find_map(|(_, rf)| match &rf.kind {
                RequestKind::Soap { wsdl_url, .. } => Some(wsdl_url.clone()),
                _ => None,
            })
            .ok_or_else(|| anyhow::anyhow!("collection has no SOAP requests"))?,
    };
    let ops = reqs
        .iter()
        .filter_map(|(_, rf)| saved_operation_ref(&rf.kind))
        .collect();
    Ok((wsdl_url, ops))
}

/// Apply a previewed diff: create new requests (restoring matching orphans),
/// refresh changed metadata in place, and move removed operations into the
/// Orphans folder — never delete (product.md F6).
pub fn apply_definition_update(
    data_dir: &Path,
    workspace_id: &str,
    collection_id: &str,
    wsdl_url: &str,
    diff: &DefinitionDiff,
) -> anyhow::Result<()> {
    validate_ids(&[collection_id.to_string()])?;
    let col_dir = collections_root(data_dir, workspace_id).join(collection_id);
    let mut orphans_id = find_orphans_folder(&col_dir)?;

    // Removed → Orphans (folder created on first use) + orphan flag.
    if !diff.removed.is_empty() {
        let oid = match &orphans_id {
            Some(id) => id.clone(),
            None => {
                let CollectionNode::Folder { id, .. } = create_folder(
                    data_dir,
                    workspace_id,
                    vec![collection_id.to_string()],
                    ORPHANS_FOLDER_NAME,
                )?
                else {
                    anyhow::bail!("create_folder did not return a folder");
                };
                orphans_id = Some(id.clone());
                id
            }
        };
        let current = collect_soap_requests(&col_dir, &[], Some(&oid))?;
        for name in &diff.removed {
            let Some((path, rf)) = find_by_operation(&current, name) else {
                continue; // already moved or hand-deleted; nothing to orphan
            };
            let mut rf = rf.clone();
            if let RequestKind::Soap { orphan, .. } = &mut rf.kind {
                *orphan = Some(true);
            }
            move_request(&col_dir, path, &[oid.clone()], &rf)?;
        }
    }

    // New → restore a matching orphan, else create at the collection root.
    let live = collect_soap_requests(&col_dir, &[], orphans_id.as_deref())?;
    for op in &diff.new {
        // Guard against a stale/duplicate diff: skip if already live.
        if find_by_operation(&live, &op.name).is_some() {
            continue;
        }
        let restored = if let Some(oid) = &orphans_id {
            let orphaned = collect_soap_requests(&col_dir.join(oid), &[oid.clone()], None)?;
            match find_by_operation(&orphaned, &op.name) {
                Some((path, rf)) => {
                    let mut rf = rf.clone();
                    rf.kind = soap_kind(wsdl_url, op);
                    move_request(&col_dir, path, &[], &rf)?;
                    true
                }
                None => false,
            }
        } else {
            false
        };
        if !restored {
            create_request(
                data_dir,
                workspace_id,
                vec![collection_id.to_string()],
                &op.name,
                soap_kind(wsdl_url, op),
            )?;
        }
    }

    // Changed → refresh metadata in place, wherever the request lives.
    let current = collect_soap_requests(&col_dir, &[], orphans_id.as_deref())?;
    for op in &diff.changed {
        let Some((path, rf)) = find_by_operation(&current, &op.name) else {
            continue;
        };
        let mut rf = rf.clone();
        rf.kind = soap_kind(wsdl_url, op);
        let parent = resolve_path(&col_dir, &path[..path.len() - 1]);
        std::fs::write(
            parent.join(format!("{}.toml", rf.id)),
            toml::to_string(&rf)?,
        )?;
    }

    Ok(())
}

pub fn move_node(
    data_dir: &Path,
    workspace_id: &str,
    from_path: Vec<String>,
    to_parent_path: Vec<String>,
    index: usize,
) -> anyhow::Result<()> {
    validate_ids(&from_path)?;
    validate_ids(&to_parent_path)?;
    let id = from_path
        .last()
        .ok_or_else(|| anyhow::anyhow!("empty path"))?
        .clone();
    if from_path.len() == 1 {
        anyhow::bail!("cannot move a root collection");
    }
    if to_parent_path.is_empty() {
        anyhow::bail!("cannot move a node to the root level");
    }
    if to_parent_path.starts_with(&from_path) {
        anyhow::bail!("cannot move a folder into itself or a descendant");
    }

    let root = collections_root(data_dir, workspace_id);
    let from_parent = resolve_path(&root, &from_path[..from_path.len() - 1]);
    let to_parent = resolve_path(&root, &to_parent_path);
    if !to_parent.is_dir() {
        anyhow::bail!("destination folder does not exist");
    }

    let src_dir = from_parent.join(&id);
    let (src, dst) = if src_dir.is_dir() {
        (src_dir, to_parent.join(&id))
    } else {
        (
            from_parent.join(format!("{id}.toml")),
            to_parent.join(format!("{id}.toml")),
        )
    };

    if from_parent == to_parent {
        // same parent: just reposition within children_order
        let mut meta = read_folder_meta(&to_parent)?;
        meta.children_order.retain(|x| x != &id);
        let idx = index.min(meta.children_order.len());
        meta.children_order.insert(idx, id);
        write_folder_meta(&to_parent, &meta)?;
        return Ok(());
    }

    // Crash-safe ordering: insert into the destination meta, then rename the
    // file/dir, then remove from the source meta. Every intermediate crash
    // state renders the node exactly once — a dangling meta entry pointing at
    // a not-yet-renamed file is harmlessly skipped by `read_folder_children`.
    let mut to_meta = read_folder_meta(&to_parent)?;
    let idx = index.min(to_meta.children_order.len());
    to_meta.children_order.insert(idx, id.clone());
    write_folder_meta(&to_parent, &to_meta)?;

    std::fs::rename(&src, &dst)?;

    let mut from_meta = read_folder_meta(&from_parent)?;
    from_meta.children_order.retain(|x| x != &id);
    write_folder_meta(&from_parent, &from_meta)?;
    Ok(())
}

// ── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn tmp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("hex-test-{name}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn request_node_json_flattens_kind_into_the_node() {
        // The frontend (and bindings.ts) depend on this wire shape: `kind`'s
        // fields inlined next to `type`/`id`/`name`, never nested under "kind".
        let node = CollectionNode::Request(RequestNode {
            id: "1".into(),
            name: "r".into(),
            kind: RequestKind::Rest {
                method: "GET".into(),
                url: "u".into(),
            },
        });
        let json = serde_json::to_value(&node).unwrap();
        assert_eq!(json["type"], "request");
        assert_eq!(json["kind"], "rest");
        assert_eq!(json["method"], "GET");
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
        let CollectionNode::Folder { id: col_id, .. } = col else {
            panic!()
        };
        create_folder(&dir, "ws1", vec![col_id.clone()], "Sub").unwrap();
        let cols = list_collections(&dir, "ws1").unwrap();
        let CollectionNode::Folder { children, .. } = &cols[0] else {
            panic!()
        };
        assert_eq!(children.len(), 1);
        let CollectionNode::Folder { name, .. } = &children[0] else {
            panic!()
        };
        assert_eq!(name, "Sub");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn create_request_in_collection() {
        let dir = tmp("create-req");
        let col = create_collection(&dir, "ws1", "Root").unwrap();
        let CollectionNode::Folder { id: col_id, .. } = col else {
            panic!()
        };
        create_request(
            &dir,
            "ws1",
            vec![col_id.clone()],
            "Get Users",
            RequestKind::Rest {
                method: "GET".into(),
                url: "https://example.com/users".into(),
            },
        )
        .unwrap();
        let cols = list_collections(&dir, "ws1").unwrap();
        let CollectionNode::Folder { children, .. } = &cols[0] else {
            panic!()
        };
        assert_eq!(children.len(), 1);
        let CollectionNode::Request(RequestNode {
            name,
            kind: RequestKind::Rest { method, .. },
            ..
        }) = &children[0]
        else {
            panic!()
        };
        assert_eq!(name, "Get Users");
        assert_eq!(method, "GET");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn rename_collection() {
        let dir = tmp("rename-col");
        let col = create_collection(&dir, "ws1", "Old").unwrap();
        let CollectionNode::Folder { id, .. } = col else {
            panic!()
        };
        rename_node(&dir, "ws1", vec![id], "New").unwrap();
        let cols = list_collections(&dir, "ws1").unwrap();
        let CollectionNode::Folder { name, .. } = &cols[0] else {
            panic!()
        };
        assert_eq!(name, "New");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn rename_request() {
        let dir = tmp("rename-req");
        let col = create_collection(&dir, "ws1", "Col").unwrap();
        let CollectionNode::Folder { id: col_id, .. } = col else {
            panic!()
        };
        let req = create_request(
            &dir,
            "ws1",
            vec![col_id.clone()],
            "Old",
            RequestKind::Rest {
                method: "GET".into(),
                url: "u".into(),
            },
        )
        .unwrap();
        let CollectionNode::Request(RequestNode { id: req_id, .. }) = req else {
            panic!()
        };
        rename_node(&dir, "ws1", vec![col_id, req_id], "New").unwrap();
        let cols = list_collections(&dir, "ws1").unwrap();
        let CollectionNode::Folder { children, .. } = &cols[0] else {
            panic!()
        };
        let CollectionNode::Request(RequestNode { name, .. }) = &children[0] else {
            panic!()
        };
        assert_eq!(name, "New");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn delete_collection() {
        let dir = tmp("delete-col");
        create_collection(&dir, "ws1", "A").unwrap();
        create_collection(&dir, "ws1", "B").unwrap();
        let cols = list_collections(&dir, "ws1").unwrap();
        let CollectionNode::Folder { id: first_id, .. } = &cols[0] else {
            panic!()
        };
        let first_id = first_id.clone();
        delete_node(&dir, "ws1", vec![first_id]).unwrap();
        let cols = list_collections(&dir, "ws1").unwrap();
        assert_eq!(cols.len(), 1);
        let CollectionNode::Folder { name, .. } = &cols[0] else {
            panic!()
        };
        assert_eq!(name, "B");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn reorder_collections() {
        let dir = tmp("reorder-cols");
        let a = create_collection(&dir, "ws1", "A").unwrap();
        let b = create_collection(&dir, "ws1", "B").unwrap();
        let CollectionNode::Folder { id: a_id, .. } = a else {
            panic!()
        };
        let CollectionNode::Folder { id: b_id, .. } = b else {
            panic!()
        };
        reorder_children(&dir, "ws1", vec![], vec![b_id.clone(), a_id.clone()]).unwrap();
        let cols = list_collections(&dir, "ws1").unwrap();
        let CollectionNode::Folder { name: n0, .. } = &cols[0] else {
            panic!()
        };
        let CollectionNode::Folder { name: n1, .. } = &cols[1] else {
            panic!()
        };
        assert_eq!(n0, "B");
        assert_eq!(n1, "A");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn update_and_get_request_roundtrip() {
        let dir = tmp("update-req");
        let col = create_collection(&dir, "ws1", "Col").unwrap();
        let CollectionNode::Folder { id: col_id, .. } = col else {
            panic!()
        };
        let req = create_request(
            &dir,
            "ws1",
            vec![col_id.clone()],
            "Get Users",
            RequestKind::Rest {
                method: "GET".into(),
                url: "".into(),
            },
        )
        .unwrap();
        let CollectionNode::Request(RequestNode { id: req_id, .. }) = req else {
            panic!()
        };
        let path = vec![col_id, req_id];

        let content = RequestContent {
            kind: RequestKind::Rest {
                method: "POST".into(),
                url: "https://api.dev/users".into(),
            },
            params: vec![KeyValueEntry {
                id: "p1".into(),
                key: "page".into(),
                value: "1".into(),
                description: None,
                enabled: true,
                entry_type: None,
            }],
            headers: vec![],
            body: Some(BodyData {
                mode: "json".into(),
                json: "{\"a\":1}".into(),
                form: vec![],
            }),
            auth: Some(AuthData::Bearer {
                token: "tok".into(),
            }),
        };
        update_request(&dir, "ws1", path.clone(), content).unwrap();

        let rf = get_request(&dir, "ws1", path).unwrap();
        // name must be preserved (update_request never touches it)
        assert_eq!(rf.name, "Get Users");
        let RequestKind::Rest { method, url } = &rf.kind else {
            panic!()
        };
        assert_eq!(method, "POST");
        assert_eq!(url, "https://api.dev/users");
        assert_eq!(rf.params.len(), 1);
        assert_eq!(rf.params[0].key, "page");
        assert!(rf.headers.is_empty());
        assert_eq!(rf.body.as_ref().unwrap().json, "{\"a\":1}");
        assert!(matches!(rf.auth, Some(AuthData::Bearer { .. })));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn get_request_on_minimal_file_defaults_empty() {
        // create_request writes the pre-existing minimal shape (no content fields)
        let dir = tmp("get-minimal");
        let col = create_collection(&dir, "ws1", "Col").unwrap();
        let CollectionNode::Folder { id: col_id, .. } = col else {
            panic!()
        };
        let req = create_request(
            &dir,
            "ws1",
            vec![col_id.clone()],
            "Old",
            RequestKind::Rest {
                method: "GET".into(),
                url: "u".into(),
            },
        )
        .unwrap();
        let CollectionNode::Request(RequestNode { id: req_id, .. }) = req else {
            panic!()
        };

        let rf = get_request(&dir, "ws1", vec![col_id, req_id]).unwrap();
        assert!(rf.params.is_empty());
        assert!(rf.headers.is_empty());
        assert!(rf.body.is_none());
        assert!(rf.auth.is_none());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn soap_request_roundtrips_metadata_and_old_files_still_load() {
        let dir = tmp("soap-roundtrip");
        create_collection(&dir, "w1", "Calc").unwrap();
        let col_id = match &list_collections(&dir, "w1").unwrap()[0] {
            CollectionNode::Folder { id, .. } => id.clone(),
            _ => panic!("expected folder"),
        };
        let kind = RequestKind::Soap {
            wsdl_url: "http://x/svc?wsdl".into(),
            operation: "Add".into(),
            endpoint: Some("http://x/svc".into()),
            soap_action: Some("http://x/Add".into()),
            soap_version: Some("1.1".into()),
            input_element: Some(crate::domain::wsdl::QName {
                namespace: "http://x/ns".into(),
                local: "Add".into(),
            }),
            orphan: None,
        };
        let node = create_request(&dir, "w1", vec![col_id.clone()], "Add", kind).unwrap();
        let CollectionNode::Request(RequestNode { id, .. }) = &node else {
            panic!("expected request")
        };
        let rf = get_request(&dir, "w1", vec![col_id, id.clone()]).unwrap();
        match rf.kind {
            RequestKind::Soap {
                soap_version,
                input_element,
                ..
            } => {
                assert_eq!(soap_version.as_deref(), Some("1.1"));
                assert_eq!(input_element.unwrap().local, "Add");
            }
            _ => panic!("expected soap"),
        }
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn soap_file_without_metadata_still_deserializes() {
        // pre-slice-1 file shape: only wsdlUrl + operation
        let json =
            r#"{"id":"r1","name":"Old","kind":"soap","wsdlUrl":"http://x?wsdl","operation":"Op"}"#;
        let rf: RequestFile = serde_json::from_str(json).unwrap();
        assert!(matches!(rf.kind, RequestKind::Soap { endpoint: None, .. }));
    }

    use crate::domain::wsdl::{DefinitionDiff, OperationRef, QName, SoapVersion};

    fn fresh_op(name: &str, endpoint: &str) -> OperationRef {
        OperationRef {
            name: name.into(),
            endpoint: endpoint.into(),
            soap_action: format!("http://x/{name}"),
            soap_version: SoapVersion::V11,
            input_element: QName {
                namespace: "http://x/ns".into(),
                local: name.into(),
            },
        }
    }

    fn empty_diff() -> DefinitionDiff {
        DefinitionDiff {
            new: vec![],
            changed: vec![],
            removed: vec![],
            unchanged: 0,
        }
    }

    /// Import a service with the given ops; returns the collection id.
    fn import_service(dir: &Path, ops: &[OperationRef]) -> String {
        let col = create_collection(dir, "w1", "Svc").unwrap();
        let CollectionNode::Folder { id, .. } = col else {
            panic!()
        };
        for op in ops {
            create_request(
                dir,
                "w1",
                vec![id.clone()],
                &op.name,
                soap_kind("http://x?wsdl", op),
            )
            .unwrap();
        }
        id
    }

    /// (request display name, kind) for every SOAP request directly under `path`.
    fn soap_children_at(dir: &Path, path: &[String]) -> Vec<(String, RequestKind)> {
        let nodes = list_collections(dir, "w1").unwrap();
        let mut cur = nodes;
        for id in path {
            cur = cur
                .into_iter()
                .find_map(|n| match n {
                    CollectionNode::Folder {
                        id: fid, children, ..
                    } if &fid == id => Some(children),
                    _ => None,
                })
                .unwrap();
        }
        cur.into_iter()
            .filter_map(|n| match n {
                CollectionNode::Request(r) if matches!(r.kind, RequestKind::Soap { .. }) => {
                    Some((r.name, r.kind))
                }
                _ => None,
            })
            .collect()
    }

    /// Id of the Orphans folder inside the collection, if present.
    fn orphans_folder_id(dir: &Path, col_id: &str) -> Option<String> {
        let nodes = list_collections(dir, "w1").unwrap();
        let children = nodes.into_iter().find_map(|n| match n {
            CollectionNode::Folder { id, children, .. } if id == col_id => Some(children),
            _ => None,
        })?;
        children.into_iter().find_map(|n| match n {
            CollectionNode::Folder { id, name, .. } if name == "Orphans" => Some(id),
            _ => None,
        })
    }

    #[test]
    fn snapshot_returns_wsdl_url_and_current_ops_excluding_orphans() {
        let dir = tmp("f6-snapshot");
        let col = import_service(
            &dir,
            &[
                fresh_op("Add", "http://x/svc"),
                fresh_op("Sub", "http://x/svc"),
            ],
        );
        // orphan "Sub" first so the snapshot must skip it
        let diff = DefinitionDiff {
            removed: vec!["Sub".into()],
            ..empty_diff()
        };
        apply_definition_update(&dir, "w1", &col, "http://x?wsdl", &diff).unwrap();

        let (url, ops) = soap_snapshot(&dir, "w1", &col).unwrap();
        assert_eq!(url, "http://x?wsdl");
        assert_eq!(ops.len(), 1);
        assert_eq!(ops[0].name, "Add");
    }

    #[test]
    fn snapshot_falls_back_to_orphans_wsdl_url_when_fully_orphaned() {
        let dir = tmp("f6-snapshot-fully-orphaned");
        let col = import_service(
            &dir,
            &[
                fresh_op("Add", "http://x/svc"),
                fresh_op("Sub", "http://x/svc"),
            ],
        );
        let diff = DefinitionDiff {
            removed: vec!["Add".into(), "Sub".into()],
            ..empty_diff()
        };
        apply_definition_update(&dir, "w1", &col, "http://x?wsdl", &diff).unwrap();

        let (url, ops) = soap_snapshot(&dir, "w1", &col).unwrap();
        assert_eq!(url, "http://x?wsdl");
        assert!(ops.is_empty());
    }

    #[test]
    fn apply_creates_requests_for_new_operations() {
        let dir = tmp("f6-new");
        let col = import_service(&dir, &[fresh_op("Add", "http://x/svc")]);
        let diff = DefinitionDiff {
            new: vec![fresh_op("Mul", "http://x/svc")],
            ..empty_diff()
        };
        apply_definition_update(&dir, "w1", &col, "http://x?wsdl", &diff).unwrap();

        let children = soap_children_at(&dir, &[col.clone()]);
        assert_eq!(children.len(), 2);
        assert!(children.iter().any(|(n, _)| n == "Mul"));
    }

    #[test]
    fn apply_moves_removed_operations_to_orphans_folder() {
        let dir = tmp("f6-orphan");
        let col = import_service(
            &dir,
            &[
                fresh_op("Add", "http://x/svc"),
                fresh_op("Sub", "http://x/svc"),
            ],
        );
        let diff = DefinitionDiff {
            removed: vec!["Sub".into()],
            ..empty_diff()
        };
        apply_definition_update(&dir, "w1", &col, "http://x?wsdl", &diff).unwrap();

        // gone from the collection root
        let root_children = soap_children_at(&dir, &[col.clone()]);
        assert_eq!(
            root_children.len(),
            1,
            "orphaned request must leave the root, never be deleted"
        );
        // present in Orphans with the flag set
        let orphans = orphans_folder_id(&dir, &col).expect("Orphans folder created");
        let orphaned = soap_children_at(&dir, &[col.clone(), orphans]);
        assert_eq!(orphaned.len(), 1);
        assert!(matches!(
            &orphaned[0].1,
            RequestKind::Soap {
                orphan: Some(true),
                ..
            }
        ));
    }

    #[test]
    fn apply_refreshes_changed_metadata_preserving_user_data() {
        let dir = tmp("f6-changed");
        let col = import_service(&dir, &[fresh_op("Add", "http://x/svc")]);
        // save user data on the request
        let nodes = list_collections(&dir, "w1").unwrap();
        let CollectionNode::Folder { children, .. } = &nodes[0] else {
            panic!()
        };
        let CollectionNode::Request(req) = children[0].clone() else {
            panic!()
        };
        update_request(
            &dir,
            "w1",
            vec![col.clone(), req.id.clone()],
            RequestContent {
                kind: req.kind.clone(),
                params: vec![],
                headers: vec![KeyValueEntry {
                    id: "h1".into(),
                    key: "X-Trace".into(),
                    value: "on".into(),
                    description: None,
                    enabled: true,
                    entry_type: None,
                }],
                body: None,
                auth: None,
            },
        )
        .unwrap();

        let diff = DefinitionDiff {
            changed: vec![fresh_op("Add", "http://x/v2/svc")],
            ..empty_diff()
        };
        apply_definition_update(&dir, "w1", &col, "http://x?wsdl", &diff).unwrap();

        let rf = get_request(&dir, "w1", vec![col.clone(), req.id]).unwrap();
        let RequestKind::Soap { endpoint, .. } = &rf.kind else {
            panic!()
        };
        assert_eq!(endpoint.as_deref(), Some("http://x/v2/svc"));
        assert_eq!(
            rf.headers.len(),
            1,
            "user headers must survive a metadata refresh"
        );
    }

    #[test]
    fn apply_restores_an_orphan_when_its_operation_returns() {
        let dir = tmp("f6-unorphan");
        let col = import_service(
            &dir,
            &[
                fresh_op("Add", "http://x/svc"),
                fresh_op("Sub", "http://x/svc"),
            ],
        );
        let remove = DefinitionDiff {
            removed: vec!["Sub".into()],
            ..empty_diff()
        };
        apply_definition_update(&dir, "w1", &col, "http://x?wsdl", &remove).unwrap();

        let back = DefinitionDiff {
            new: vec![fresh_op("Sub", "http://x/svc")],
            ..empty_diff()
        };
        apply_definition_update(&dir, "w1", &col, "http://x?wsdl", &back).unwrap();

        let root_children = soap_children_at(&dir, &[col.clone()]);
        assert_eq!(root_children.len(), 2, "restored, not duplicated");
        let sub = root_children.iter().find(|(n, _)| n == "Sub").unwrap();
        assert!(matches!(&sub.1, RequestKind::Soap { orphan: None, .. }));
        let orphans = orphans_folder_id(&dir, &col).unwrap();
        assert!(soap_children_at(&dir, &[col.clone(), orphans]).is_empty());
    }

    #[test]
    fn apply_new_is_idempotent_against_a_stale_diff() {
        let dir = tmp("f6-new-stale");
        let col = import_service(&dir, &[fresh_op("Add", "http://x/svc")]);
        let diff = DefinitionDiff {
            new: vec![fresh_op("Mul", "http://x/svc")],
            ..empty_diff()
        };
        apply_definition_update(&dir, "w1", &col, "http://x?wsdl", &diff).unwrap();
        // Re-applying the same (now stale) diff must not create a duplicate.
        apply_definition_update(&dir, "w1", &col, "http://x?wsdl", &diff).unwrap();

        let children = soap_children_at(&dir, &[col.clone()]);
        assert_eq!(children.len(), 2);
        assert!(children.iter().any(|(n, _)| n == "Mul"));
    }

    // ── move_node ────────────────────────────────────────────────────────────

    /// col with two folders: A (containing one GET request) and B (empty).
    /// Returns (dir, col_id, a_id, b_id, req_id).
    fn setup_two_folders(name: &str) -> (PathBuf, String, String, String, String) {
        let dir = tmp(name);
        let col = create_collection(&dir, "ws1", "Col").unwrap();
        let CollectionNode::Folder { id: col_id, .. } = col else {
            panic!()
        };
        let a = create_folder(&dir, "ws1", vec![col_id.clone()], "A").unwrap();
        let CollectionNode::Folder { id: a_id, .. } = a else {
            panic!()
        };
        let b = create_folder(&dir, "ws1", vec![col_id.clone()], "B").unwrap();
        let CollectionNode::Folder { id: b_id, .. } = b else {
            panic!()
        };
        let req = create_request(
            &dir,
            "ws1",
            vec![col_id.clone(), a_id.clone()],
            "R",
            RequestKind::Rest {
                method: "GET".into(),
                url: "u".into(),
            },
        )
        .unwrap();
        let CollectionNode::Request(RequestNode { id: req_id, .. }) = req else {
            panic!()
        };
        (dir, col_id, a_id, b_id, req_id)
    }

    /// Children of the collection's folder named `folder_name`.
    fn folder_children(dir: &Path, col_id: &str, folder_id: &str) -> Vec<CollectionNode> {
        let cols = list_collections(dir, "ws1").unwrap();
        let CollectionNode::Folder { children, id, .. } = &cols[0] else {
            panic!()
        };
        assert_eq!(id, col_id);
        for c in children {
            if let CollectionNode::Folder { id, children, .. } = c {
                if id == folder_id {
                    return children.clone();
                }
            }
        }
        panic!("folder {folder_id} not found");
    }

    #[test]
    fn move_request_across_folders() {
        let (dir, col_id, a_id, b_id, req_id) = setup_two_folders("move-req");
        move_node(
            &dir,
            "ws1",
            vec![col_id.clone(), a_id.clone(), req_id.clone()],
            vec![col_id.clone(), b_id.clone()],
            0,
        )
        .unwrap();
        assert!(folder_children(&dir, &col_id, &a_id).is_empty());
        let b_children = folder_children(&dir, &col_id, &b_id);
        assert_eq!(b_children.len(), 1);
        let CollectionNode::Request(RequestNode { id, .. }) = &b_children[0] else {
            panic!()
        };
        assert_eq!(id, &req_id);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn move_folder_with_children_across() {
        // move folder A (which contains the request) into folder B
        let (dir, col_id, a_id, b_id, req_id) = setup_two_folders("move-folder");
        move_node(
            &dir,
            "ws1",
            vec![col_id.clone(), a_id.clone()],
            vec![col_id.clone(), b_id.clone()],
            0,
        )
        .unwrap();
        let b_children = folder_children(&dir, &col_id, &b_id);
        assert_eq!(b_children.len(), 1);
        let CollectionNode::Folder { id, children, .. } = &b_children[0] else {
            panic!()
        };
        assert_eq!(id, &a_id);
        let CollectionNode::Request(RequestNode { id: rid, .. }) = &children[0] else {
            panic!()
        };
        assert_eq!(rid, &req_id);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn move_into_own_descendant_is_rejected() {
        // B into A is fine; then A into A/B must fail
        let (dir, col_id, a_id, b_id, _req_id) = setup_two_folders("move-cycle");
        move_node(
            &dir,
            "ws1",
            vec![col_id.clone(), b_id.clone()],
            vec![col_id.clone(), a_id.clone()],
            0,
        )
        .unwrap();
        let err = move_node(
            &dir,
            "ws1",
            vec![col_id.clone(), a_id.clone()],
            vec![col_id.clone(), a_id.clone(), b_id.clone()],
            0,
        );
        assert!(err.is_err());
        // also: a folder into itself
        let err = move_node(
            &dir,
            "ws1",
            vec![col_id.clone(), a_id.clone()],
            vec![col_id.clone(), a_id.clone()],
            0,
        );
        assert!(err.is_err());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn move_root_collection_is_rejected() {
        let (dir, col_id, a_id, _b_id, _req_id) = setup_two_folders("move-root");
        assert!(move_node(
            &dir,
            "ws1",
            vec![col_id.clone()],
            vec![col_id.clone(), a_id],
            0
        )
        .is_err());
        // and nothing may land at root
        let (dir2, col_id2, a_id2, _b, _r) = setup_two_folders("move-to-root");
        assert!(move_node(&dir2, "ws1", vec![col_id2, a_id2], vec![], 0).is_err());
        fs::remove_dir_all(dir).unwrap();
        fs::remove_dir_all(dir2).unwrap();
    }

    #[test]
    fn move_with_out_of_range_index_appends() {
        let (dir, col_id, a_id, b_id, req_id) = setup_two_folders("move-clamp");
        move_node(
            &dir,
            "ws1",
            vec![col_id.clone(), a_id.clone(), req_id.clone()],
            vec![col_id.clone(), b_id.clone()],
            99,
        )
        .unwrap();
        let b_children = folder_children(&dir, &col_id, &b_id);
        assert_eq!(b_children.len(), 1);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn move_into_nonexistent_destination_is_rejected_and_leaves_source_intact() {
        let (dir, col_id, a_id, _b_id, req_id) = setup_two_folders("move-no-dest");
        let err = move_node(
            &dir,
            "ws1",
            vec![col_id.clone(), a_id.clone(), req_id.clone()],
            vec![col_id.clone(), "does-not-exist".into()],
            0,
        );
        assert!(err.is_err());
        let a_children = folder_children(&dir, &col_id, &a_id);
        assert_eq!(a_children.len(), 1);
        let CollectionNode::Request(RequestNode { id, .. }) = &a_children[0] else {
            panic!()
        };
        assert_eq!(id, &req_id);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn move_inserts_at_exact_index() {
        // B gets a request of its own first; then move A's request to B at index 0
        let (dir, col_id, a_id, b_id, req_id) = setup_two_folders("move-index");
        let existing = create_request(
            &dir,
            "ws1",
            vec![col_id.clone(), b_id.clone()],
            "Existing",
            RequestKind::Rest {
                method: "GET".into(),
                url: "u".into(),
            },
        )
        .unwrap();
        let CollectionNode::Request(RequestNode {
            id: existing_id, ..
        }) = existing
        else {
            panic!()
        };
        move_node(
            &dir,
            "ws1",
            vec![col_id.clone(), a_id, req_id.clone()],
            vec![col_id.clone(), b_id.clone()],
            0,
        )
        .unwrap();
        let b_children = folder_children(&dir, &col_id, &b_id);
        let ids: Vec<&str> = b_children
            .iter()
            .map(|n| match n {
                CollectionNode::Request(RequestNode { id, .. }) => id.as_str(),
                CollectionNode::Folder { id, .. } => id.as_str(),
            })
            .collect();
        assert_eq!(ids, vec![req_id.as_str(), existing_id.as_str()]);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn duplicate_request_inserts_copy_after_original() {
        let dir = tmp("dup-request");
        let col = create_collection(&dir, "ws1", "Col").unwrap();
        let CollectionNode::Folder { id: col_id, .. } = col else {
            panic!()
        };
        let a = create_request(
            &dir,
            "ws1",
            vec![col_id.clone()],
            "A",
            RequestKind::Rest {
                method: "GET".into(),
                url: "http://a".into(),
            },
        )
        .unwrap();
        let CollectionNode::Request(RequestNode { id: a_id, .. }) = a else {
            panic!()
        };
        create_request(
            &dir,
            "ws1",
            vec![col_id.clone()],
            "B",
            RequestKind::Rest {
                method: "GET".into(),
                url: "http://b".into(),
            },
        )
        .unwrap();

        let copy = duplicate_node(&dir, "ws1", vec![col_id.clone(), a_id.clone()]).unwrap();
        let CollectionNode::Request(RequestNode {
            id: copy_id,
            name: copy_name,
            kind: RequestKind::Rest { url, .. },
        }) = copy
        else {
            panic!()
        };
        assert_eq!(copy_name, "A copy");
        assert_ne!(copy_id, a_id);
        assert_eq!(url, "http://a");

        // order on disk: A, A copy, B
        let cols = list_collections(&dir, "ws1").unwrap();
        let CollectionNode::Folder { children, .. } = &cols[0] else {
            panic!()
        };
        let names: Vec<_> = children
            .iter()
            .map(|n| match n {
                CollectionNode::Request(r) => r.name.clone(),
                CollectionNode::Folder { name, .. } => name.clone(),
            })
            .collect();
        assert_eq!(names, vec!["A", "A copy", "B"]);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn duplicate_folder_recursively_with_fresh_ids() {
        let dir = tmp("dup-folder");
        let col = create_collection(&dir, "ws1", "Col").unwrap();
        let CollectionNode::Folder { id: col_id, .. } = col else {
            panic!()
        };
        let f = create_folder(&dir, "ws1", vec![col_id.clone()], "F").unwrap();
        let CollectionNode::Folder { id: f_id, .. } = f else {
            panic!()
        };
        let r = create_request(
            &dir,
            "ws1",
            vec![col_id.clone(), f_id.clone()],
            "R",
            RequestKind::Rest {
                method: "GET".into(),
                url: "http://r".into(),
            },
        )
        .unwrap();
        let CollectionNode::Request(RequestNode { id: r_id, .. }) = r else {
            panic!()
        };

        let copy = duplicate_node(&dir, "ws1", vec![col_id.clone(), f_id.clone()]).unwrap();
        let CollectionNode::Folder {
            id: copy_id,
            name: copy_name,
            children,
        } = copy
        else {
            panic!()
        };
        assert_eq!(copy_name, "F copy");
        assert_ne!(copy_id, f_id);
        // child keeps its name but gets a fresh id
        let CollectionNode::Request(RequestNode {
            id: child_id,
            name: child_name,
            ..
        }) = &children[0]
        else {
            panic!()
        };
        assert_eq!(child_name, "R");
        assert_ne!(child_id, &r_id);

        // fs round-trip agrees
        let cols = list_collections(&dir, "ws1").unwrap();
        let CollectionNode::Folder { children, .. } = &cols[0] else {
            panic!()
        };
        assert_eq!(children.len(), 2);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn duplicate_collection_at_root() {
        let dir = tmp("dup-collection");
        let a = create_collection(&dir, "ws1", "A").unwrap();
        let CollectionNode::Folder { id: a_id, .. } = a else {
            panic!()
        };
        create_collection(&dir, "ws1", "B").unwrap();

        duplicate_node(&dir, "ws1", vec![a_id]).unwrap();

        let cols = list_collections(&dir, "ws1").unwrap();
        let names: Vec<_> = cols
            .iter()
            .map(|n| match n {
                CollectionNode::Folder { name, .. } => name.clone(),
                _ => panic!(),
            })
            .collect();
        assert_eq!(names, vec!["A", "A copy", "B"]);
        fs::remove_dir_all(dir).unwrap();
    }
}
