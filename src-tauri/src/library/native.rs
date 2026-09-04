use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::Path;
use std::process::Command;

use rusqlite::params;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::library::models::{TextFileDocument, TextFileWriteResult};
use crate::library::Library;

pub(super) const MAX_TEXT_FILE_BYTES: u64 = 5 * 1024 * 1024;
const UTF8_BOM: &[u8] = b"\xef\xbb\xbf";

pub(super) fn is_media(mime: &str, name: &str) -> bool {
    const MEDIA_EXTENSIONS: &[&str] = &[
        "3gp", "aac", "aif", "aiff", "avi", "caf", "flac", "flv", "m4a", "m4v", "mkv", "mov",
        "mp3", "mp4", "mpeg", "mpg", "oga", "ogg", "ogv", "opus", "wav", "webm", "wma", "wmv",
    ];
    let extension = name.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    mime.starts_with("audio/")
        || mime.starts_with("video/")
        || MEDIA_EXTENSIONS.contains(&extension.as_str())
}

pub(super) fn is_text_file(mime: &str, name: &str) -> bool {
    const TEXT_EXTENSIONS: &[&str] = &[
        "txt", "md", "markdown", "log", "html", "htm", "csv", "json", "yaml", "yml",
    ];
    let extension = file_extension(name);
    mime.starts_with("text/")
        || mime == "application/json"
        || mime == "application/yaml"
        || TEXT_EXTENSIONS.contains(&extension.as_str())
}

pub(super) fn is_html_file(mime: &str, name: &str) -> bool {
    let extension = file_extension(name);
    mime.eq_ignore_ascii_case("text/html") || matches!(extension.as_str(), "html" | "htm")
}

pub(super) fn file_extension(name: &str) -> String {
    Path::new(name)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(name)
        .rsplit_once('.')
        .filter(|(stem, _)| !stem.is_empty())
        .map(|(_, ext)| ext.to_ascii_lowercase())
        .unwrap_or_default()
}

pub(super) fn canonical_format(ext: &str) -> Option<&'static str> {
    match ext.to_ascii_lowercase().as_str() {
        "md" | "markdown" => Some("md"),
        "txt" => Some("txt"),
        "json" => Some("json"),
        "yaml" | "yml" => Some("yaml"),
        "csv" => Some("csv"),
        _ => None,
    }
}

pub(super) fn stored_extension(format: &str) -> Option<&'static str> {
    match format {
        "md" => Some("md"),
        "txt" => Some("txt"),
        "json" => Some("json"),
        "yaml" => Some("yaml"),
        "csv" => Some("csv"),
        _ => None,
    }
}

pub(super) fn is_switchable_text(name: &str) -> bool {
    canonical_format(&file_extension(name)).is_some()
}

pub(super) fn sanitize_stem(stem: &str) -> Result<String, String> {
    let trimmed = stem.trim();
    if trimmed.is_empty() {
        return Err("名称不能为空".into());
    }
    if trimmed == "." || trimmed == ".." {
        return Err("无效的文件名".into());
    }
    if trimmed.contains(['/', '\\', '\0', ':']) {
        return Err("名称不能包含路径字符".into());
    }
    Ok(trimmed.to_string())
}

pub(super) fn safe_stem(stem: &str) -> String {
    let replaced: String = stem
        .chars()
        .map(|ch| match ch {
            '/' | '\\' | ':' | '\0' => '-',
            ch => ch,
        })
        .collect();
    let trimmed = replaced.trim().trim_end_matches(['.', ' ']);
    if trimmed.is_empty() || trimmed == "." || trimmed == ".." {
        "无标题".into()
    } else {
        trimmed.to_string()
    }
}

pub(super) fn sha256_bytes(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

fn normalize_line_endings(content: &str) -> String {
    content.replace("\r\n", "\n").replace('\r', "\n")
}

fn first_line_ending(content: &str) -> &'static str {
    let bytes = content.as_bytes();
    for (index, byte) in bytes.iter().enumerate() {
        if *byte == b'\n' {
            return if index > 0 && bytes[index - 1] == b'\r' {
                "crlf"
            } else {
                "lf"
            };
        }
        if *byte == b'\r' && bytes.get(index + 1) != Some(&b'\n') {
            return "cr";
        }
    }
    "lf"
}

fn decode_text(bytes: &[u8]) -> Result<TextFileDocument, String> {
    let (encoding, body) = if bytes.starts_with(UTF8_BOM) {
        ("utf8Bom", &bytes[UTF8_BOM.len()..])
    } else {
        ("utf8", bytes)
    };
    let content = std::str::from_utf8(body).map_err(|_| "文件不是有效的 UTF-8 文本".to_string())?;
    Ok(TextFileDocument {
        content: normalize_line_endings(content),
        version: sha256_bytes(bytes),
        encoding: encoding.into(),
        line_ending: first_line_ending(content).into(),
    })
}

