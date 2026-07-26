use crate::persistence::collection::{self, CollectionNode, RequestKind};
use tauri::Manager;

fn data_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn list_collections(
    app: tauri::AppHandle,
    workspace_id: String,
) -> Result<Vec<CollectionNode>, String> {
    let dir = data_dir(&app)?;
    collection::list_collections(&dir, &workspace_id).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn create_collection(
    app: tauri::AppHandle,
    workspace_id: String,
    name: String,
) -> Result<CollectionNode, String> {
    let dir = data_dir(&app)?;
    collection::create_collection(&dir, &workspace_id, &name).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
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
#[specta::specta]
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
#[specta::specta]
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
#[specta::specta]
pub fn delete_node(
    app: tauri::AppHandle,
    workspace_id: String,
    path: Vec<String>,
) -> Result<(), String> {
    let dir = data_dir(&app)?;
    collection::delete_node(&dir, &workspace_id, path).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
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
#[specta::specta]
pub fn get_request(
    app: tauri::AppHandle,
    workspace_id: String,
    path: Vec<String>,
) -> Result<collection::RequestFile, String> {
    let dir = data_dir(&app)?;
    collection::get_request(&dir, &workspace_id, path).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
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
#[specta::specta]
pub async fn send_request(
    spec: crate::engine::SendSpec,
) -> Result<crate::engine::HttpResponse, String> {
    crate::engine::send(spec).await
}

use crate::domain::wsdl::{OperationRef, SoapVersion};
use crate::wsdl;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct WsdlImportPreview {
    pub service_name: String,
    pub wsdl_url: String,
    pub operations: Vec<OperationRef>,
}

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())
}

async fn fetch_text(client: &reqwest::Client, url: &str) -> Result<String, String> {
    let resp = client.get(url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    resp.text().await.map_err(|e| e.to_string())
}

/// Shared F2 pipeline: fetch the WSDL, parse it, and resolve the full schema
/// closure up front so failures name WHICH url failed and why — never a
/// silent partial import. Used by import and Update Definition (F6).
async fn fetch_parse_resolve(url: &str) -> Result<wsdl::parse::WsdlDocument, String> {
    let client = http_client()?;
    let fetch = |u: String| {
        let client = client.clone();
        async move { fetch_text(&client, &u).await }
    };
    let xml = fetch(url.to_string()).await.map_err(|message| {
        wsdl::error::WsdlError::Fetch {
            url: url.to_string(),
            message,
        }
        .to_string()
    })?;
    let parsed = wsdl::parse::parse(url, &xml).map_err(|e| e.to_string())?;
    // SchemaSet discarded here: resolve runs to validate the full schema
    // closure up front; get_operation_schema/send_soap rebuild it on demand.
    wsdl::resolve::resolve(url, &xml, fetch)
        .await
        .map_err(|e| e.to_string())?;
    Ok(parsed)
}

#[tauri::command]
#[specta::specta]
pub async fn import_wsdl(url: String) -> Result<WsdlImportPreview, String> {
    let parsed = fetch_parse_resolve(&url).await?;
    Ok(WsdlImportPreview {
        service_name: parsed.service_name,
        wsdl_url: url,
        operations: parsed.operations,
    })
}

use crate::domain::wsdl::{diff_operations, DefinitionDiff};

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DefinitionUpdatePreview {
    pub service_name: String,
    pub wsdl_url: String,
    pub diff: DefinitionDiff,
}

/// Update Definition (product.md F6), preview half: re-fetch the collection's
/// WSDL through the same pipeline as import and diff against what's saved.
#[tauri::command]
#[specta::specta]
pub async fn preview_definition_update(
    app: tauri::AppHandle,
    workspace_id: String,
    collection_id: String,
) -> Result<DefinitionUpdatePreview, String> {
    let dir = data_dir(&app)?;
    let (wsdl_url, current) = collection::soap_snapshot(&dir, &workspace_id, &collection_id)
        .map_err(|e| e.to_string())?;
    let parsed = fetch_parse_resolve(&wsdl_url).await?;
    let diff = diff_operations(&current, &parsed.operations);
    Ok(DefinitionUpdatePreview {
        service_name: parsed.service_name,
        wsdl_url,
        diff,
    })
}

/// Update Definition (product.md F6), apply half: persist a previewed diff.
#[tauri::command]
#[specta::specta]
pub fn apply_definition_update(
    app: tauri::AppHandle,
    workspace_id: String,
    collection_id: String,
    preview: DefinitionUpdatePreview,
) -> Result<(), String> {
    let dir = data_dir(&app)?;
    collection::apply_definition_update(
        &dir,
        &workspace_id,
        &collection_id,
        &preview.wsdl_url,
        &preview.diff,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn confirm_wsdl_import(
    app: tauri::AppHandle,
    workspace_id: String,
    preview: WsdlImportPreview,
) -> Result<(), String> {
    let dir = data_dir(&app)?;
    let col = collection::create_collection(&dir, &workspace_id, &preview.service_name)
        .map_err(|e| e.to_string())?;
    let CollectionNode::Folder { id, .. } = &col else {
        return Err("created collection is not a folder".into());
    };
    for op in &preview.operations {
        let version = match op.soap_version {
            SoapVersion::V11 => "1.1",
            SoapVersion::V12 => "1.2",
        };
        collection::create_request(
            &dir,
            &workspace_id,
            vec![id.clone()],
            &op.name,
            RequestKind::Soap {
                wsdl_url: preview.wsdl_url.clone(),
                operation: op.name.clone(),
                endpoint: Some(op.endpoint.clone()),
                soap_action: Some(op.soap_action.clone()),
                soap_version: Some(version.to_string()),
                input_element: Some(op.input_element.clone()),
                orphan: None,
            },
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

use crate::domain::schema::SchemaNode;
use crate::domain::wsdl::QName;

#[tauri::command]
#[specta::specta]
pub async fn get_operation_schema(
    wsdl_url: String,
    input_element: QName,
) -> Result<SchemaNode, String> {
    let client = http_client()?;
    let fetch = |u: String| {
        let client = client.clone();
        async move { fetch_text(&client, &u).await }
    };

    let root_xml = fetch(wsdl_url.clone()).await.map_err(|message| {
        wsdl::error::WsdlError::Fetch {
            url: wsdl_url.clone(),
            message,
        }
        .to_string()
    })?;
    let set = wsdl::resolve::resolve(&wsdl_url, &root_xml, fetch)
        .await
        .map_err(|e| e.to_string())?;
    wsdl::xsd::build_schema(&set, &input_element).map_err(|e| e.to_string())
}

use crate::domain::value::FormValue;
use crate::engine;

#[tauri::command]
#[specta::specta]
pub async fn send_soap(
    wsdl_url: String,
    input_element: QName,
    endpoint: String,
    soap_action: String,
    soap_version: String,
    value: FormValue,
) -> Result<engine::HttpResponse, String> {
    let client = http_client()?;
    let fetch = |u: String| {
        let client = client.clone();
        async move { fetch_text(&client, &u).await }
    };
    let root_xml = fetch(wsdl_url.clone()).await.map_err(|message| {
        wsdl::error::WsdlError::Fetch {
            url: wsdl_url.clone(),
            message,
        }
        .to_string()
    })?;
    let set = wsdl::resolve::resolve(&wsdl_url, &root_xml, fetch)
        .await
        .map_err(|e| e.to_string())?;
    let schema = wsdl::xsd::build_schema(&set, &input_element).map_err(|e| e.to_string())?;

    let (envelope, meta) =
        engine::serialize::build_envelope(&schema, &value, &soap_version, &soap_action)
            .map_err(|e| e.to_string())?;

    engine::send_soap_envelope(&endpoint, envelope, meta).await
}

/// Serialize the SOAP envelope from the current form value without sending it —
/// backs the request panel's XML preview. Pure: reuses the loaded schema, no I/O.
#[tauri::command]
#[specta::specta]
pub fn build_soap_envelope(
    schema: SchemaNode,
    soap_action: String,
    soap_version: String,
    value: FormValue,
) -> Result<String, String> {
    let (envelope, _meta) =
        engine::serialize::build_envelope(&schema, &value, &soap_version, &soap_action)
            .map_err(|e| e.to_string())?;
    Ok(envelope)
}

/// Parse a hand-edited envelope back into form values, guided by the schema.
/// Errors (non-conforming XML) tell the caller to keep the raw draft instead.
#[tauri::command]
#[specta::specta]
pub fn parse_envelope(envelope: String, schema: SchemaNode) -> Result<FormValue, String> {
    engine::deserialize::parse_envelope(&schema, &envelope).map_err(|e| e.to_string())
}

/// Send a raw SOAP envelope edited by hand in the XML view, bypassing the form
/// serializer. Transport metadata still follows the selected SOAP version.
#[tauri::command]
#[specta::specta]
pub async fn send_soap_raw(
    endpoint: String,
    envelope: String,
    soap_action: String,
    soap_version: String,
) -> Result<engine::HttpResponse, String> {
    let meta = engine::serialize::soap_meta(&soap_version, &soap_action);
    engine::send_soap_envelope(&endpoint, envelope, meta).await
}
