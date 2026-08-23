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
pub struct LibraryInfo {
    pub root: String,
    pub db_path: String,
    pub item_count: i64,
    pub file_count: i64,
    pub note_count: i64,
    pub link_count: i64,
}