fn encode_text(content: &str, encoding: &str, line_ending: &str) -> Result<Vec<u8>, String> {
    let newline = match line_ending {
        "lf" => "\n",
        "crlf" => "\r\n",
        "cr" => "\r",
        _ => return Err("无效的换行格式".into()),
    };
    if !matches!(encoding, "utf8" | "utf8Bom") {
        return Err("无效的文本编码".into());
    }
    let normalized = normalize_line_endings(content);
    let mut bytes = Vec::with_capacity(normalized.len() + UTF8_BOM.len());
    if encoding == "utf8Bom" {
        bytes.extend_from_slice(UTF8_BOM);
    }
    if newline == "\n" {
        bytes.extend_from_slice(normalized.as_bytes());
    } else {
        bytes.extend_from_slice(normalized.replace('\n', newline).as_bytes());
    }
    if bytes.len() as u64 > MAX_TEXT_FILE_BYTES {
        return Err("文本超过 5 MiB，无法在应用内保存".into());
    }
    Ok(bytes)
}

pub fn read_text_file(lib: &Library, id: &str) -> Result<TextFileDocument, String> {
    let item = lib.get_item(id)?.item;
    if item.item_type != "file"
        || item.stored_path.is_empty()
        || !is_text_file(&item.mime, &item.stored_path)
    {
        return Err("此类型暂不支持内置文本阅读".into());
    }
    let path = lib.safe_stored_path(&item.stored_path)?;
    if fs::metadata(&path)
        .map_err(|error| error.to_string())?
        .len()
        > MAX_TEXT_FILE_BYTES
    {
        return Err("文本超过 5 MiB，请使用默认应用打开".into());
    }
    decode_text(&fs::read(path).map_err(|error| error.to_string())?)
}

