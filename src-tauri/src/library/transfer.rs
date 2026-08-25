use std::fs;
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{Connection, MAIN_DB};
use serde_json::{json, Value};

use crate::library::import::sha256_of;
use crate::library::{Library, FILES_DIR, LOCATION_FILE};

fn timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn safe_relative(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let relative = Path::new(relative);
    if relative.is_absolute()
        || relative.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err("资料库包含无效文件路径".into());
    }
    let mut path = root.to_path_buf();
    for component in relative.components() {
        if let Component::Normal(part) = component {
            path.push(part);
            if fs::symlink_metadata(&path).is_ok_and(|metadata| metadata.file_type().is_symlink()) {
                return Err(format!("资料库包含符号链接：{}", path.display()));
            }
        }
    }
    Ok(path)
}

fn copy_file_verified(source: &Path, destination: &Path) -> Result<(), String> {
    if fs::symlink_metadata(source)
        .map_err(|error| error.to_string())?
        .file_type()
        .is_symlink()
    {
        return Err(format!("拒绝复制符号链接：{}", source.display()));
    }
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::copy(source, destination).map_err(|error| error.to_string())?;
    if sha256_of(source)? != sha256_of(destination)? {
        return Err(format!("文件校验失败：{}", source.display()));
    }
    Ok(())
}

fn copy_dir_verified(source: &Path, destination: &Path) -> Result<(), String> {
    fs::create_dir_all(destination).map_err(|error| error.to_string())?;
    for entry in fs::read_dir(source).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let file_type = entry.file_type().map_err(|error| error.to_string())?;
        let target = destination.join(entry.file_name());
        if file_type.is_symlink() {
            return Err(format!("拒绝复制符号链接：{}", entry.path().display()));
        }
        if file_type.is_dir() {
            copy_dir_verified(&entry.path(), &target)?;
        } else if file_type.is_file() {
            copy_file_verified(&entry.path(), &target)?;
        }
    }
    Ok(())
}

fn validate_database(path: &Path) -> Result<Connection, String> {
    let root = fs::symlink_metadata(path);
    let database = fs::symlink_metadata(path.join("nook.db"));
    let files = fs::symlink_metadata(path.join(FILES_DIR));
    if !root.is_ok_and(|metadata| metadata.is_dir() && !metadata.file_type().is_symlink())
        || !database.is_ok_and(|metadata| metadata.is_file() && !metadata.file_type().is_symlink())
        || !files.is_ok_and(|metadata| metadata.is_dir() && !metadata.file_type().is_symlink())
    {
        return Err("所选目录不是有效的 NookSpace 资料库".into());
    }
    let conn = Connection::open(path.join("nook.db")).map_err(|error| error.to_string())?;
    let integrity: String = conn
        .query_row("PRAGMA integrity_check", [], |row| row.get(0))
        .map_err(|error| error.to_string())?;
    if integrity != "ok" {
        return Err(format!("数据库完整性检查失败：{integrity}"));
    }
    Ok(conn)
}

pub(super) fn validate_library(path: &Path) -> Result<(), String> {
    let conn = validate_database(path)?;
    let mut stmt = conn
        .prepare("SELECT stored_path FROM items WHERE type = 'file'")
        .map_err(|error| error.to_string())?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?;
    for row in rows {
        let file = safe_relative(path, &row.map_err(|error| error.to_string())?)?;
        let metadata = fs::symlink_metadata(&file)
            .map_err(|_| format!("资料库缺少文件：{}", file.to_string_lossy()))?;
        if !metadata.is_file() || metadata.file_type().is_symlink() {
            return Err(format!("资料库文件无效：{}", file.display()));
        }
    }
    Ok(())
}

fn ensure_outside(source: &Path, target: &Path) -> Result<(), String> {
    if fs::symlink_metadata(target)
        .map_err(|error| error.to_string())?
        .file_type()
        .is_symlink()
    {
        return Err("目标目录不能是符号链接".into());
    }
    let source = source.canonicalize().map_err(|error| error.to_string())?;
    let target = target.canonicalize().map_err(|error| error.to_string())?;
    if target == source || target.starts_with(&source) {
        return Err("目标目录不能位于当前资料库内".into());
    }
    Ok(())
}

