mod commands;
mod library;

use library::Library;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let lib = Library::init(app.handle()).map_err(std::io::Error::other)?;
            app.manage(lib);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_library_info,
            commands::list_items,
            commands::get_item,
            commands::create_note,
            commands::update_note,
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
            commands::file_abs_path,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
