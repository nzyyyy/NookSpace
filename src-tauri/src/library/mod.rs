use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use rusqlite::{params, params_from_iter, Connection, OptionalExtension, Row};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

use crate::library::models::*;

pub mod db;pub mod import;
pub mod models;
pub mod native;

const FILES_DIR: &str = "files";
const THUMB_DIR: &str = "thumb";

/// The deep module: everything the app knows about its Library lives behind
/// these methods. The frontend never touches SQL or the filesystem directly.
#[derive(Clone)]
pub struct Library {
    db: Arc<Mutex<Connection>>,
    root: PathBuf,
    cache: PathBuf,
}

fn uuid() -> String {
    Uuid::new_v4().to_string()
}

fn map_err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

fn row_to_item(row: &Row) -> rusqlite::Result<Item> {
    Ok(Item {
        id: row.get(0)?,
        item_type: row.get(1)?,
        title: row.get(2)?,
        content: row.get(3)?,
        url: row.get(4)?,
        stored_path: row.get(5)?,
        size: row.get(6)?,
        mime: row.get(7)?,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
        last_opened_at: row.get(10)?,
        is_favorite: row.get::<_, i64>(11)? != 0,
        deleted_at: row.get(12)?,
        tags: Vec::new(),
        collections: Vec::new(),
    })
}

const ITEM_COLS: &str = "i.id, i.type, i.title, i.content, i.url, i.stored_path, i.size, i.mime, i.created_at, i.updated_at, i.last_opened_at, i.is_favorite, i.deleted_at";

/// Fill `tags` and `collections` on a batch of items in 2 queries (no N+1).
fn load_relations(conn: &Connection, items: &mut [Item]) -> rusqlite::Result<()> {
    if items.is_empty() {
        return Ok(());
    }
    let ids: Vec<String> = items.iter().map(|i| i.id.clone()).collect();
    let placeholders = vec!["?"; ids.len()].join(",");

    let mut tag_map: HashMap<String, Vec<Tag>> = HashMap::new();
    {
        let sql = format!(
            "SELECT it.item_id, t.id, t.name, t.color, t.emoji \
             FROM item_tags it JOIN tags t ON t.id = it.tag_id \
             WHERE it.item_id IN ({placeholders}) ORDER BY t.name COLLATE NOCASE"
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params_from_iter(ids.iter()), |r| {
            Ok((
                r.get::<_, String>(0)?,
                Tag {
                    id: r.get(1)?,
                    name: r.get(2)?,
                    color: r.get(3)?,
                    emoji: r.get(4)?,
                },
            ))
        })?;
        for row in rows {
            let (item_id, tag) = row?;
            tag_map.entry(item_id).or_default().push(tag);
        }
    }

    let mut col_map: HashMap<String, Vec<String>> = HashMap::new();
    {
        let sql = format!(
            "SELECT ic.item_id, ic.collection_id FROM item_collections ic \
             WHERE ic.item_id IN ({placeholders})"
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params_from_iter(ids.iter()), |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })?;
        for row in rows {
            let (item_id, col) = row?;
            col_map.entry(item_id).or_default().push(col);
        }
    }

    for item in items.iter_mut() {
        if let Some(tags) = tag_map.remove(&item.id) {
            item.tags = tags;
        }
        if let Some(cols) = col_map.remove(&item.id) {
            item.collections = cols;
        }
    }
    Ok(())
}

impl Library {
    // ---- setup ---------------------------------------------------------

    pub fn init(app: &AppHandle) -> Result<Self, String> {
        let root = app.path().app_data_dir().map_err(map_err)?;
        let cache = app.path().app_cache_dir().map_err(map_err)?;
        std::fs::create_dir_all(root.join(FILES_DIR)).map_err(map_err)?;
        std::fs::create_dir_all(cache.join(THUMB_DIR)).map_err(map_err)?;
        let db_path = root.join("nook.db");
        let mut conn = db::open_db(&db_path).map_err(map_err)?;
        db::migrate(&mut conn)?;
        Ok(Self {
            db: Arc::new(Mutex::new(conn)),
            root,
            cache,
        })
    }

