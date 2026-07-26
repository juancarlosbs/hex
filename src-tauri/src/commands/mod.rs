use crate::persistence::collection::{self, CollectionNode, RequestKind};
use tauri::Manager;

fn data_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

/// Best-effort history append — a history failure must never fail the send.
/// The SQLite write runs off the send path (spawn_blocking, fire-and-forget)
/// so it can never add latency to the response the user is waiting on.
fn record_history(
    app: &tauri::AppHandle,
    request_id: Option<String>,
    spec: crate::persistence::history::HistorySpec,
    result: &Result<crate::engine::HttpResponse, String>,
) {
    let Some(request_id) = request_id else { return };
    let Ok(dir) = data_dir(app) else { return };
    let result = result.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if let Err(e) =
            crate::persistence::history::append(&dir.join("history.db"), &request_id, spec, &result)
        {
            eprintln!("history: append failed for {request_id}: {e:#}");
        }
    });
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
pub fn duplicate_node(
    app: tauri::AppHandle,
    workspace_id: String,
    path: Vec<String>,
) -> Result<CollectionNode, String> {
    let dir = data_dir(&app)?;
    collection::duplicate_node(&dir, &workspace_id, path).map_err(|e| e.to_string())
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

/// Approach B (spec): the send receives an environment id and loads it from disk —
/// disk is the source of truth even if the frontend is stale. With no active
/// environment we interpolate against an empty one, so any {{var}} fails loud;
/// the returned bool flags that "no environment selected" case (as opposed to a
/// stale/unknown id, which fails here instead) so callers can hint at the titlebar.
fn resolve_environment(
    app: &tauri::AppHandle,
    workspace_id: &str,
    environment_id: Option<String>,
) -> Result<(Environment, bool), String> {
    let Some(id) = environment_id else {
        return Ok((
            Environment {
                id: String::new(),
                name: String::new(),
                variables: Default::default(),
            },
            true,
        ));
    };
    let dir = data_dir(app)?;
    let environment = crate::persistence::environment::load_environment(&dir, workspace_id, &id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("environment not found: {id}"))?;
    Ok((environment, false))
}

/// Appends a hint to an interpolation error when no environment was active at
/// all (spec: "no active env" row of the error table) — points at the titlebar
/// selector instead of leaving the user guessing why an otherwise-valid {{var}} failed.
fn with_env_hint(error: String, no_environment_selected: bool) -> String {
    if no_environment_selected {
        format!("{error} — no environment selected; choose one in the titlebar")
    } else {
        error
    }
}

#[tauri::command]
#[specta::specta]
pub async fn send_request(
    app: tauri::AppHandle,
    workspace_id: String,
    environment_id: Option<String>,
    mut spec: crate::engine::SendSpec,
    request_id: Option<String>,
) -> Result<crate::engine::HttpResponse, String> {
    // Snapshot before interpolation: history stores the raw {{var}} form so
    // Restore round-trips the editor draft and env secrets stay out of the DB.
    let snapshot = crate::persistence::history::HistorySpec::Rest { spec: spec.clone() };
    let (environment, no_env) = resolve_environment(&app, &workspace_id, environment_id)?;
    crate::engine::apply_env(&mut spec, &environment).map_err(|e| with_env_hint(e, no_env))?;
    let result = crate::engine::send(spec).await;
    record_history(&app, request_id, snapshot, &result);
    result
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

#[tauri::command]
#[specta::specta]
pub async fn import_wsdl(url: String) -> Result<WsdlImportPreview, String> {
    let client = http_client()?;
    let fetch = |u: String| {
        let client = client.clone();
        async move { fetch_text(&client, &u).await }
    };

    let xml = fetch(url.clone()).await.map_err(|message| {
        wsdl::error::WsdlError::Fetch {
            url: url.clone(),
            message,
        }
        .to_string()
    })?;
    let parsed = wsdl::parse::parse(&url, &xml).map_err(|e| e.to_string())?;
    // SchemaSet discarded in slice 1: resolve runs to validate the full schema
    // closure up front; slice 2 (xsd -> SchemaNode) consumes it.
    wsdl::resolve::resolve(&url, &xml, fetch)
        .await
        .map_err(|e| e.to_string())?;

    Ok(WsdlImportPreview {
        service_name: parsed.service_name,
        wsdl_url: url,
        operations: parsed.operations,
    })
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
#[allow(clippy::too_many_arguments)]
pub async fn send_soap(
    app: tauri::AppHandle,
    workspace_id: String,
    environment_id: Option<String>,
    wsdl_url: String,
    input_element: QName,
    endpoint: String,
    soap_action: String,
    soap_version: String,
    value: FormValue,
    request_id: Option<String>,
) -> Result<engine::HttpResponse, String> {
    // Snapshot before interpolation: history stores the raw {{var}} form so
    // Restore round-trips the editor draft and env secrets stay out of the DB.
    let snapshot = crate::persistence::history::HistorySpec::Soap {
        wsdl_url: wsdl_url.clone(),
        input_element: input_element.clone(),
        endpoint: endpoint.clone(),
        soap_action: soap_action.clone(),
        soap_version: soap_version.clone(),
        value: value.clone(),
    };
    let (environment, no_env) = resolve_environment(&app, &workspace_id, environment_id)?;

    // Interpolate first: none of these need the schema, so an unknown {{var}}
    // fails before the WSDL fetch — zero network activity (spec row 1/2).
    let endpoint = crate::domain::env::interpolate(&endpoint, &environment)
        .map_err(|e| with_env_hint(format!("{e} in endpoint"), no_env))?;
    let soap_action = crate::domain::env::interpolate(&soap_action, &environment)
        .map_err(|e| with_env_hint(format!("{e} in SOAPAction"), no_env))?;
    let value = crate::domain::env::interpolate_form_value(&value, &environment)
        .map_err(|e| with_env_hint(format!("{e} in form value"), no_env))?;

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

    let result = engine::send_soap_envelope(&endpoint, envelope, meta).await;
    record_history(&app, request_id, snapshot, &result);
    result
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
#[allow(clippy::too_many_arguments)]
pub async fn send_soap_raw(
    app: tauri::AppHandle,
    workspace_id: String,
    environment_id: Option<String>,
    endpoint: String,
    envelope: String,
    soap_action: String,
    soap_version: String,
    request_id: Option<String>,
) -> Result<engine::HttpResponse, String> {
    // Snapshot before interpolation: history stores the raw {{var}} form so
    // Restore round-trips the editor draft and env secrets stay out of the DB.
    let snapshot = crate::persistence::history::HistorySpec::SoapRaw {
        endpoint: endpoint.clone(),
        envelope: envelope.clone(),
        soap_action: soap_action.clone(),
        soap_version: soap_version.clone(),
    };
    let (environment, no_env) = resolve_environment(&app, &workspace_id, environment_id)?;
    let endpoint = crate::domain::env::interpolate(&endpoint, &environment)
        .map_err(|e| with_env_hint(format!("{e} in endpoint"), no_env))?;
    let soap_action = crate::domain::env::interpolate(&soap_action, &environment)
        .map_err(|e| with_env_hint(format!("{e} in SOAPAction"), no_env))?;
    let envelope = crate::domain::env::interpolate(&envelope, &environment)
        .map_err(|e| with_env_hint(format!("{e} in envelope"), no_env))?;

    let meta = engine::serialize::soap_meta(&soap_version, &soap_action);
    let result = engine::send_soap_envelope(&endpoint, envelope, meta).await;
    record_history(&app, request_id, snapshot, &result);
    result
}

#[tauri::command]
#[specta::specta]
pub fn list_history(
    app: tauri::AppHandle,
    request_id: String,
) -> Result<Vec<crate::persistence::history::HistoryEntrySummary>, String> {
    let dir = data_dir(&app)?;
    crate::persistence::history::list(&dir.join("history.db"), &request_id)
        .map_err(|e| e.to_string())
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
    crate::persistence::history::clear(&dir.join("history.db"), &request_id)
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::with_env_hint;

    #[test]
    fn with_env_hint_appends_hint_when_no_environment_selected() {
        let msg = with_env_hint("undefined variable: {{host}} in URL".to_string(), true);
        assert_eq!(
            msg,
            "undefined variable: {{host}} in URL — no environment selected; choose one in the titlebar"
        );
    }

    #[test]
    fn with_env_hint_leaves_message_unchanged_when_environment_selected() {
        let msg = with_env_hint("undefined variable: {{host}} in URL".to_string(), false);
        assert_eq!(msg, "undefined variable: {{host}} in URL");
    }
}

use crate::domain::env::Environment;
use crate::persistence::environment as env_store;

#[tauri::command]
#[specta::specta]
pub fn list_environments(
    app: tauri::AppHandle,
    workspace_id: String,
) -> Result<env_store::EnvironmentList, String> {
    let dir = data_dir(&app)?;
    env_store::list_environments(&dir, &workspace_id).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn save_environment(
    app: tauri::AppHandle,
    workspace_id: String,
    environment: Environment,
) -> Result<(), String> {
    let dir = data_dir(&app)?;
    env_store::save_environment(&dir, &workspace_id, &environment).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn delete_environment(
    app: tauri::AppHandle,
    workspace_id: String,
    id: String,
) -> Result<(), String> {
    let dir = data_dir(&app)?;
    env_store::delete_environment(&dir, &workspace_id, &id).map_err(|e| e.to_string())
}
