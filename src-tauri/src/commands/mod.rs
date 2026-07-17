use crate::persistence::collection::{self, CollectionNode, RequestKind};
use tauri::Manager;

fn data_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_collections(
    app: tauri::AppHandle,
    workspace_id: String,
) -> Result<Vec<CollectionNode>, String> {
    let dir = data_dir(&app)?;
    collection::list_collections(&dir, &workspace_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_collection(
    app: tauri::AppHandle,
    workspace_id: String,
    name: String,
) -> Result<CollectionNode, String> {
    let dir = data_dir(&app)?;
    collection::create_collection(&dir, &workspace_id, &name).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_folder(
    app: tauri::AppHandle,
    workspace_id: String,
    parent_path: Vec<String>,
    name: String,
) -> Result<CollectionNode, String> {
    let dir = data_dir(&app)?;
    collection::create_folder(&dir, &workspace_id, parent_path, &name).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_request(
    app: tauri::AppHandle,
    workspace_id: String,
    parent_path: Vec<String>,
    name: String,
    kind: RequestKind,
) -> Result<CollectionNode, String> {
    let dir = data_dir(&app)?;
    collection::create_request(&dir, &workspace_id, parent_path, &name, kind)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn rename_node(
    app: tauri::AppHandle,
    workspace_id: String,
    path: Vec<String>,
    name: String,
) -> Result<(), String> {
    let dir = data_dir(&app)?;
    collection::rename_node(&dir, &workspace_id, path, &name).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_node(
    app: tauri::AppHandle,
    workspace_id: String,
    path: Vec<String>,
) -> Result<(), String> {
    let dir = data_dir(&app)?;
    collection::delete_node(&dir, &workspace_id, path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn reorder_children(
    app: tauri::AppHandle,
    workspace_id: String,
    parent_path: Vec<String>,
    ordered_ids: Vec<String>,
) -> Result<(), String> {
    let dir = data_dir(&app)?;
    collection::reorder_children(&dir, &workspace_id, parent_path, ordered_ids)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_request(
    app: tauri::AppHandle,
    workspace_id: String,
    path: Vec<String>,
) -> Result<collection::RequestFile, String> {
    let dir = data_dir(&app)?;
    collection::get_request(&dir, &workspace_id, path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_request(
    app: tauri::AppHandle,
    workspace_id: String,
    path: Vec<String>,
    content: collection::RequestContent,
) -> Result<(), String> {
    let dir = data_dir(&app)?;
    collection::update_request(&dir, &workspace_id, path, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn send_request(
    spec: crate::engine::SendSpec,
) -> Result<crate::engine::HttpResponse, String> {
    crate::engine::send(spec).await
}
