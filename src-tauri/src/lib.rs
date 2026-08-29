mod auth;
mod commands;
mod library;

use library::Library;
use tauri::Manager;
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            match Library::init(app.handle()) {
                Ok(lib) => {
                    app.manage(lib);
                }
                Err(error) => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.hide();
                    }
                    let handle = app.handle().clone();
                    app.dialog()
                        .message(error)
                        .title("NookSpace 无法打开资料库")
                        .kind(MessageDialogKind::Error)
                        .show(move |_| handle.exit(1));
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_lock_session,
            commands::unlock_protected_content,
            commands::lock_now,
            commands::set_items_locked,
            commands::set_items_private,
            commands::set_collection_locked,
            commands::get_library_info,
            commands::list_items,
            commands::list_saved_views,
            commands::create_saved_view,
            commands::rename_saved_view,
            commands::delete_saved_view,
            commands::get_search_index_status,
            commands::index_pending_pdfs,
            commands::backup_library,
            commands::export_library,
            commands::move_library,
            commands::use_existing_library,
            commands::restart_app,
            commands::get_item,
            commands::export_item,
            commands::create_note,
            commands::rename_file,
            commands::create_link,
            commands::delete_items,
            commands::restore_items,
            commands::empty_trash,
            commands::purge_items,
            commands::set_favorite,
            commands::touch_item,
            commands::list_collections,
            commands::create_collection,
            commands::rename_collection,
            commands::move_collection,
            commands::delete_collection_tree,
            commands::add_items_to_collection,
            commands::remove_items_from_collection,
            commands::list_tags,
            commands::create_tag,
            commands::rename_tag,
            commands::set_tag_color,
            commands::delete_tag,
            commands::set_item_tags,
            commands::add_attachments,
            commands::remove_attachment,
            commands::import_files,
            commands::open_with_default,
            commands::quicklook,
            commands::generate_thumbnail,
            commands::read_text_file,
            commands::write_text_file,
            commands::file_abs_path,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
