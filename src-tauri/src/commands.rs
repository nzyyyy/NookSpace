//! Thin adapters: map Tauri invoke payloads to `Library` calls.
//! No business logic lives here.

use tauri::State;

use crate::library::models::*;
use crate::library::Library;

async fn blocking<T, F>(lib: Library, f: F) -> Result<T, String>
where
    F: FnOnce(&Library) -> Result<T, String> + Send + 'static,
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || f(&lib))
        .await
        .map_err(|e| format!("task failed: {e}"))?
}

#[tauri::command]
pub async fn get_library_info(state: State<'_, Library>) -> Result<LibraryInfo, String> {
    let lib = state.inner().clone();
    blocking(lib, |l| l.info()).await
}

#[tauri::command]
pub async fn list_items(
    state: State<'_, Library>,
    filters: ListFilters,
) -> Result<Vec<Item>, String> {
    let lib = state.inner().clone();
    blocking(lib, move |l| l.list_items(&filters)).await
}

#[tauri::command]
pub async fn get_item(state: State<'_, Library>, id: String) -> Result<ItemDetail, String> {
    let lib = state.inner().clone();
    blocking(lib, move |l| l.get_item(&id)).await
}

#[tauri::command]
pub async fn create_note(
    state: State<'_, Library>,
    title: String,
    content: String,
    collection_ids: Vec<String>,
) -> Result<Item, String> {
    let lib = state.inner().clone();
    blocking(lib, move |l| {
        l.create_note(&title, &content, &collection_ids)
    })
    .await
}

#[tauri::command]
pub async fn update_note(
    state: State<'_, Library>,
    id: String,
    title: String,
    content: String,
) -> Result<Item, String> {
    let lib = state.inner().clone();
    blocking(lib, move |l| l.update_note(&id, &title, &content)).await
}

#[tauri::command]
pub async fn create_link(
    state: State<'_, Library>,
    url: String,
    title: String,
    collection_ids: Vec<String>,
) -> Result<Item, String> {
    let lib = state.inner().clone();
    blocking(lib, move |l| l.create_link(&url, &title, &collection_ids)).await
}

#[tauri::command]
pub async fn delete_items(state: State<'_, Library>, ids: Vec<String>) -> Result<(), String> {
    let lib = state.inner().clone();
    blocking(lib, move |l| l.delete_items(&ids)).await
}

#[tauri::command]
pub async fn restore_items(state: State<'_, Library>, ids: Vec<String>) -> Result<(), String> {
    let lib = state.inner().clone();
    blocking(lib, move |l| l.restore_items(&ids)).await
}

#[tauri::command]
pub async fn empty_trash(state: State<'_, Library>) -> Result<(), String> {
    let lib = state.inner().clone();
    blocking(lib, |l| l.empty_trash()).await
}

#[tauri::command]
pub async fn purge_items(state: State<'_, Library>, ids: Vec<String>) -> Result<(), String> {
    let lib = state.inner().clone();
    blocking(lib, move |l| l.purge_items(&ids)).await
}

#[tauri::command]
pub async fn set_favorite(
    state: State<'_, Library>,
    id: String,
    favorite: bool,
) -> Result<Item, String> {
    let lib = state.inner().clone();
    blocking(lib, move |l| l.set_favorite(&id, favorite)).await
}

#[tauri::command]
pub async fn touch_item(state: State<'_, Library>, id: String) -> Result<(), String> {
    let lib = state.inner().clone();
    blocking(lib, move |l| l.touch_item(&id)).await
}

#[tauri::command]
pub async fn list_collections(state: State<'_, Library>) -> Result<Vec<Collection>, String> {
    let lib = state.inner().clone();
    blocking(lib, |l| l.list_collections()).await
}

#[tauri::command]
pub async fn create_collection(
    state: State<'_, Library>,
    name: String,
    parent_id: Option<String>,
) -> Result<Collection, String> {
    let lib = state.inner().clone();
    blocking(lib, move |l| {
        l.create_collection(&name, parent_id.as_deref())
    })
    .await
}

#[tauri::command]
pub async fn rename_collection(
    state: State<'_, Library>,
    id: String,
    name: String,
) -> Result<(), String> {
    let lib = state.inner().clone();
    blocking(lib, move |l| l.rename_collection(&id, &name)).await
}

#[tauri::command]
pub async fn move_collection(
    state: State<'_, Library>,
    id: String,
    parent_id: Option<String>,
    before_id: Option<String>,
) -> Result<(), String> {
    let lib = state.inner().clone();
    blocking(lib, move |l| {
        l.move_collection(&id, parent_id.as_deref(), before_id.as_deref())
    })
    .await
}

