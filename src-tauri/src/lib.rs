mod commands;
mod domain;
mod engine;
mod persistence;
mod wsdl;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
