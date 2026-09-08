use std::collections::HashSet;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use rusqlite::{params, OptionalExtension};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter};

use crate::library::models::{
    ImportOutcome, ImportResult, ImportSkip, LinkedSourceStatus, LinkedSyncResult,
    RelinkSourceResult,
};
use crate::library::Library;

pub struct SourceWatcher {
    watcher: RecommendedWatcher,
    sources: Arc<Mutex<HashSet<PathBuf>>>,
    directories: HashSet<PathBuf>,
    failed: bool,
}

impl SourceWatcher {
    pub fn new(app: AppHandle) -> Result<Self, String> {
        let sources = Arc::new(Mutex::new(HashSet::<PathBuf>::new()));
        let callback_sources = Arc::clone(&sources);
        let watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
            let Ok(event) = event else { return };
            let sources = callback_sources.lock().unwrap();
            if event.paths.iter().any(|path| sources.contains(path)) {
                let _ = app.emit("linked-source-changed", ());
            }
        })
        .map_err(|error| error.to_string())?;
        Ok(Self {
            watcher,
            sources,
            directories: HashSet::new(),
            failed: false,
        })
    }

    pub(super) fn reset(&mut self, sources: HashSet<PathBuf>) -> Result<(), String> {
        let directories = sources
            .iter()
            .filter_map(|path| path.parent().map(Path::to_path_buf))
            .filter(|path| path.is_dir())
            .collect::<HashSet<_>>();
        self.failed = false;
        let mut active = self
            .directories
            .intersection(&directories)
            .cloned()
            .collect::<HashSet<_>>();
        for directory in self.directories.difference(&directories) {
            if self.watcher.unwatch(directory).is_err() {
                self.failed = true;
            }
        }
        for directory in directories.difference(&self.directories) {
            if self
                .watcher
                .watch(directory, RecursiveMode::NonRecursive)
                .is_ok()
            {
                active.insert(directory.clone());
            } else {
                self.failed = true;
            }
        }
        *self.sources.lock().unwrap() = sources;
        self.directories = active;
        Ok(())
    }

    pub(super) fn available(&self) -> bool {
        !self.failed
    }
}

/// Import source files into the Library: copy each file into the managed
/// directory (never touching the source), dedupe by source path + sha256,
/// recurse into folders. A dropped folder becomes (or reuses) a Collection
/// named after it, and its files are imported into that Collection.
pub fn import_files(
    lib: &Library,
    paths: &[String],
    collection_id: Option<&str>,
    link_source: bool,
) -> Result<ImportResult, String> {
    let mut files: Vec<(PathBuf, Option<String>)> = Vec::new();
    for p in paths {
        let path = PathBuf::from(p);
        if path.is_dir() {
            let name = path
                .file_name()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| "导入".to_string());
            let cid = ensure_collection(lib, &name)?;
            collect_dir(&path, &cid, &mut files);
        } else if path.is_file() {
            files.push((path, collection_id.map(|s| s.to_string())));
        }
    }

    let mut result = ImportResult {
        imported: Vec::new(),
        skipped: Vec::new(),
    };
    for (file, cid) in files {
        match import_one(lib, &file, cid.as_deref(), link_source) {
            Ok(Some(outcome)) => result.imported.push(outcome),
            Ok(None) => {}
            Err(reason) => result.skipped.push(ImportSkip {
                path: file.to_string_lossy().to_string(),
                reason,
            }),
        }
    }
    if link_source {
        let _ = lib.refresh_source_watches();
    }
    Ok(result)
}

/// Find a Collection by name (case-insensitive) or create it.
fn ensure_collection(lib: &Library, name: &str) -> Result<String, String> {
    let existing: Option<String> = {
        let conn = lib.db.lock().unwrap();
        conn.query_row(
            "SELECT id FROM collections WHERE name = ?1 COLLATE NOCASE",
            params![name],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
    };
    if let Some(id) = existing {
        return Ok(id);
    }
    Ok(lib.create_collection(name, None)?.id)
}

fn collect_dir(dir: &Path, collection_id: &str, out: &mut Vec<(PathBuf, Option<String>)>) {
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                continue;
            }
            if path.is_symlink() {
                continue;
            }
            if path.is_dir() {
                collect_dir(&path, collection_id, out);
            } else if path.is_file() {
                out.push((path, Some(collection_id.to_string())));
            }
        }
    }
}

