mod commands;
mod domain;
mod engine;
mod persistence;
mod wsdl;

fn specta_builder() -> tauri_specta::Builder {
    tauri_specta::Builder::<tauri::Wry>::new().commands(tauri_specta::collect_commands![
        commands::list_collections,
        commands::create_collection,
        commands::create_folder,
        commands::create_request,
        commands::rename_node,
        commands::delete_node,
        commands::reorder_children,
        commands::get_request,
        commands::update_request,
        commands::send_request,
        commands::import_wsdl,
        commands::confirm_wsdl_import,
        commands::get_operation_schema,
        commands::send_soap,
        commands::build_soap_envelope,
        commands::send_soap_raw,
        commands::parse_envelope,
        commands::preview_definition_update,
        commands::apply_definition_update,
    ])
}

#[cfg(debug_assertions)]
fn export_bindings(builder: &tauri_specta::Builder) {
    builder
        .export(
            specta_typescript::Typescript::default()
                .bigint(specta_typescript::BigIntExportBehavior::Number)
                // generated file: skip tsc (unused event helpers when no events exist)
                .header("// @ts-nocheck"),
            "../src/bindings.ts",
        )
        .expect("failed to export bindings.ts");
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = specta_builder();
    #[cfg(debug_assertions)]
    export_bindings(&builder);

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .invoke_handler(builder.invoke_handler())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    /// Regenerates src/bindings.ts headlessly (`cargo test export_bindings`),
    /// and fails in CI if any command/type stops being exportable.
    #[test]
    fn export_bindings() {
        super::export_bindings(&super::specta_builder());
    }
}
