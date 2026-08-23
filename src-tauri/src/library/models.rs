use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tag {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
    pub emoji: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Collection {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub position: i64,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub id: String,
    pub item_type: String,
    pub title: String,
    pub content: String,
    pub url: String,
    pub stored_path: String,
    pub size: i64,
    pub mime: String,
    pub created_at: String,
    pub updated_at: String,
    pub last_opened_at: String,
    pub is_favorite: bool,
    pub deleted_at: Option<String>,
    pub tags: Vec<Tag>,
    pub collections: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemSummary {
    pub id: String,
    pub item_type: String,
    pub title: String,
    pub content_preview: String,
    pub url: String,
    pub stored_path: String,
    pub size: i64,
    pub mime: String,
    pub created_at: String,
    pub updated_at: String,
    pub last_opened_at: String,
    pub is_favorite: bool,
    pub deleted_at: Option<String>,
    pub tags: Vec<Tag>,
    pub collections: Vec<String>,
}

impl From<Item> for ItemSummary {
    fn from(item: Item) -> Self {
        Self {
            id: item.id,
            item_type: item.item_type,
            title: item.title,
            content_preview: item.content,
            url: item.url,
            stored_path: item.stored_path,
            size: item.size,
            mime: item.mime,
            created_at: item.created_at,
            updated_at: item.updated_at,
            last_opened_at: item.last_opened_at,
            is_favorite: item.is_favorite,
            deleted_at: item.deleted_at,
            tags: item.tags,
            collections: item.collections,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListEntry {
    pub item: ItemSummary,
    pub snippet: Option<String>,
    pub highlight_terms: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListResult {
    pub entries: Vec<ListEntry>,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemDetail {
    pub item: Item,
    pub attachments: Vec<Item>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListFilters {
    /// "all" | "favorites" | "recent" | "uncollected" | "trash"
    #[serde(default)]
    pub view: String,
    pub collection_id: Option<String>,
    pub tag_id: Option<String>,
    pub query: Option<String>,
    /// "updated" | "created" | "title" | "type"
    #[serde(default)]
    pub sort: String,
    /// 0 means no limit
    #[serde(default)]
    pub limit: i64,
}

impl Default for ListFilters {
    fn default() -> Self {
        Self {
            view: "all".into(),
            collection_id: None,
            tag_id: None,
            query: None,
            sort: "updated".into(),
            limit: 0,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedView {
    pub id: String,
    pub name: String,
    pub query: String,
    pub sort: String,
    pub view: String,
    pub collection_id: Option<String>,
    pub tag_id: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchIndexStatus {
    pub pending: i64,
    pub failed: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexResult {
    pub indexed: i64,
    pub failed: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportOutcome {
    pub item: Item,
    pub file_name: String,
    pub size: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSkip {
    pub path: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub imported: Vec<ImportOutcome>,
    pub skipped: Vec<ImportSkip>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextFileDocument {
    pub content: String,
    pub version: String,
    pub encoding: String,
    pub line_ending: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum TextFileWriteResult {
    Saved { item: Item, version: String },
    Conflict { version: String },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryInfo {
    pub root: String,
    pub db_path: String,
    pub item_count: i64,
    pub file_count: i64,
    pub note_count: i64,
    pub link_count: i64,
}
