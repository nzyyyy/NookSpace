use std::io::Read;
use std::path::{Path, PathBuf};

use rusqlite::{params, OptionalExtension};
use sha2::{Digest, Sha256};

use crate::library::models::{ImportOutcome, ImportResult, ImportSkip};
use crate::library::Library;

/// Import source files into the Library: copy each file into the managed
/// directory (never touching the source), dedupe by source path + sha256,
/// recurse into folders. A dropped folder becomes (or reuses) a Collection
/// named after it, and its files are imported into that Collection.
pub fn import_files(
    lib: &Library,
    paths: &[String],
    collection_id: Option<&str>,
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
        match import_one(lib, &file, cid.as_deref()) {
            Ok(Some(outcome)) => result.imported.push(outcome),
            Ok(None) => {}
            Err(reason) => result.skipped.push(ImportSkip {
                path: file.to_string_lossy().to_string(),
                reason,
            }),
        }
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
) -> Result<Option<ImportOutcome>, String> {
    let file_name = path
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    if file_name.is_empty() {
        return Err("无法识别的文件".into());
    }
    let source = path.to_string_lossy().to_string();
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
    let meta = serde_json::json!({ "sourcePath": source, "sha256": sha }).to_string();

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
