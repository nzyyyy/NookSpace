use rusqlite::{params, OptionalExtension};

use crate::library::models::SavedView;
use crate::library::Library;

fn row_to_saved_view(row: &rusqlite::Row) -> rusqlite::Result<SavedView> {
    Ok(SavedView {
        id: row.get(0)?,
        name: row.get(1)?,
        query: row.get(2)?,
        sort: row.get(3)?,
        view: row.get(4)?,
        collection_id: row.get(5)?,
        tag_id: row.get(6)?,
        created_at: row.get(7)?,
    })
}

impl Library {
    pub fn list_saved_views(&self) -> Result<Vec<SavedView>, String> {
        let conn = self.db.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT id, name, query, sort, view, collection_id, tag_id, created_at FROM saved_views ORDER BY created_at, name COLLATE NOCASE")
            .map_err(|error| error.to_string())?;
        let rows = stmt
            .query_map([], row_to_saved_view)
            .map_err(|error| error.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())
    }

    #[allow(clippy::too_many_arguments)]
    pub fn create_saved_view(
        &self,
        name: &str,
        query: &str,
        sort: &str,
        view: &str,
        collection_id: Option<&str>,
        tag_id: Option<&str>,
    ) -> Result<SavedView, String> {
        let name = name.trim();
        let query = query.trim();
        if name.is_empty() || query.is_empty() {
            return Err("名称和搜索内容不能为空".into());
        }
        if !matches!(sort, "updated" | "created" | "title" | "type") {
            return Err("无效排序".into());
        }
        if !matches!(
            view,
            "all" | "favorites" | "recent" | "uncollected" | "collection" | "tag"
        ) {
            return Err("无效视图".into());
        }
        let (collection_id, tag_id) = match view {
            "collection" if collection_id.is_some() => (collection_id, None),
            "tag" if tag_id.is_some() => (None, tag_id),
            "collection" | "tag" => return Err("保存搜索缺少视图目标".into()),
            _ => (None, None),
        };
        let id = uuid::Uuid::new_v4().to_string();
        let conn = self.db.lock().unwrap();
        conn.execute(
            "INSERT INTO saved_views (id, name, query, sort, view, collection_id, tag_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, datetime('now'))",
            params![id, name, query, sort, view, collection_id, tag_id],
        )
        .map_err(|error| error.to_string())?;
        conn.query_row(
            "SELECT id, name, query, sort, view, collection_id, tag_id, created_at FROM saved_views WHERE id = ?1",
            params![id],
            row_to_saved_view,
        )
        .map_err(|error| error.to_string())
    }

    pub fn rename_saved_view(&self, id: &str, name: &str) -> Result<(), String> {
        let name = name.trim();
        if name.is_empty() {
            return Err("名称不能为空".into());
        }
        let conn = self.db.lock().unwrap();
        let changed = conn
            .execute(
                "UPDATE saved_views SET name = ?1 WHERE id = ?2",
                params![name, id],
            )
            .map_err(|error| error.to_string())?;
        if changed == 1 {
            Ok(())
        } else {
            Err("保存搜索不存在".into())
        }
    }

    pub fn delete_saved_view(&self, id: &str) -> Result<(), String> {
        let conn = self.db.lock().unwrap();
        let exists = conn
            .query_row(
                "SELECT 1 FROM saved_views WHERE id = ?1",
                params![id],
                |_| Ok(()),
            )
            .optional()
            .map_err(|error| error.to_string())?;
        if exists.is_none() {
            return Err("保存搜索不存在".into());
        }
        conn.execute("DELETE FROM saved_views WHERE id = ?1", params![id])
            .map_err(|error| error.to_string())?;
        Ok(())
    }
}
