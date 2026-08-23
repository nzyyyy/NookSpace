use std::process::Command;

use crate::library::Library;

/// Open a File item with the system default app (macOS `open` semantics via
/// the opener plugin).
pub fn open_with_default(lib: &Library, id: &str) -> Result<(), String> {
    let detail = lib.get_item(id)?;
    if detail.item.item_type != "file" || detail.item.stored_path.is_empty() {
        return Err("该条目没有可打开的文件".into());
    }
    let abs = lib.absolute_path(&detail.item.stored_path);
    tauri_plugin_opener::open_path(&abs, None::<&str>).map_err(|e| e.to_string())
}

/// Show the native QuickLook panel for a File item (external `qlmanage -p`
/// window — the robust path; a plugin-based in-app panel is a later upgrade).
pub fn quicklook(lib: &Library, id: &str) -> Result<(), String> {
    let detail = lib.get_item(id)?;
    if detail.item.item_type != "file" || detail.item.stored_path.is_empty() {
        return Err("该条目没有可预览的文件".into());
    }
    let abs = lib.absolute_path(&detail.item.stored_path);
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

    let cached = lib.thumb_dir().join(format!("{id}.png"));
    let abs = lib.absolute_path(&item.stored_path);
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