    pub fn files_dir(&self) -> PathBuf {
        self.root.join(FILES_DIR)
    }

    pub fn thumb_dir(&self) -> PathBuf {
        self.cache.join(THUMB_DIR)
    }

    pub fn absolute_path(&self, stored_path: &str) -> PathBuf {
        self.root.join(stored_path)
    }

    pub fn relative_path(&self, abs: &std::path::Path) -> String {
        abs.strip_prefix(&self.root)
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default()
    }

    // ---- info ----------------------------------------------------------

    pub fn info(&self) -> Result<LibraryInfo, String> {
        let conn = self.db.lock().unwrap();
        let count = |sql: &str| -> Result<i64, String> {
            conn.query_row(sql, [], |r| r.get(0)).map_err(map_err)
        };
        Ok(LibraryInfo {
            root: self.root.to_string_lossy().to_string(),
            db_path: self.root.join("nook.db").to_string_lossy().to_string(),
            item_count: count("SELECT COUNT(*) FROM items WHERE deleted_at IS NULL")?,
            file_count: count("SELECT COUNT(*) FROM items WHERE type='file' AND deleted_at IS NULL")?,
            note_count: count("SELECT COUNT(*) FROM items WHERE type='note' AND deleted_at IS NULL")?,
            link_count: count("SELECT COUNT(*) FROM items WHERE type='link' AND deleted_at IS NULL")?,
        })
    }

    // ---- items: read ----------------------------------------------------

    pub fn list_items(&self, f: &ListFilters) -> Result<Vec<Item>, String> {
        let conn = self.db.lock().unwrap();
        let mut sql = format!("SELECT {ITEM_COLS} FROM items i WHERE 1=1");
        let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

        if f.view == "trash" {
            sql.push_str(" AND i.deleted_at IS NOT NULL");
        } else {
            sql.push_str(" AND i.deleted_at IS NULL");
            if f.view == "favorites" {
                sql.push_str(" AND i.is_favorite = 1");
            } else if f.view == "uncollected" {
                sql.push_str(" AND NOT EXISTS (SELECT 1 FROM item_collections ic WHERE ic.item_id = i.id)");
            }
        }

        if let Some(cid) = &f.collection_id {
            sql.push_str(" AND EXISTS (SELECT 1 FROM item_collections ic WHERE ic.item_id = i.id AND ic.collection_id = ?)");
            params.push(Box::new(cid.clone()));
        }
        if let Some(tid) = &f.tag_id {
            sql.push_str(" AND EXISTS (SELECT 1 FROM item_tags it WHERE it.item_id = i.id AND it.tag_id = ?)");
            params.push(Box::new(tid.clone()));
        }
        if let Some(q) = &f.query {
            let pattern = format!("%{}%", q.replace('%', "\\%").replace('_', "\\_"));
            sql.push_str(" AND (i.title LIKE ? ESCAPE '\\' OR i.content LIKE ? ESCAPE '\\' OR i.url LIKE ? ESCAPE '\\')");
            params.push(Box::new(pattern.clone()));
            params.push(Box::new(pattern.clone()));
            params.push(Box::new(pattern));
        }

        let order = if f.view == "recent" && f.sort == "updated" {
            "i.last_opened_at DESC, i.updated_at DESC".to_string()
        } else {
            match f.sort.as_str() {
                "created" => "i.created_at DESC".to_string(),
                "title" => "i.title COLLATE NOCASE ASC".to_string(),
                "type" => "i.type ASC, i.updated_at DESC".to_string(),
                _ => "i.updated_at DESC".to_string(),
            }
        };
        sql.push_str(&format!(" ORDER BY {order}"));

        if f.limit > 0 {
            sql.push_str(" LIMIT ?");
            params.push(Box::new(f.limit));
        }

        let mut items: Vec<Item> = {
            let mut stmt = conn.prepare(&sql).map_err(map_err)?;
            let rows = stmt
                .query_map(params_from_iter(params.iter().map(|b| b.as_ref())), row_to_item)
                .map_err(map_err)?;
            rows.collect::<Result<Vec<_>, _>>().map_err(map_err)?
        };
        load_relations(&conn, &mut items).map_err(map_err)?;
        Ok(items)
    }