fn query_values<F>(conn: &Connection, sql: &str, mut map: F) -> Result<Vec<Value>, String>
where
    F: FnMut(&rusqlite::Row) -> rusqlite::Result<Value>,
{
    let mut stmt = conn.prepare(sql).map_err(|error| error.to_string())?;
    let rows = stmt
        .query_map([], |row| map(row))
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

impl Library {
    pub fn export_item(&self, id: &str, destination: &Path) -> Result<String, String> {
        let parent = destination.parent().ok_or("无效导出路径")?;
        ensure_outside(&self.root, parent)?;
        if fs::symlink_metadata(destination).is_ok_and(|metadata| metadata.file_type().is_symlink())
        {
            return Err("导出目标不能是符号链接".into());
        }

        let _files = self.files_lock.lock().unwrap();
        let item = self.get_item(id)?.item;
        match item.item_type.as_str() {
            "file" if !item.stored_path.is_empty() => {
                let source = self.safe_stored_path(&item.stored_path)?;
                copy_file_verified(&source, destination)?;
            }
            "file" => return Err("该条目没有可导出的文件".into()),
            _ => return Err("该条目不支持导出".into()),
        }
        Ok(destination.to_string_lossy().to_string())
    }

    fn snapshot_database(&self, destination: &Path) -> Result<(), String> {
        let conn = self.db.lock().unwrap();
        conn.backup(MAIN_DB, destination, None)
            .map_err(|error| error.to_string())
    }

    fn write_location(&self, root: &Path) -> Result<(), String> {
        let location = self.app_data.join(LOCATION_FILE);
        let temporary = self.app_data.join(format!(".{LOCATION_FILE}.tmp"));
        fs::write(&temporary, root.to_string_lossy().as_bytes())
            .map_err(|error| error.to_string())?;
        fs::rename(&temporary, &location).map_err(|error| error.to_string())
    }

    pub fn backup_library(&self, parent: &Path) -> Result<String, String> {
        ensure_outside(&self.root, parent)?;
        let final_path = parent.join(format!("NookSpace Backup {}", timestamp()));
        let temporary = parent.join(format!(".nookspace-backup-{}", uuid::Uuid::new_v4()));
        if final_path.exists() {
            return Err("备份目标已存在".into());
        }
        let result = (|| {
            let _files = self.files_lock.lock().unwrap();
            fs::create_dir(&temporary).map_err(|error| error.to_string())?;
            self.snapshot_database(&temporary.join("nook.db"))?;
            copy_dir_verified(&self.files_dir(), &temporary.join(FILES_DIR))?;
            fs::write(
                temporary.join("library.json"),
                serde_json::to_vec_pretty(&json!({
                    "format": "nookspace-library",
                    "version": 1,
                    "createdAt": timestamp(),
                }))
                .map_err(|error| error.to_string())?,
            )
            .map_err(|error| error.to_string())?;
            validate_library(&temporary)?;
            fs::rename(&temporary, &final_path).map_err(|error| error.to_string())?;
            Ok(final_path.to_string_lossy().to_string())
        })();
        if result.is_err() {
            let _ = fs::remove_dir_all(&temporary);
        }
        result
    }

    pub fn use_existing_library(&self, root: &Path) -> Result<String, String> {
        ensure_outside(&self.root, root)?;
        validate_library(root)?;
        let root = root.canonicalize().map_err(|error| error.to_string())?;
        self.write_location(&root)?;
        Ok(root.to_string_lossy().to_string())
    }

    pub fn move_library(&self, destination: &Path) -> Result<String, String> {
        ensure_outside(&self.root, destination)?;
        if fs::read_dir(destination)
            .map_err(|error| error.to_string())?
            .next()
            .is_some()
        {
            return Err("移动目标必须是空目录".into());
        }
        let destination = destination
            .canonicalize()
            .map_err(|error| error.to_string())?;
        let parent = destination.parent().ok_or("无效目标目录")?;
        let temporary = parent.join(format!(".nookspace-move-{}", uuid::Uuid::new_v4()));
        let result = (|| {
            let _files = self.files_lock.lock().unwrap();
            fs::create_dir(&temporary).map_err(|error| error.to_string())?;
            self.snapshot_database(&temporary.join("nook.db"))?;
            copy_dir_verified(&self.files_dir(), &temporary.join(FILES_DIR))?;
            validate_library(&temporary)?;
            fs::remove_dir(&destination).map_err(|error| error.to_string())?;
            fs::rename(&temporary, &destination).map_err(|error| error.to_string())?;
            self.write_location(&destination)?;
            Ok(destination.to_string_lossy().to_string())
        })();
        if result.is_err() {
            let _ = fs::remove_dir_all(&temporary);
            if !destination.exists() {
                let _ = fs::create_dir(&destination);
            }
        }
        result
    }

    pub fn export_library(&self, parent: &Path) -> Result<String, String> {
        ensure_outside(&self.root, parent)?;
        let final_path = parent.join(format!("NookSpace Export {}", timestamp()));
        let temporary = parent.join(format!(".nookspace-export-{}", uuid::Uuid::new_v4()));
        if final_path.exists() {
            return Err("导出目标已存在".into());
        }
        let result = (|| {
            let _files = self.files_lock.lock().unwrap();
            fs::create_dir(&temporary).map_err(|error| error.to_string())?;
            let snapshot = temporary.join(".snapshot.db");
            self.snapshot_database(&snapshot)?;
            let conn = Connection::open(&snapshot).map_err(|error| error.to_string())?;

            let mut items = Vec::new();
            let mut stmt = conn
                .prepare("SELECT id, type, title, content, url, stored_path, size, mime, created_at, updated_at, last_opened_at, deleted_at, is_favorite, meta FROM items ORDER BY created_at")
                .map_err(|error| error.to_string())?;
            let rows = stmt
                .query_map([], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                        row.get::<_, String>(5)?,
                        row.get::<_, i64>(6)?,
                        row.get::<_, String>(7)?,
                        row.get::<_, String>(8)?,
                        row.get::<_, String>(9)?,
                        row.get::<_, String>(10)?,
                        row.get::<_, Option<String>>(11)?,
                        row.get::<_, i64>(12)? != 0,
                        row.get::<_, String>(13)?,
                    ))
                })
                .map_err(|error| error.to_string())?;
            for row in rows {
                let (
                    id,
                    item_type,
                    title,
                    _content,
                    url,
                    stored_path,
                    size,
                    mime,
                    created_at,
                    updated_at,
                    last_opened_at,
                    deleted_at,
                    favorite,
                    meta,
                ) = row.map_err(|error| error.to_string())?;
                let bucket = if deleted_at.is_some() {
                    "Trash"
                } else {
                    "Active"
                };
                let exported = match item_type.as_str() {
                    "link" => {
                        let relative = PathBuf::from(bucket)
                            .join("Links")
                            .join(format!("{id}.url"));
                        let path = temporary.join(&relative);
                        fs::create_dir_all(path.parent().unwrap())
                            .map_err(|error| error.to_string())?;
                        fs::write(&path, format!("[InternetShortcut]\nURL={url}\n"))
                            .map_err(|error| error.to_string())?;
                        relative
                    }
                    _ => {
                        let source = safe_relative(&self.root, &stored_path)?;
                        let name = source.file_name().ok_or("无效库内文件名")?;
                        let relative = PathBuf::from(bucket).join("Files").join(&id).join(name);
                        copy_file_verified(&source, &temporary.join(&relative))?;
                        relative
                    }
                };
                let meta: Value = serde_json::from_str(&meta)
                    .map_err(|error| format!("条目 {id} 元数据无效：{error}"))?;
                items.push(json!({
                    "id": id, "type": item_type, "title": title, "url": url,
                    "size": size, "mime": mime, "createdAt": created_at,
                    "updatedAt": updated_at, "lastOpenedAt": last_opened_at,
                    "deletedAt": deleted_at, "isFavorite": favorite,
                    "meta": meta,
                    "exportedPath": exported.to_string_lossy(),
                }));
            }
            drop(stmt);

            let collections = query_values(&conn, "SELECT id, name, parent_id, position, created_at FROM collections ORDER BY position", |row| {
                Ok(json!({"id": row.get::<_, String>(0)?, "name": row.get::<_, String>(1)?, "parentId": row.get::<_, Option<String>>(2)?, "position": row.get::<_, i64>(3)?, "createdAt": row.get::<_, String>(4)?}))
            })?;
            let tags = query_values(
                &conn,
                "SELECT id, name, color, emoji, created_at FROM tags ORDER BY name",
                |row| {
                    Ok(
                        json!({"id": row.get::<_, String>(0)?, "name": row.get::<_, String>(1)?, "color": row.get::<_, Option<String>>(2)?, "emoji": row.get::<_, Option<String>>(3)?, "createdAt": row.get::<_, String>(4)?}),
                    )
                },
            )?;
            let item_collections = query_values(
                &conn,
                "SELECT item_id, collection_id FROM item_collections",
                |row| {
                    Ok(
                        json!({"itemId": row.get::<_, String>(0)?, "collectionId": row.get::<_, String>(1)?}),
                    )
                },
            )?;
            let item_tags = query_values(&conn, "SELECT item_id, tag_id FROM item_tags", |row| {
                Ok(json!({"itemId": row.get::<_, String>(0)?, "tagId": row.get::<_, String>(1)?}))
            })?;
            let attachments = query_values(&conn, "SELECT parent_id, child_id, position FROM attachments ORDER BY parent_id, position", |row| {
                Ok(json!({"parentId": row.get::<_, String>(0)?, "childId": row.get::<_, String>(1)?, "position": row.get::<_, i64>(2)?}))
            })?;
            let saved_views = query_values(&conn, "SELECT id, name, query, sort, view, collection_id, tag_id, created_at FROM saved_views ORDER BY created_at", |row| {
                Ok(json!({"id": row.get::<_, String>(0)?, "name": row.get::<_, String>(1)?, "query": row.get::<_, String>(2)?, "sort": row.get::<_, String>(3)?, "view": row.get::<_, String>(4)?, "collectionId": row.get::<_, Option<String>>(5)?, "tagId": row.get::<_, Option<String>>(6)?, "createdAt": row.get::<_, String>(7)?}))
            })?;
            fs::write(
                temporary.join("manifest.json"),
                serde_json::to_vec_pretty(&json!({
                    "format": "nookspace-export", "version": 1, "createdAt": timestamp(),
                    "items": items, "collections": collections, "tags": tags,
                    "itemCollections": item_collections, "itemTags": item_tags,
                    "attachments": attachments, "savedViews": saved_views,
                }))
                .map_err(|error| error.to_string())?,
            )
            .map_err(|error| error.to_string())?;
            drop(conn);
            fs::remove_file(snapshot).map_err(|error| error.to_string())?;
            fs::rename(&temporary, &final_path).map_err(|error| error.to_string())?;
            Ok(final_path.to_string_lossy().to_string())
        })();
        if result.is_err() {
            let _ = fs::remove_dir_all(&temporary);
        }
        result
    }
}