pub(crate) fn sha256_of(path: &Path) -> Result<String, String> {
    let mut file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = file.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hex::encode(hasher.finalize()))
}

pub(crate) fn mime_of(name: &str) -> String {
    let ext = name.rsplit('.').next().unwrap_or("").to_lowercase();
    let mime = match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "heic" | "heif" => "image/heic",
        "svg" => "image/svg+xml",
        "pdf" => "application/pdf",
        "md" | "markdown" => "text/markdown",
        "txt" | "log" => "text/plain",
        "html" | "htm" => "text/html",
        "json" => "application/json",
        "yaml" | "yml" => "text/yaml",
        "csv" => "text/csv",
        "rtf" => "application/rtf",
        "doc" => "application/msword",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xls" => "application/vnd.ms-excel",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "ppt" => "application/vnd.ms-powerpoint",
        "pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "zip" => "application/zip",
        "mp4" | "m4v" => "video/mp4",
        "mov" => "video/quicktime",
        "webm" => "video/webm",
        "mkv" => "video/x-matroska",
        "avi" => "video/x-msvideo",
        "mpeg" | "mpg" => "video/mpeg",
        "wmv" => "video/x-ms-wmv",
        "flv" => "video/x-flv",
        "ogv" => "video/ogg",
        "3gp" => "video/3gpp",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "m4a" => "audio/mp4",
        "aac" => "audio/aac",
        "flac" => "audio/flac",
        "ogg" | "oga" => "audio/ogg",
        "opus" => "audio/opus",
        "wma" => "audio/x-ms-wma",
        "aif" | "aiff" => "audio/aiff",
        "caf" => "audio/x-caf",
        "epub" => "application/epub+zip",
        _ => "application/octet-stream",
    };
    mime.to_string()
}

#[cfg(test)]
mod tests {
    use super::mime_of;

    #[test]
    fn log_files_are_plain_text() {
        assert_eq!(mime_of("app.LOG"), "text/plain");
    }
}

fn import_one(
    lib: &Library,
    path: &Path,
    collection_id: Option<&str>,
    link_source: bool,
) -> Result<Option<ImportOutcome>, String> {
    let file_name = path
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    if file_name.is_empty() {
        return Err("无法识别的文件".into());
    }
    let source_path = if link_source {
        validate_source(lib, path)?
    } else {
        path.to_path_buf()
    };
    let source = source_path.to_string_lossy().to_string();
    let size = std::fs::metadata(path).map_err(|e| e.to_string())?.len() as i64;
    let sha = sha256_of(path)?;

    // Dedupe: same source path + same sha256 was imported before.
    {
        let conn = lib.db.lock().unwrap();
        let existing: Option<(String, Option<String>)> = conn
            .query_row(
                "SELECT id, json_extract(meta, '$.sha256') FROM items \
                 WHERE type = 'file' AND deleted_at IS NULL AND json_extract(meta, '$.sourcePath') = ?1",
                params![source],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        if let Some((_id, meta_sha)) = existing {
            if meta_sha.as_deref() == Some(sha.as_str()) {
                return Err("已在库中".into());
            }
        }
    }

    let item_dir = lib.files_dir().join(uuid::Uuid::new_v4().to_string());
    std::fs::create_dir_all(&item_dir).map_err(|e| e.to_string())?;
    let dest = item_dir.join(&file_name);
    if let Err(e) = std::fs::copy(path, &dest) {
        let _ = std::fs::remove_dir_all(&item_dir);
        return Err(format!("复制失败: {e}"));
    }
    let rel = lib.relative_path(&dest);
    let meta = serde_json::json!({
        "sourcePath": source,
        "sha256": sha,
        "linked": link_source,
    })
    .to_string();

    let collection_ids: Vec<String> = collection_id
        .map(|c| vec![c.to_string()])
        .unwrap_or_default();
    let mime = mime_of(&file_name);
    let content = if crate::library::native::is_text_file(&mime, &file_name)
        && size <= crate::library::native::MAX_TEXT_FILE_BYTES as i64
    {
        std::fs::read_to_string(&dest).unwrap_or_default()
    } else {
        String::new()
    };
    let id = lib.insert_item(
        "file",
        &file_name,
        &content,
        "",
        &rel,
        size,
        &mime,
        &meta,
        &collection_ids,
    )?;
    if mime == "application/pdf" {
        let _ = lib.index_pdf_item(&id, &dest);
    }
    let item = lib.get_item(&id)?.item;
    Ok(Some(ImportOutcome {
        item,
        file_name,
        size,
    }))
}

fn validate_source(lib: &Library, path: &Path) -> Result<PathBuf, String> {
    let metadata = std::fs::symlink_metadata(path).map_err(|error| error.to_string())?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err("只能链接普通文件".into());
    }
    let source = path.canonicalize().map_err(|error| error.to_string())?;
    let root = lib.root.canonicalize().map_err(|error| error.to_string())?;
    if source.starts_with(root) {
        return Err("不能链接资料库内部的文件".into());
    }
    Ok(source)
}