    fn get_item_locked(&self, conn: &Connection, id: &str) -> Result<ItemDetail, String> {
        let sql = format!("SELECT {ITEM_COLS} FROM items i WHERE i.id = ?1");
        let mut item: Item = conn
            .query_row(&sql, params![id], row_to_item)
            .optional()
            .map_err(map_err)?
            .ok_or_else(|| format!("item not found: {id}"))?;

        let mut one = vec![item.clone()];
        load_relations(conn, &mut one).map_err(map_err)?;
        item = one.remove(0);

        let mut attachments: Vec<Item> = {
            let sql = format!(
                "SELECT {ITEM_COLS} FROM items i \
                 JOIN attachments a ON a.child_id = i.id \
                 WHERE a.parent_id = ?1 ORDER BY a.position"
            );
            let mut stmt = conn.prepare(&sql).map_err(map_err)?;
            let rows = stmt.query_map(params![id], row_to_item).map_err(map_err)?;
            rows.collect::<Result<Vec<_>, _>>().map_err(map_err)?
        };
        load_relations(conn, &mut attachments).map_err(map_err)?;

        Ok(ItemDetail { item, attachments })
    }

    pub fn get_item(&self, id: &str) -> Result<ItemDetail, String> {
        let conn = self.db.lock().unwrap();
        self.get_item_locked(&conn, id)
    }

    /// Insert an item row; returns the new id. Caller must not hold the lock.
    pub fn insert_item(
        &self,
        item_type: &str,
        title: &str,
        content: &str,
        url: &str,
        stored_path: &str,
        size: i64,
        mime: &str,
        meta: &str,
        collection_ids: &[String],
    ) -> Result<String, String> {
        let conn = self.db.lock().unwrap();
        let id = uuid();
        conn.execute(
            "INSERT INTO items (id, type, title, content, url, stored_path, size, mime, created_at, updated_at, meta) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, datetime('now'), datetime('now'), ?9)",
            params![id, item_type, title, content, url, stored_path, size, mime, meta],
        )
        .map_err(map_err)?;
        for cid in collection_ids {
            conn.execute(
                "INSERT OR IGNORE INTO item_collections (item_id, collection_id) VALUES (?1, ?2)",
                params![id, cid],
            )
            .map_err(map_err)?;
        }
        Ok(id)
    }

    // ---- items: write ---------------------------------------------------

    pub fn create_note(
        &self,
        title: &str,
        content: &str,
        collection_ids: &[String],
    ) -> Result<Item, String> {
        let id = self.insert_item("note", title, content, "", "", 0, "", "{}", collection_ids)?;
        self.get_item(&id).map(|d| d.item)
    }

    pub fn update_note(&self, id: &str, title: &str, content: &str) -> Result<Item, String> {
        {
            let conn = self.db.lock().unwrap();
            conn.execute(
                "UPDATE items SET title = ?1, content = ?2, updated_at = datetime('now') WHERE id = ?3 AND type = 'note'",
                params![title, content, id],
            )
            .map_err(map_err)?;
        }
        self.get_item(id).map(|d| d.item)
    }

    pub fn create_link(&self, url: &str, title: &str, collection_ids: &[String]) -> Result<Item, String> {
        let title = if title.is_empty() {
            url.to_string()
        } else {
            title.to_string()
        };
        let id = self.insert_item("link", &title, "", url, "", 0, "text/html", "{}", collection_ids)?;
        self.get_item(&id).map(|d| d.item)
    }