#[tauri::command]
pub async fn delete_collection_tree(state: State<'_, Library>, id: String) -> Result<i64, String> {
    let lib = state.inner().clone();
    blocking(lib, move |l| l.delete_collection_tree(&id)).await
}

#[tauri::command]
pub async fn add_items_to_collection(
    state: State<'_, Library>,
    item_ids: Vec<String>,
    collection_id: String,
) -> Result<(), String> {
    let lib = state.inner().clone();
    blocking(lib, move |l| {
        l.add_items_to_collection(&item_ids, &collection_id)
    })
    .await
}

#[tauri::command]
pub async fn remove_items_from_collection(
    state: State<'_, Library>,
    item_ids: Vec<String>,
    collection_id: String,
) -> Result<(), String> {
    let lib = state.inner().clone();
    blocking(lib, move |l| {
        l.remove_items_from_collection(&item_ids, &collection_id)
    })
    .await
}

#[tauri::command]
pub async fn list_tags(state: State<'_, Library>) -> Result<Vec<Tag>, String> {
    let lib = state.inner().clone();
    blocking(lib, |l| l.list_tags()).await
}

#[tauri::command]
pub async fn create_tag(state: State<'_, Library>, name: String) -> Result<Tag, String> {
    let lib = state.inner().clone();
    blocking(lib, move |l| l.create_tag(&name)).await
}

#[tauri::command]
pub async fn rename_tag(state: State<'_, Library>, id: String, name: String) -> Result<(), String> {
    let lib = state.inner().clone();
    blocking(lib, move |l| l.rename_tag(&id, &name)).await
}

#[tauri::command]
pub async fn set_tag_color(
    state: State<'_, Library>,
    id: String,
    color: Option<String>,
) -> Result<Tag, String> {
    let lib = state.inner().clone();
    blocking(lib, move |l| l.set_tag_color(&id, color.as_deref())).await
}

#[tauri::command]
pub async fn delete_tag(state: State<'_, Library>, id: String) -> Result<(), String> {
    let lib = state.inner().clone();
    blocking(lib, move |l| l.delete_tag(&id)).await
}

#[tauri::command]
pub async fn set_item_tags(
    state: State<'_, Library>,
    item_id: String,
    tag_ids: Vec<String>,
) -> Result<Item, String> {
    let lib = state.inner().clone();
    blocking(lib, move |l| l.set_item_tags(&item_id, &tag_ids)).await
}

#[tauri::command]
pub async fn add_attachments(
    state: State<'_, Library>,
    parent_id: String,
    child_ids: Vec<String>,
) -> Result<ItemDetail, String> {
    let lib = state.inner().clone();
    blocking(lib, move |l| l.add_attachments(&parent_id, &child_ids)).await
}

#[tauri::command]
pub async fn remove_attachment(
    state: State<'_, Library>,
    parent_id: String,
    child_id: String,
) -> Result<ItemDetail, String> {
    let lib = state.inner().clone();
    blocking(lib, move |l| l.remove_attachment(&parent_id, &child_id)).await
}

#[tauri::command]
pub async fn import_files(
    state: State<'_, Library>,
    paths: Vec<String>,
    collection_id: Option<String>,
) -> Result<ImportResult, String> {
    let lib = state.inner().clone();
    blocking(lib, move |l| {
        l.import_files(&paths, collection_id.as_deref())
    })
    .await
}

#[tauri::command]
pub async fn open_with_default(state: State<'_, Library>, id: String) -> Result<(), String> {
    let lib = state.inner().clone();
    blocking(lib, move |l| l.open_with_default(&id)).await
}

#[tauri::command]
pub async fn quicklook(state: State<'_, Library>, id: String) -> Result<(), String> {
    let lib = state.inner().clone();
    blocking(lib, move |l| l.quicklook(&id)).await
}

#[tauri::command]
pub async fn generate_thumbnail(
    state: State<'_, Library>,
    id: String,
) -> Result<Option<String>, String> {
    let lib = state.inner().clone();
    blocking(lib, move |l| l.generate_thumbnail(&id)).await
}

#[tauri::command]
pub async fn file_abs_path(
    state: State<'_, Library>,
    id: String,
) -> Result<Option<String>, String> {
    let lib = state.inner().clone();
    blocking(lib, move |l| l.file_abs_path(&id)).await
}