struct Replacement {
    destination: PathBuf,
    backup: PathBuf,
}

impl Replacement {
    fn commit(self) {
        let _ = std::fs::remove_file(self.backup);
    }

    fn rollback(self) -> Result<(), String> {
        let _ = std::fs::remove_file(&self.destination);
        std::fs::rename(self.backup, self.destination).map_err(|error| error.to_string())
    }
}

fn replace_file(source: &Path, destination: &Path) -> Result<Replacement, String> {
    let parent = destination.parent().ok_or("无效的文件目录")?;
    let token = uuid::Uuid::new_v4();
    let temporary = parent.join(format!(".nookspace-{token}.tmp"));
    let backup = parent.join(format!(".nookspace-{token}.bak"));
    let result = (|| {
        std::fs::copy(source, &temporary).map_err(|error| error.to_string())?;
        if sha256_of(source)? != sha256_of(&temporary)? {
            return Err("文件同步校验失败".into());
        }
        std::fs::rename(destination, &backup).map_err(|error| error.to_string())?;
        if let Err(error) = std::fs::rename(&temporary, destination) {
            let _ = std::fs::rename(&backup, destination);
            return Err(error.to_string());
        }
        Ok(Replacement {
            destination: destination.to_path_buf(),
            backup,
        })
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(temporary);
    }
    result
}

pub(super) fn linked_rows(
    lib: &Library,
    ids: Option<&[String]>,
) -> Result<Vec<(String, String, String, String, String)>, String> {
    let conn = lib.db.lock().unwrap();
    let mut sql = "SELECT id, stored_path, json_extract(meta, '$.sourcePath'), json_extract(meta, '$.sha256'), mime FROM items WHERE type = 'file' AND deleted_at IS NULL AND json_extract(meta, '$.linked') = 1".to_string();
    if let Some(ids) = ids {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        sql.push_str(&format!(" AND id IN ({})", vec!["?"; ids.len()].join(",")));
    }
    let mut stmt = conn.prepare(&sql).map_err(|error| error.to_string())?;
    let parameters = ids.unwrap_or(&[]);
    let rows = stmt
        .query_map(rusqlite::params_from_iter(parameters), |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
            ))
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn text_content(mime: &str, path: &Path, size: i64) -> String {
    if crate::library::native::is_text_file(mime, path.to_string_lossy().as_ref())
        && size <= crate::library::native::MAX_TEXT_FILE_BYTES as i64
    {
        std::fs::read_to_string(path).unwrap_or_default()
    } else {
        String::new()
    }
}

fn sync_row(
    lib: &Library,
    id: &str,
    stored_path: &str,
    source_path: &str,
    baseline: &str,
    mime: &str,
) -> Result<bool, String> {
    let source = PathBuf::from(source_path);
    validate_source(lib, &source)?;
    let source_sha = sha256_of(&source)?;
    let destination = lib.safe_stored_path(stored_path)?;
    let destination_matches =
        destination.is_file() && sha256_of(&destination).is_ok_and(|sha| sha == source_sha);
    if source_sha == baseline && destination_matches {
        return Ok(false);
    }
    let size = std::fs::metadata(&source)
        .map_err(|error| error.to_string())?
        .len() as i64;
    let content = text_content(mime, &source, size);
    let replacement = replace_file(&source, &destination)?;
    let updated = lib.db.lock().unwrap().execute(
        "UPDATE items SET size = ?1, content = ?2, updated_at = datetime('now'), meta = json_set(meta, '$.sha256', ?3) WHERE id = ?4 AND deleted_at IS NULL",
        params![size, content, source_sha, id],
    );
    if let Err(error) = updated {
        replacement.rollback()?;
        return Err(error.to_string());
    }
    replacement.commit();
    let _ = std::fs::remove_file(lib.thumb_dir().join(format!("{id}.png")));
    if mime == "application/pdf" {
        let _ = lib.index_pdf_item(id, &destination);
    }
    Ok(true)
}

pub fn sync_linked_sources(
    lib: &Library,
    ids: Option<&[String]>,
) -> Result<LinkedSyncResult, String> {
    let _files = lib.files_lock.lock().unwrap();
    let rows = linked_rows(lib, ids)?;
    let mut statuses = Vec::with_capacity(rows.len());
    let mut updated_ids = Vec::new();
    for (id, stored, source, sha, mime) in rows {
        let state = if !Path::new(&source).exists() {
            "missing"
        } else {
            match sync_row(lib, &id, &stored, &source, &sha, &mime) {
                Ok(updated) => {
                    if updated {
                        updated_ids.push(id.clone());
                    }
                    "available"
                }
                Err(_) => "error",
            }
        };
        statuses.push(LinkedSourceStatus {
            id,
            state: state.into(),
        });
    }
    Ok(LinkedSyncResult {
        statuses,
        updated_ids,
        watching: lib
            .source_watcher
            .as_ref()
            .is_some_and(|watcher| watcher.lock().unwrap().available()),
    })
}

pub fn linked_source(lib: &Library, id: &str) -> Result<Option<PathBuf>, String> {
    lib.db
        .lock()
        .unwrap()
        .query_row(
            "SELECT json_extract(meta, '$.sourcePath') FROM items WHERE id = ?1 AND deleted_at IS NULL AND json_extract(meta, '$.linked') = 1",
            params![id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map(|source| source.map(PathBuf::from))
        .map_err(|error| error.to_string())
}

pub fn relink_source(
    lib: &Library,
    id: &str,
    source_path: &str,
    strategy: Option<&str>,
) -> Result<RelinkSourceResult, String> {
    let _files = lib.files_lock.lock().unwrap();
    if linked_source(lib, id)?.is_none() {
        return Err("该文件不是链接文件".into());
    }
    let source = validate_source(lib, Path::new(source_path))?;
    let source_path = source.to_string_lossy().to_string();
    let item = lib.get_item(id)?.item;
    let stored = lib.safe_stored_path(&item.stored_path)?;
    let source_sha = sha256_of(&source)?;
    let stored_sha = sha256_of(&stored)?;
    if source_sha != stored_sha && strategy.is_none() {
        return Ok(RelinkSourceResult::NeedsChoice);
    }
    let final_sha = match strategy {
        Some("keepLibrary") if source_sha != stored_sha => {
            let replacement = replace_file(&stored, &source)?;
            let update = lib.db.lock().unwrap().execute(
                "UPDATE items SET meta = json_set(meta, '$.sourcePath', ?1, '$.sha256', ?2, '$.linked', json('true')) WHERE id = ?3",
                params![source_path, stored_sha, id],
            );
            if let Err(error) = update {
                replacement.rollback()?;
                return Err(error.to_string());
            }
            replacement.commit();
            stored_sha
        }
        Some("useSource") | None if source_sha != stored_sha => {
            sync_row(lib, id, &item.stored_path, &source_path, "", &item.mime)?;
            source_sha
        }
        Some(value) if !matches!(value, "useSource" | "keepLibrary") => {
            return Err("无效的重新链接策略".into())
        }
        _ => source_sha,
    };
    lib.db.lock().unwrap().execute(
        "UPDATE items SET meta = json_set(meta, '$.sourcePath', ?1, '$.sha256', ?2, '$.linked', json('true')) WHERE id = ?3",
        params![source_path, final_sha, id],
    ).map_err(|error| error.to_string())?;
    let _ = lib.refresh_source_watches();
    Ok(RelinkSourceResult::Linked {
        detail: lib.get_item(id)?,
    })
}

pub fn detach_source(
    lib: &Library,
    id: &str,
) -> Result<crate::library::models::ItemDetail, String> {
    let conn = lib.db.lock().unwrap();
    lib.require_item_access(&conn, id)?;
    let updated = conn.execute(
        "UPDATE items SET meta = json_remove(meta, '$.linked') WHERE id = ?1 AND json_extract(meta, '$.linked') = 1",
        params![id],
    ).map_err(|error| error.to_string())?;
    if updated != 1 {
        return Err("该文件不是链接文件".into());
    }
    drop(conn);
    let _ = lib.refresh_source_watches();
    lib.get_item(id)
}