    pub fn delete_items(&self, ids: &[String]) -> Result<(), String> {
        let conn = self.db.lock().unwrap();
        let placeholders = vec!["?"; ids.len()].join(",");
        let sql = format!("UPDATE items SET deleted_at = datetime('now') WHERE id IN ({placeholders}) AND deleted_at IS NULL");
        conn.execute(&sql, params_from_iter(ids.iter())).map_err(map_err)?;
        Ok(())
    }

    pub fn restore_items(&self, ids: &[String]) -> Result<(), String> {
        let conn = self.db.lock().unwrap();
        let placeholders = vec!["?"; ids.len()].join(",");
        let sql = format!("UPDATE items SET deleted_at = NULL WHERE id IN ({placeholders})");
        conn.execute(&sql, params_from_iter(ids.iter())).map_err(map_err)?;
        Ok(())
    }

    pub fn empty_trash(&self) -> Result<(), String> {
        let conn = self.db.lock().unwrap();
        let rows: Vec<(String, String)> = {
            let mut stmt = conn
                .prepare("SELECT id, stored_path FROM items WHERE deleted_at IS NOT NULL AND type = 'file'")
                .map_err(map_err)?;
            let rows = stmt
                .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
                .map_err(map_err)?;
            rows.collect::<Result<Vec<_>, _>>().map_err(map_err)?
        };
        let (ids, paths): (Vec<String>, Vec<String>) = rows.into_iter().unzip();
        for p in &paths {
            if let Some(dir) = std::path::Path::new(p).parent() {
                let _ = std::fs::remove_dir_all(self.absolute_path(&dir.to_string_lossy()));
            }
        }
        for id in &ids {
            let _ = std::fs::remove_file(self.thumb_dir().join(format!("{id}.png")));
        }
        conn.execute("DELETE FROM items WHERE deleted_at IS NOT NULL", [])
            .map_err(map_err)?;
        Ok(())
    }

    /// Permanently delete specific trashed items (and their stored files).
    pub fn purge_items(&self, ids: &[String]) -> Result<(), String> {
        let conn = self.db.lock().unwrap();
        let placeholders = vec!["?"; ids.len()].join(",");
        let paths: Vec<String> = {
            let sql = format!(
                "SELECT stored_path FROM items WHERE deleted_at IS NOT NULL AND type = 'file' AND id IN ({placeholders})"
            );
            let mut stmt = conn.prepare(&sql).map_err(map_err)?;
            let rows = stmt
                .query_map(params_from_iter(ids.iter()), |r| r.get::<_, String>(0))
                .map_err(map_err)?;
            rows.collect::<Result<Vec<_>, _>>().map_err(map_err)?
        };
        for p in &paths {
            if let Some(dir) = std::path::Path::new(p).parent() {
                let _ = std::fs::remove_dir_all(self.absolute_path(&dir.to_string_lossy()));
            }
        }
        for id in ids {
            let _ = std::fs::remove_file(self.thumb_dir().join(format!("{id}.png")));
        }
        let sql = format!("DELETE FROM items WHERE deleted_at IS NOT NULL AND id IN ({placeholders})");
        conn.execute(&sql, params_from_iter(ids.iter())).map_err(map_err)?;
        Ok(())
    }

    pub fn set_favorite(&self, id: &str, favorite: bool) -> Result<Item, String> {
        {
            let conn = self.db.lock().unwrap();
            conn.execute(
                "UPDATE items SET is_favorite = ?1 WHERE id = ?2",
                params![if favorite { 1 } else { 0 }, id],
            )
            .map_err(map_err)?;
        }
        self.get_item(id).map(|d| d.item)
    }

    pub fn touch_item(&self, id: &str) -> Result<(), String> {
        let conn = self.db.lock().unwrap();
        conn.execute(
            "UPDATE items SET last_opened_at = datetime('now') WHERE id = ?1",
            params![id],
        )
        .map_err(map_err)?;
        Ok(())
    }

    // ---- collections -----------------------------------------------------