pub fn write_text_file(
    lib: &Library,
    id: &str,
    content: &str,
    expected_version: &str,
    encoding: &str,
    line_ending: &str,
) -> Result<TextFileWriteResult, String> {
    let item = lib.get_item(id)?.item;
    if item.item_type != "file"
        || item.stored_path.is_empty()
        || !is_text_file(&item.mime, &item.stored_path)
    {
        return Err("此类型不支持内置文本编辑".into());
    }
    if is_html_file(&item.mime, &item.stored_path) {
        return Err("HTML 文件仅支持阅读".into());
    }
    if item.deleted_at.is_some() {
        return Err("回收站中的文件不可编辑".into());
    }

    let path = lib.safe_stored_path(&item.stored_path)?;
    if fs::metadata(&path)
        .map_err(|error| error.to_string())?
        .len()
        > MAX_TEXT_FILE_BYTES
    {
        return Err("文本超过 5 MiB，无法在应用内保存".into());
    }
    let original = fs::read(&path).map_err(|error| error.to_string())?;
    let current_version = sha256_bytes(&original);
    if current_version != expected_version {
        return Ok(TextFileWriteResult::Conflict {
            version: current_version,
        });
    }

    let replacement = encode_text(content, encoding, line_ending)?;
    let version = sha256_bytes(&replacement);
    if replacement == original {
        return Ok(TextFileWriteResult::Saved { item, version });
    }

    let parent = path.parent().ok_or("无效的库内文件目录")?;
    let token = Uuid::new_v4();
    let temporary = parent.join(format!(".nookspace-{token}.tmp"));
    let backup = parent.join(format!(".nookspace-{token}.bak"));
    let result = (|| {
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary)
            .map_err(|error| error.to_string())?;
        file.write_all(&replacement)
            .and_then(|_| file.sync_all())
            .map_err(|error| error.to_string())?;
        fs::set_permissions(
            &temporary,
            fs::metadata(&path)
                .map_err(|error| error.to_string())?
                .permissions(),
        )
        .map_err(|error| error.to_string())?;
        fs::copy(&path, &backup).map_err(|error| error.to_string())?;
        if let Err(error) = fs::rename(&temporary, &path) {
            let _ = fs::remove_file(&backup);
            return Err(error.to_string());
        }

        let database_result = (|| {
            let mut conn = lib.db.lock().unwrap();
            let tx = conn.transaction().map_err(|error| error.to_string())?;
            let updated = tx
                .execute(
                    "UPDATE items SET size = ?1, content = ?2, updated_at = datetime('now'), \
                     meta = json_set(meta, '$.sha256', ?3) \
                     WHERE id = ?4 AND type = 'file' AND deleted_at IS NULL",
                    params![replacement.len() as i64, content, version, id],
                )
                .map_err(|error| error.to_string())?;
            if updated != 1 {
                return Err("文件条目不可编辑".into());
            }
            tx.commit().map_err(|error| error.to_string())
        })();

        if let Err(error) = database_result {
            return match fs::rename(&backup, &path) {
                Ok(()) => Err(error),
                Err(restore_error) => Err(format!(
                    "保存元数据失败：{error}；恢复原文件失败：{restore_error}"
                )),
            };
        }
        let _ = fs::remove_file(&backup);
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result?;

    Ok(TextFileWriteResult::Saved {
        item: lib.get_item(id)?.item,
        version,
    })
}

/// Open a File item with the system default app (macOS `open` semantics via
/// the opener plugin).
pub fn open_with_default(lib: &Library, id: &str) -> Result<(), String> {
    let detail = lib.get_item(id)?;
    if detail.item.item_type != "file" || detail.item.stored_path.is_empty() {
        return Err("该条目没有可打开的文件".into());
    }
    let abs = lib.safe_stored_path(&detail.item.stored_path)?;
    tauri_plugin_opener::open_path(&abs, None::<&str>).map_err(|e| e.to_string())
}

/// Show the native QuickLook panel for a File item (external `qlmanage -p`
/// window — the robust path; a plugin-based in-app panel is a later upgrade).
pub fn quicklook(lib: &Library, id: &str) -> Result<(), String> {
    let detail = lib.get_item(id)?;
    if detail.item.item_type != "file" || detail.item.stored_path.is_empty() {
        return Err("该条目没有可预览的文件".into());
    }
    if is_media(&detail.item.mime, &detail.item.stored_path) {
        return Err("音视频文件不支持快速查看，请使用默认应用打开".into());
    }
    let abs = lib.safe_stored_path(&detail.item.stored_path)?;
    Command::new("qlmanage")
        .arg("-p")
        .arg(&abs)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Generate (or return cached) thumbnail for a File item.
/// Returns the absolute path to a PNG, or None when unavailable.
pub fn generate_thumbnail(lib: &Library, id: &str) -> Result<Option<String>, String> {
    let detail = lib.get_item(id)?;
    let item = &detail.item;
    if item.item_type != "file" || item.stored_path.is_empty() {
        return Ok(None);
    }
    if is_media(&item.mime, &item.stored_path) {
        return Ok(None);
    }

    let cached = lib.thumb_dir().join(format!("{id}.png"));
    let abs = lib.safe_stored_path(&item.stored_path)?;
    let needs_regenerate = match std::fs::metadata(&cached) {
        Ok(m) => match std::fs::metadata(&abs) {
            Ok(src) => m.modified().ok() < src.modified().ok(),
            Err(_) => true,
        },
        Err(_) => true,
    };

    if needs_regenerate {
        let out_dir = lib.thumb_dir();
        let output = Command::new("qlmanage")
            .args(["-t", "-s", "256", "-o"])
            .arg(&out_dir)
            .arg(&abs)
            .output()
            .map_err(|e| e.to_string())?;
        if output.status.success() {
            // qlmanage writes `<name>.<ext>.png` into the output dir.
            let name = abs
                .file_name()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();
            let produced = out_dir.join(format!("{name}.png"));
            if produced.exists() {
                let _ = std::fs::rename(&produced, &cached);
            }
        }
    }

    if cached.exists() {
        Ok(Some(cached.to_string_lossy().to_string()))
    } else {
        Ok(None)
    }
}

#[cfg(test)]
mod tests {
    use super::{
        decode_text, encode_text, is_media, is_switchable_text, is_text_file, MAX_TEXT_FILE_BYTES,
        UTF8_BOM,
    };

    #[test]
    fn media_files_are_not_previewed() {
        assert!(is_media("audio/mpeg", "track.bin"));
        assert!(is_media("video/mp4", "movie.bin"));
        assert!(is_media("application/octet-stream", "recording.M4A"));
        assert!(is_media("application/octet-stream", "movie.webm"));
        assert!(!is_media("application/pdf", "document.pdf"));
        assert!(!is_media("image/png", "image.png"));
    }

    #[test]
    fn text_files_preserve_utf8_bom_and_first_line_ending() {
        assert!(is_text_file("application/octet-stream", "events.LOG"));
        assert!(is_text_file("application/json", "data.bin"));
        assert!(is_text_file("text/yaml", "config.yaml"));
        assert!(!is_text_file("application/pdf", "document.pdf"));
        assert!(is_switchable_text("note.md"));
        assert!(!is_switchable_text("photo.png"));

        let bytes = [UTF8_BOM, b"one\r\ntwo\n"].concat();
        let document = decode_text(&bytes).unwrap();
        assert_eq!(document.content, "one\ntwo\n");
        assert_eq!(document.encoding, "utf8Bom");
        assert_eq!(document.line_ending, "crlf");
        assert_eq!(
            encode_text(&document.content, &document.encoding, &document.line_ending).unwrap(),
            [UTF8_BOM, b"one\r\ntwo\r\n"].concat()
        );
        assert!(decode_text(&[0xff]).is_err());
        assert!(encode_text(&"a".repeat(MAX_TEXT_FILE_BYTES as usize + 1), "utf8", "lf").is_err());
    }
}