    pub fn list_collections(&self) -> Result<Vec<Collection>, String> {
        let conn = self.db.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT id, name, parent_id, position, created_at FROM collections ORDER BY position ASC, name COLLATE NOCASE")
            .map_err(map_err)?;
        let rows = stmt
            .query_map([], |r| {
                Ok(Collection {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    parent_id: r.get(2)?,
                    position: r.get(3)?,
                    created_at: r.get(4)?,
                })
            })
            .map_err(map_err)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(map_err)
    }

    pub fn create_collection(&self, name: &str, parent_id: Option<&str>) -> Result<Collection, String> {
        let conn = self.db.lock().unwrap();
        let id = uuid();
        let position: i64 = conn
            .query_row("SELECT COALESCE(MAX(position), -1) + 1 FROM collections", [], |r| r.get(0))
            .map_err(map_err)?;
        conn.execute(
            "INSERT INTO collections (id, name, parent_id, position, created_at) VALUES (?1, ?2, ?3, ?4, datetime('now'))",
            params![id, name, parent_id, position],
        )
        .map_err(map_err)?;
        let created_at: String = conn
            .query_row("SELECT datetime('now')", [], |r| r.get(0))
            .map_err(map_err)?;
        Ok(Collection {
            id,
            name: name.to_string(),
            parent_id: parent_id.map(|s| s.to_string()),
            position,
            created_at,
        })
    }

    pub fn rename_collection(&self, id: &str, name: &str) -> Result<(), String> {
        let conn = self.db.lock().unwrap();
        conn.execute("UPDATE collections SET name = ?1 WHERE id = ?2", params![name, id])
            .map_err(map_err)?;
        Ok(())
    }

    pub fn delete_collection(&self, id: &str) -> Result<(), String> {
        let conn = self.db.lock().unwrap();
        conn.execute("DELETE FROM collections WHERE id = ?1", params![id])
            .map_err(map_err)?;
        Ok(())
    }

    pub fn add_items_to_collection(&self, item_ids: &[String], collection_id: &str) -> Result<(), String> {
        let conn = self.db.lock().unwrap();
        for item_id in item_ids {
            conn.execute(
                "INSERT OR IGNORE INTO item_collections (item_id, collection_id) VALUES (?1, ?2)",
                params![item_id, collection_id],
            )
            .map_err(map_err)?;
        }
        Ok(())
    }

    pub fn remove_items_from_collection(&self, item_ids: &[String], collection_id: &str) -> Result<(), String> {
        let conn = self.db.lock().unwrap();
        for item_id in item_ids {
            conn.execute(
                "DELETE FROM item_collections WHERE item_id = ?1 AND collection_id = ?2",
                params![item_id, collection_id],
            )
            .map_err(map_err)?;
        }
        Ok(())
    }

    // ---- tags -----------------------------------------------------------

    pub fn list_tags(&self) -> Result<Vec<Tag>, String> {
        let conn = self.db.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT id, name, color, emoji FROM tags ORDER BY name COLLATE NOCASE")
            .map_err(map_err)?;
        let rows = stmt
            .query_map([], |r| {
                Ok(Tag {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    color: r.get(2)?,
                    emoji: r.get(3)?,
                })
            })
            .map_err(map_err)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(map_err)
    }

    pub fn create_tag(&self, name: &str) -> Result<Tag, String> {
        let conn = self.db.lock().unwrap();
        let exists: Option<i64> = conn
            .query_row(
                "SELECT 1 FROM tags WHERE name = ?1 COLLATE NOCASE",
                params![name],
                |r| r.get(0),
            )
            .optional()
            .map_err(map_err)?;
        if exists.is_some() {
            return Err("标签已存在".into());
        }
        let id = uuid();
        conn.execute(
            "INSERT INTO tags (id, name, created_at) VALUES (?1, ?2, datetime('now'))",
            params![id, name],
        )
        .map_err(map_err)?;
        Ok(Tag {
            id,
            name: name.to_string(),
            color: None,
            emoji: None,
        })
    }

    pub fn rename_tag(&self, id: &str, name: &str) -> Result<(), String> {
        let conn = self.db.lock().unwrap();
        conn.execute("UPDATE tags SET name = ?1 WHERE id = ?2", params![name, id])
            .map_err(map_err)?;
        Ok(())
    }

    pub fn delete_tag(&self, id: &str) -> Result<(), String> {
        let conn = self.db.lock().unwrap();
        conn.execute("DELETE FROM tags WHERE id = ?1", params![id]).map_err(map_err)?;
        Ok(())
    }

    pub fn set_item_tags(&self, item_id: &str, tag_ids: &[String]) -> Result<Item, String> {
        {
            let conn = self.db.lock().unwrap();
            conn.execute("DELETE FROM item_tags WHERE item_id = ?1", params![item_id])
                .map_err(map_err)?;
            for tag_id in tag_ids {
                conn.execute(
                    "INSERT OR IGNORE INTO item_tags (item_id, tag_id) VALUES (?1, ?2)",
                    params![item_id, tag_id],
                )
                .map_err(map_err)?;
            }
        }
        self.get_item(item_id).map(|d| d.item)
    }

    // ---- attachments -----------------------------------------------------

    pub fn add_attachments(&self, parent_id: &str, child_ids: &[String]) -> Result<ItemDetail, String> {
        {
            let conn = self.db.lock().unwrap();
            let parent_type: String = conn
                .query_row("SELECT type FROM items WHERE id = ?1", params![parent_id], |r| r.get(0))
                .map_err(map_err)?;
            if parent_type != "note" {
                return Err("只有笔记可以挂附件".into());
            }
            for child_id in child_ids {
                if child_id == parent_id {
                    continue;
                }
                let child_type: String = conn
                    .query_row("SELECT type FROM items WHERE id = ?1", params![child_id], |r| r.get(0))
                    .map_err(map_err)?;
                if child_type != "file" {
                    continue;
                }
                conn.execute(
                    "INSERT OR IGNORE INTO attachments (parent_id, child_id, position) \
                     VALUES (?1, ?2, COALESCE((SELECT MAX(position) + 1 FROM attachments WHERE parent_id = ?1), 0))",
                    params![parent_id, child_id],
                )
                .map_err(map_err)?;
            }
        }
        self.get_item(parent_id)
    }

    pub fn remove_attachment(&self, parent_id: &str, child_id: &str) -> Result<ItemDetail, String> {
        {
            let conn = self.db.lock().unwrap();
            conn.execute(
                "DELETE FROM attachments WHERE parent_id = ?1 AND child_id = ?2",
                params![parent_id, child_id],
            )
            .map_err(map_err)?;
        }
        self.get_item(parent_id)
    }

    // ---- import / preview / native ---------------------------------------

    pub fn import_files(&self, paths: &[String], collection_id: Option<&str>) -> Result<ImportResult, String> {
        import::import_files(self, paths, collection_id)
    }

    pub fn open_with_default(&self, id: &str) -> Result<(), String> {
        native::open_with_default(self, id)
    }

    pub fn quicklook(&self, id: &str) -> Result<(), String> {
        native::quicklook(self, id)
    }

    pub fn generate_thumbnail(&self, id: &str) -> Result<Option<String>, String> {
        native::generate_thumbnail(self, id)
    }

    /// Absolute path of a File item's stored file (for in-window preview).
    pub fn file_abs_path(&self, id: &str) -> Result<Option<String>, String> {
        let conn = self.db.lock().unwrap();
        let stored: Option<String> = conn
            .query_row(
                "SELECT stored_path FROM items WHERE id = ?1 AND type = 'file'",
                params![id],
                |r| r.get(0),
            )
            .optional()
            .map_err(map_err)?;
        Ok(stored
            .filter(|s| !s.is_empty())
            .map(|s| self.absolute_path(&s).to_string_lossy().to_string()))
    }
}
