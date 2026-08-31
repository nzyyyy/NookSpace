use std::collections::{HashMap, HashSet};
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use rusqlite::{params, params_from_iter, Connection, OptionalExtension, Row};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

use crate::library::models::*;

pub mod db;
pub mod import;
pub mod models;
pub mod native;
mod saved;
mod search;
mod transfer;

const FILES_DIR: &str = "files";
const THUMB_DIR: &str = "thumb";
const LOCATION_FILE: &str = "library-location";
const TAG_COLORS: &[&str] = &["red", "orange", "amber", "green", "blue", "purple", "pink"];
const LOCKED_ERROR: &str = "需要先解锁";

/// The deep module: everything the app knows about its Library lives behind
/// these methods. The frontend never touches SQL or the filesystem directly.
#[derive(Clone)]
pub struct Library {
    db: Arc<Mutex<Connection>>,
    root: PathBuf,
    cache: PathBuf,
    app_data: PathBuf,
    files_lock: Arc<Mutex<()>>,
    unlocked_until: Arc<Mutex<Option<Instant>>>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    struct TestRoot(PathBuf);

    impl Drop for TestRoot {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn library() -> Library {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        db::migrate(&mut conn).unwrap();
        Library {
            db: Arc::new(Mutex::new(conn)),
            root: PathBuf::new(),
            cache: PathBuf::new(),
            app_data: PathBuf::new(),
            files_lock: Arc::new(Mutex::new(())),
            unlocked_until: Arc::new(Mutex::new(None)),
        }
    }

    fn disk_library() -> (TestRoot, Library) {
        let base = std::env::temp_dir().join(format!("nookspace-test-{}", uuid()));
        let root = base.join("library");
        let cache = base.join("cache");
        let app_data = base.join("bootstrap");
        fs::create_dir_all(root.join(FILES_DIR)).unwrap();
        fs::create_dir_all(&cache).unwrap();
        fs::create_dir_all(&app_data).unwrap();
        let mut conn = db::open_db(&root.join("nook.db")).unwrap();
        db::migrate(&mut conn).unwrap();
        let lib = Library {
            db: Arc::new(Mutex::new(conn)),
            root,
            cache,
            app_data,
            files_lock: Arc::new(Mutex::new(())),
            unlocked_until: Arc::new(Mutex::new(None)),
        };
        lib.migrate_notes_to_files().unwrap();
        (TestRoot(base), lib)
    }

    fn write_pdf(path: &Path, text: Option<&str>) {
        let stream = text
            .map(|text| format!("BT /F1 12 Tf 72 720 Td ({text}) Tj ET"))
            .unwrap_or_default();
        let objects = [
            "<< /Type /Catalog /Pages 2 0 R >>".to_string(),
            "<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_string(),
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>".to_string(),
            "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>".to_string(),
            format!("<< /Length {} >>\nstream\n{stream}\nendstream", stream.len()),
        ];
        let mut pdf = b"%PDF-1.4\n".to_vec();
        let mut offsets = Vec::new();
        for (index, object) in objects.iter().enumerate() {
            offsets.push(pdf.len());
            pdf.extend_from_slice(format!("{} 0 obj\n{object}\nendobj\n", index + 1).as_bytes());
        }
        let xref = pdf.len();
        pdf.extend_from_slice(
            format!("xref\n0 {}\n0000000000 65535 f \n", objects.len() + 1).as_bytes(),
        );
        for offset in offsets {
            pdf.extend_from_slice(format!("{offset:010} 00000 n \n").as_bytes());
        }
        pdf.extend_from_slice(
            format!(
                "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n",
                objects.len() + 1
            )
            .as_bytes(),
        );
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, pdf).unwrap();
    }

    #[test]
    fn collection_tree_moves_filters_and_deletes_without_deleting_items() {
        let (_temp, lib) = disk_library();
        let root = lib.create_collection("Root", None).unwrap();
        let child = lib.create_collection("Child", Some(&root.id)).unwrap();
        let sibling = lib.create_collection("Sibling", None).unwrap();
        let note = lib
            .create_note("Note", "body", &[child.id.clone()])
            .unwrap();

        lib.add_items_to_collection(&[note.id.clone()], &sibling.id)
            .unwrap();
        lib.move_collection(&sibling.id, Some(&root.id), Some(&child.id))
            .unwrap();
        assert!(lib
            .move_collection(&root.id, Some(&child.id), None)
            .is_err());

        let children: Vec<_> = lib
            .list_collections()
            .unwrap()
            .into_iter()
            .filter(|collection| collection.parent_id.as_deref() == Some(&root.id))
            .collect();
        assert_eq!(
            children.iter().map(|c| c.id.as_str()).collect::<Vec<_>>(),
            [&sibling.id, &child.id]
        );

        let items = lib
            .list_items(&ListFilters {
                collection_id: Some(root.id.clone()),
                ..ListFilters::default()
            })
            .unwrap();
        assert_eq!(
            items.entries.len(),
            1,
            "an item in two descendants must be deduplicated"
        );

        assert_eq!(lib.delete_collection_tree(&root.id).unwrap(), 3);
        assert_eq!(lib.get_item(&note.id).unwrap().item.id, note.id);
        let uncollected = lib
            .list_items(&ListFilters {
                view: "uncollected".into(),
                ..ListFilters::default()
            })
            .unwrap();
        assert_eq!(uncollected.entries.len(), 1);
    }

    #[test]
    fn locked_collections_can_reorder_but_not_reparent() {
        let (_temp, lib) = disk_library();
        let first = lib.create_collection("First", None).unwrap();
        let locked = lib.create_collection("Locked", None).unwrap();
        lib.set_collection_locked(&locked.id, true).unwrap();

        lib.move_collection(&locked.id, None, Some(&first.id))
            .unwrap();
        assert_eq!(lib.list_collections().unwrap()[0].id, locked.id);
        assert!(lib
            .move_collection(&locked.id, Some(&first.id), None)
            .is_err());
    }

    #[test]
    fn unlocked_collection_can_move_with_locked_descendants() {
        let (_temp, lib) = disk_library();
        let root = lib.create_collection("Root", None).unwrap();
        let locked = lib.create_collection("Locked", Some(&root.id)).unwrap();
        let target = lib.create_collection("Target", None).unwrap();
        lib.set_collection_locked(&locked.id, true).unwrap();

        lib.move_collection(&root.id, Some(&target.id), None)
            .unwrap();
        assert_eq!(
            lib.list_collections()
                .unwrap()
                .into_iter()
                .find(|collection| collection.id == root.id)
                .unwrap()
                .parent_id,
            Some(target.id)
        );
    }

    #[test]
    fn locks_inherit_redact_search_and_guard_mutations() {
        let lib = library();
        let root = lib.create_collection("Private", None).unwrap();
        let child = lib.create_collection("Nested", Some(&root.id)).unwrap();
        let other = lib.create_collection("Other", None).unwrap();
        let item = lib
            .create_link(
                "https://example.test/hidden-token",
                "Visible title",
                &[child.id.clone(), other.id.clone()],
            )
            .unwrap();
        let secret = lib.create_tag("SecretTag").unwrap();
        lib.set_item_tags(&item.id, &[secret.id.clone()]).unwrap();

        lib.set_collection_locked(&root.id, true).unwrap();
        let collections = lib.list_collections().unwrap();
        assert!(
            collections
                .iter()
                .find(|c| c.id == root.id)
                .unwrap()
                .is_locked
        );
        let nested = collections.iter().find(|c| c.id == child.id).unwrap();
        assert!(!nested.is_locked && nested.effective_locked);

        let all = lib.list_items(&ListFilters::default()).unwrap();
        let locked = &all.entries[0];
        assert_eq!(locked.item.title, "Visible title");
        assert!(locked.item.collection_locked);
        assert!(locked.item.effective_locked);
        assert!(locked.item.url.is_empty());
        assert!(locked.item.tags.is_empty());
        assert!(locked.snippet.is_none());

        let search = |query: &str| ListFilters {
            query: Some(query.into()),
            ..ListFilters::default()
        };
        assert!(lib
            .list_items(&search("hidden-token"))
            .unwrap()
            .entries
            .is_empty());
        assert_eq!(lib.list_items(&search("Visible")).unwrap().entries.len(), 1);
        assert_eq!(
            lib.list_items(&search("type:link")).unwrap().entries.len(),
            1
        );
        for query in ["tag:SecretTag", "collection:Nested", "date:>2000-01-01"] {
            assert!(lib.list_items(&search(query)).unwrap().entries.is_empty());
        }
        for filters in [
            ListFilters {
                collection_id: Some(child.id.clone()),
                ..ListFilters::default()
            },
            ListFilters {
                tag_id: Some(secret.id.clone()),
                ..ListFilters::default()
            },
        ] {
            assert!(lib.list_items(&filters).unwrap().entries.is_empty());
        }
        assert_eq!(lib.get_item(&item.id).unwrap_err(), LOCKED_ERROR);
        assert_eq!(lib.set_favorite(&item.id, true).unwrap_err(), LOCKED_ERROR);
        assert_eq!(
            lib.set_collection_locked(&root.id, false).unwrap_err(),
            LOCKED_ERROR
        );

        lib.unlock_for_session(10).unwrap();
        assert_eq!(
            lib.get_item(&item.id).unwrap().item.url,
            "https://example.test/hidden-token"
        );
        assert_eq!(
            lib.list_items(&search("tag:SecretTag"))
                .unwrap()
                .entries
                .len(),
            1
        );
        *lib.unlocked_until.lock().unwrap() = Some(Instant::now() - Duration::from_secs(1));
        assert!(!lib.lock_session().unlocked);
        assert_eq!(lib.get_item(&item.id).unwrap_err(), LOCKED_ERROR);
        lib.unlock_for_session(10).unwrap();
        lib.set_favorite(&item.id, true).unwrap();
        lib.set_collection_locked(&root.id, false).unwrap();
        lib.lock_now();
        assert!(
            !lib.list_items(&ListFilters::default()).unwrap().entries[0]
                .item
                .effective_locked
        );

        lib.set_items_locked(std::slice::from_ref(&item.id), true)
            .unwrap();
        assert_eq!(
            lib.delete_items(std::slice::from_ref(&item.id))
                .unwrap_err(),
            LOCKED_ERROR
        );
    }

    #[test]
    fn privacy_isolated_locked_and_forgets_collections() {
        let (_temp, lib) = disk_library();
        let first = lib.create_collection("First", None).unwrap();
        let second = lib.create_collection("Second", None).unwrap();
        let file = lib
            .create_note(
                "Secret file",
                "private body",
                &[first.id.clone(), second.id.clone()],
            )
            .unwrap();
        let visible_parent = lib.create_note("Visible parent", "body", &[]).unwrap();
        lib.add_attachments(&visible_parent.id, std::slice::from_ref(&file.id))
            .unwrap();
        let tag = lib.create_tag("Secret tag").unwrap();
        lib.set_item_tags(&file.id, std::slice::from_ref(&tag.id))
            .unwrap();
        lib.set_favorite(&file.id, true).unwrap();
        lib.set_items_locked(std::slice::from_ref(&file.id), true)
            .unwrap();
        lib.unlock_for_session(10).unwrap();
        lib.set_items_private(std::slice::from_ref(&file.id), true)
            .unwrap();
        lib.lock_now();

        let privacy = ListFilters {
            view: "privacy".into(),
            ..ListFilters::default()
        };
        assert!(lib.list_items(&privacy).unwrap().entries.is_empty());
        assert!(!lib
            .list_items(&ListFilters::default())
            .unwrap()
            .entries
            .iter()
            .any(|entry| entry.item.id == file.id));
        assert!(lib
            .list_items(&ListFilters {
                view: "favorites".into(),
                ..ListFilters::default()
            })
            .unwrap()
            .entries
            .is_empty());
        assert!(lib
            .list_items(&ListFilters {
                tag_id: Some(tag.id.clone()),
                ..ListFilters::default()
            })
            .unwrap()
            .entries
            .is_empty());
        assert_eq!(lib.get_item(&file.id).unwrap_err(), LOCKED_ERROR);
        assert_eq!(
            lib.require_library_export_access().unwrap_err(),
            LOCKED_ERROR
        );

        lib.unlock_for_session(10).unwrap();
        let private = &lib.list_items(&privacy).unwrap().entries[0].item;
        assert!(private.is_private && private.is_locked && private.effective_locked);
        assert!(private.collections.is_empty());
        assert_eq!(private.tags.len(), 1);
        assert!(private.is_favorite);
        assert!(lib
            .add_items_to_collection(std::slice::from_ref(&file.id), &first.id)
            .is_err());
        assert!(lib
            .get_item(&visible_parent.id)
            .unwrap()
            .attachments
            .is_empty());
        assert!(lib
            .add_attachments(&visible_parent.id, std::slice::from_ref(&file.id))
            .is_err());

        let link = lib
            .create_link("https://example.test", "Link", &[])
            .unwrap();
        assert!(lib
            .set_items_private(std::slice::from_ref(&link.id), true)
            .is_err());

        lib.set_items_private(std::slice::from_ref(&file.id), false)
            .unwrap();
        let uncollected = lib
            .list_items(&ListFilters {
                view: "uncollected".into(),
                ..ListFilters::default()
            })
            .unwrap();
        let moved = uncollected
            .entries
            .iter()
            .find(|entry| entry.item.id == file.id)
            .unwrap();
        assert!(moved.item.is_locked && !moved.item.is_private);
        assert!(moved.item.collections.is_empty());

        let trashed = lib.create_note("Trash secret", "hidden", &[]).unwrap();
        lib.set_items_private(std::slice::from_ref(&trashed.id), true)
            .unwrap();
        lib.delete_items(std::slice::from_ref(&trashed.id)).unwrap();
        lib.lock_now();
        let trash = lib
            .list_items(&ListFilters {
                view: "trash".into(),
                ..ListFilters::default()
            })
            .unwrap();
        let redacted = trash
            .entries
            .iter()
            .find(|entry| entry.item.id == trashed.id)
            .unwrap();
        assert!(redacted.item.is_private && redacted.item.effective_locked);
        assert!(redacted.item.title.is_empty());
        assert!(redacted.item.content_preview.is_empty());
    }

    #[test]
    fn unlock_duration_is_applied_and_validated() {
        let lib = library();
        let session = lib.unlock_for_session(10).unwrap();
        assert!(session.unlocked);
        assert!(session.remaining_ms > 9 * 60 * 1_000);
        assert!(session.remaining_ms <= 10 * 60 * 1_000);
        assert!(lib.unlock_for_session(0).is_err());
        assert!(lib.unlock_for_session(121).is_err());
    }

    #[test]
    fn collection_lock_replaces_direct_item_lock() {
        let (temp, lib) = disk_library();
        let collection = lib.create_collection("Private", None).unwrap();
        let item = lib
            .create_note(
                "Visible file",
                "hidden body",
                std::slice::from_ref(&collection.id),
            )
            .unwrap();
        let tag = lib.create_tag("Visible tag").unwrap();
        lib.set_item_tags(&item.id, std::slice::from_ref(&tag.id))
            .unwrap();
        lib.set_favorite(&item.id, true).unwrap();
        lib.touch_item(&item.id).unwrap();

        lib.set_items_locked(std::slice::from_ref(&item.id), true)
            .unwrap();
        let direct = lib
            .list_items(&ListFilters::default())
            .unwrap()
            .entries
            .into_iter()
            .find(|entry| entry.item.id == item.id)
            .unwrap();
        assert!(direct.item.is_locked && direct.item.effective_locked);
        assert!(!direct.item.collection_locked);
        assert_eq!(direct.item.title, "Visible file");
        assert_eq!(direct.item.size, "hidden body".len() as i64);
        assert_eq!(direct.item.mime, "text/markdown");
        assert!(!direct.item.stored_path.is_empty());
        assert!(direct.item.is_favorite);
        assert_eq!(direct.item.tags.len(), 1);
        assert!(direct.item.content_preview.is_empty());
        assert!(direct.snippet.is_none());
        for filters in [
            ListFilters {
                view: "favorites".into(),
                ..ListFilters::default()
            },
            ListFilters {
                view: "recent".into(),
                ..ListFilters::default()
            },
            ListFilters {
                tag_id: Some(tag.id.clone()),
                ..ListFilters::default()
            },
        ] {
            assert_eq!(lib.list_items(&filters).unwrap().entries.len(), 1);
        }
        assert!(lib
            .list_items(&ListFilters {
                query: Some("hidden body".into()),
                ..ListFilters::default()
            })
            .unwrap()
            .entries
            .is_empty());

        assert_eq!(lib.get_item(&item.id).unwrap_err(), LOCKED_ERROR);
        assert_eq!(lib.generate_thumbnail(&item.id).unwrap_err(), LOCKED_ERROR);
        assert_eq!(lib.open_with_default(&item.id).unwrap_err(), LOCKED_ERROR);
        assert_eq!(lib.quicklook(&item.id).unwrap_err(), LOCKED_ERROR);
        assert_eq!(
            lib.export_item(&item.id, &temp.0.join("export.md"))
                .unwrap_err(),
            LOCKED_ERROR
        );
        assert_eq!(
            lib.delete_items(std::slice::from_ref(&item.id))
                .unwrap_err(),
            LOCKED_ERROR
        );

        lib.unlock_for_session(10).unwrap();
        assert_eq!(lib.get_item(&item.id).unwrap().item.content, "hidden body");
        lib.set_collection_locked(&collection.id, true).unwrap();
        lib.lock_now();
        let inherited = lib
            .list_items(&ListFilters::default())
            .unwrap()
            .entries
            .remove(0);
        assert!(!inherited.item.is_locked && inherited.item.collection_locked);
        assert_eq!(inherited.item.size, 0);
        assert!(inherited.item.mime.is_empty());
        assert!(inherited.item.tags.is_empty());

        lib.unlock_for_session(10).unwrap();
        lib.set_collection_locked(&collection.id, false).unwrap();
        lib.lock_now();
        let unlocked = lib
            .list_items(&ListFilters::default())
            .unwrap()
            .entries
            .remove(0);
        assert!(!unlocked.item.is_locked && !unlocked.item.collection_locked);
        assert!(!unlocked.item.effective_locked);
        assert_eq!(unlocked.item.size, "hidden body".len() as i64);
    }

    #[test]
    fn collection_lock_takes_over_on_membership_and_move() {
        let lib = library();
        let locked = lib.create_collection("Locked", None).unwrap();
        lib.set_collection_locked(&locked.id, true).unwrap();

        let added = lib.create_link("https://added.test", "Added", &[]).unwrap();
        lib.set_items_locked(std::slice::from_ref(&added.id), true)
            .unwrap();
        lib.unlock_for_session(10).unwrap();
        lib.add_items_to_collection(std::slice::from_ref(&added.id), &locked.id)
            .unwrap();
        let added = lib.get_item(&added.id).unwrap().item;
        assert!(!added.is_locked && added.collection_locked);

        let child = lib.create_collection("Child", None).unwrap();
        let moved = lib
            .create_link(
                "https://moved.test",
                "Moved",
                std::slice::from_ref(&child.id),
            )
            .unwrap();
        lib.set_items_locked(std::slice::from_ref(&moved.id), true)
            .unwrap();
        lib.unlock_for_session(10).unwrap();
        lib.move_collection(&child.id, Some(&locked.id), None)
            .unwrap();
        let moved = lib.get_item(&moved.id).unwrap().item;
        assert!(!moved.is_locked && moved.collection_locked);

        lib.set_items_locked(std::slice::from_ref(&moved.id), true)
            .unwrap();
        assert!(lib.lock_session().unlocked);
        assert!(!lib.get_item(&moved.id).unwrap().item.is_locked);
    }

    #[test]
    fn note_and_tag_updates_validate_their_inputs() {
        let lib = library();
        let tag = lib.create_tag("tag").unwrap();
        assert!(lib.set_tag_color(&tag.id, Some("cyan")).is_err());
        assert_eq!(
            lib.set_tag_color(&tag.id, Some("green"))
                .unwrap()
                .color
                .as_deref(),
            Some("green")
        );
        assert!(lib.create_tag("  ").is_err());

        let file_id = lib
            .insert_item(
                "file",
                "file",
                "",
                "",
                "files/x",
                1,
                "text/plain",
                "{}",
                &[],
            )
            .unwrap();
        assert!(lib.rename_file(&file_id, "changed", None).is_err());
    }

    #[test]
    fn migrates_v001_data_without_losing_relations() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        db::MIGRATIONS.to_version(&mut conn, 1).unwrap();
        conn.execute_batch(
            "INSERT INTO items (id, type, title, content, stored_path, created_at, updated_at) VALUES
               ('note', 'note', '旧笔记', 'legacy searchable text', '', '2025-01-01', '2025-01-01'),
               ('file', 'file', '旧文件.pdf', '', 'files/file/old.pdf', '2025-01-02', '2025-01-02');
             INSERT INTO collections (id, name, position, created_at) VALUES ('collection', '旧集合', 0, '2025-01-01');
             INSERT INTO tags (id, name, created_at) VALUES ('tag', '旧标签', '2025-01-01');
             INSERT INTO item_collections VALUES ('note', 'collection');
             INSERT INTO item_tags VALUES ('note', 'tag');
             INSERT INTO attachments VALUES ('note', 'file', 0);",
        )
        .unwrap();

        db::MIGRATIONS.to_latest(&mut conn).unwrap();
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM items", [], |row| row.get::<_, i64>(0))
                .unwrap(),
            2
        );
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM item_collections", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            1
        );
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM item_tags", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            1
        );
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM attachments", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            1
        );
        assert_eq!(
            conn.query_row(
                "SELECT COUNT(*) FROM items_fts WHERE items_fts MATCH '\"legacy searchable\"'",
                [],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
            1
        );
    }

    #[test]
    fn migration_removes_direct_locks_owned_by_collections() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        db::MIGRATIONS.to_version(&mut conn, 4).unwrap();
        conn.execute_batch(
            "INSERT INTO collections (id, name, position, created_at, is_locked) VALUES
               ('locked', 'Locked', 0, '2025-01-01', 1),
               ('child', 'Child', 0, '2025-01-01', 0);
             UPDATE collections SET parent_id = 'locked' WHERE id = 'child';
             INSERT INTO items (id, type, title, created_at, updated_at, is_locked) VALUES
               ('owned', 'link', 'Owned', '2025-01-01', '2025-01-01', 1),
               ('direct', 'link', 'Direct', '2025-01-01', '2025-01-01', 1);
             INSERT INTO item_collections VALUES ('owned', 'child');",
        )
        .unwrap();

        db::MIGRATIONS.to_latest(&mut conn).unwrap();
        assert_eq!(
            conn.query_row(
                "SELECT is_locked FROM items WHERE id = 'owned'",
                [],
                |row| { row.get::<_, i64>(0) }
            )
            .unwrap(),
            0
        );
        assert_eq!(
            conn.query_row(
                "SELECT is_locked FROM items WHERE id = 'direct'",
                [],
                |row| { row.get::<_, i64>(0) }
            )
            .unwrap(),
            1
        );
    }

    #[test]
    fn search_supports_fts_short_terms_filters_and_sync() {
        let (_temp, lib) = disk_library();
        let work = lib.create_collection("工作", None).unwrap();
        let archive = lib.create_collection("归档", None).unwrap();
        let important = lib.create_tag("重要").unwrap();
        let project = lib.create_tag("项目").unwrap();
        let note = lib
            .create_note(
                "中文资料库",
                "alpha phrase, literal a\\ token, and 100% complete",
                &[work.id.clone(), archive.id.clone()],
            )
            .unwrap();
        lib.set_item_tags(&note.id, &[important.id.clone(), project.id.clone()])
            .unwrap();
        let file_id = lib
            .insert_item(
                "file",
                "报告.pdf",
                "",
                "",
                "files/report.pdf",
                10,
                "application/pdf",
                "{}",
                &[],
            )
            .unwrap();
        lib.create_link("https://example.com", "alpha link", &[])
            .unwrap();
        {
            let conn = lib.db.lock().unwrap();
            conn.execute("UPDATE items SET created_at = '2025-03-04', extracted_text = 'PDF native searchable body' WHERE id = ?1", params![file_id]).unwrap();
            conn.execute(
                "UPDATE items SET created_at = '2025-02-03' WHERE id = ?1",
                params![note.id],
            )
            .unwrap();
        }

        let search = |query: &str| {
            lib.list_items(&ListFilters {
                query: Some(query.into()),
                ..ListFilters::default()
            })
            .unwrap()
        };
        let chinese = search("中文资料");
        assert_eq!(chinese.entries[0].item.id, note.id);
        assert!(chinese.entries[0].snippet.is_some());
        assert_eq!(
            search("中文").entries.len(),
            1,
            "two-character queries use LIKE"
        );
        assert_eq!(search("\"alpha phrase\"").entries.len(), 1);
        assert_eq!(search("native").entries[0].item.id, file_id);
        assert_eq!(search("100%").entries.len(), 1);
        assert_eq!(search("a\\").entries.len(), 1);
        assert_eq!(
            search("type:note type:file").entries.len(),
            2,
            "types are ORed"
        );
        assert_eq!(search("alpha type:note type:file tag:重要 tag:项目 collection:工作 collection:归档 date:>2025-01-01").entries.len(), 1);
        assert_eq!(search("date:2025-03-04 type:file").entries.len(), 1);
        assert_eq!(search("date:<2025-03-01 type:note").entries.len(), 1);

        lib.rename_file(&note.id, "已重命名", None).unwrap();
        let document = lib.read_text_file(&note.id).unwrap();
        lib.write_text_file(
            &note.id,
            "removed",
            &document.version,
            &document.encoding,
            &document.line_ending,
        )
        .unwrap();
        assert!(
            search("中文资料").entries.is_empty(),
            "FTS update trigger removes old text"
        );
        {
            let conn = lib.db.lock().unwrap();
            conn.execute("DELETE FROM items WHERE id = ?1", params![file_id])
                .unwrap();
            assert_eq!(
                conn.query_row(
                    "SELECT COUNT(*) FROM items_fts WHERE items_fts MATCH '\"native\"'",
                    [],
                    |row| row.get::<_, i64>(0)
                )
                .unwrap(),
                0
            );
        }
    }

    #[test]
    fn saved_views_are_stable_and_cascade_with_context() {
        let lib = library();
        let collection = lib.create_collection("工作", None).unwrap();
        let tag = lib.create_tag("重要").unwrap();
        let by_collection = lib
            .create_saved_view(
                "集合搜索",
                "资料",
                "updated",
                "collection",
                Some(&collection.id),
                None,
            )
            .unwrap();
        let by_tag = lib
            .create_saved_view("标签搜索", "资料", "title", "tag", None, Some(&tag.id))
            .unwrap();
        lib.rename_saved_view(&by_collection.id, "重命名").unwrap();
        assert_eq!(
            lib.list_saved_views()
                .unwrap()
                .iter()
                .find(|view| view.id == by_collection.id)
                .unwrap()
                .name,
            "重命名"
        );
        lib.delete_collection_tree(&collection.id).unwrap();
        lib.delete_tag(&tag.id).unwrap();
        assert!(lib.list_saved_views().unwrap().is_empty());
        assert!(lib.delete_saved_view(&by_tag.id).is_err());
    }

    #[test]
    fn pdf_indexing_handles_text_scans_corruption_and_retry() {
        let (_temp, lib) = disk_library();
        let text_path = lib.root.join("files/text.pdf");
        let scan_path = lib.root.join("files/scan.pdf");
        let broken_path = lib.root.join("files/broken.pdf");
        write_pdf(&text_path, Some("PDF native text"));
        write_pdf(&scan_path, None);
        fs::write(&broken_path, b"not a pdf").unwrap();
        let text_id = lib
            .insert_item(
                "file",
                "text.pdf",
                "",
                "",
                "files/text.pdf",
                1,
                "application/pdf",
                "{}",
                &[],
            )
            .unwrap();
        lib.insert_item(
            "file",
            "scan.pdf",
            "",
            "",
            "files/scan.pdf",
            1,
            "application/pdf",
            "{}",
            &[],
        )
        .unwrap();
        lib.insert_item(
            "file",
            "broken.pdf",
            "",
            "",
            "files/broken.pdf",
            1,
            "application/pdf",
            "{}",
            &[],
        )
        .unwrap();

        let indexed = lib.index_pending_pdfs(false).unwrap();
        assert_eq!((indexed.indexed, indexed.failed), (2, 1));
        assert_eq!(lib.search_index_status().unwrap().failed, 1);
        let result = lib
            .list_items(&ListFilters {
                query: Some("native".into()),
                ..ListFilters::default()
            })
            .unwrap();
        assert_eq!(result.entries[0].item.id, text_id);
        assert_eq!(lib.index_pending_pdfs(true).unwrap().failed, 1);
    }

    #[test]
    fn media_files_cannot_cross_preview_or_thumbnail_ipc() {
        let (_temp, lib) = disk_library();
        let path = lib.root.join("files/media/recording.m4a");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, b"media").unwrap();
        let id = lib
            .insert_item(
                "file",
                "recording.m4a",
                "",
                "",
                "files/media/recording.m4a",
                5,
                "application/octet-stream",
                "{}",
                &[],
            )
            .unwrap();
        assert!(lib.quicklook(&id).is_err());
        assert_eq!(lib.generate_thumbnail(&id).unwrap(), None);
        assert_eq!(lib.file_abs_path(&id).unwrap(), None);
    }

    #[test]
    fn purge_keeps_files_and_rows_when_any_path_is_invalid() {
        let (_temp, lib) = disk_library();
        let stored = lib.root.join("files/valid/data.txt");
        fs::create_dir_all(stored.parent().unwrap()).unwrap();
        fs::write(&stored, b"keep me").unwrap();
        let valid = lib
            .insert_item(
                "file",
                "data.txt",
                "",
                "",
                "files/valid/data.txt",
                7,
                "text/plain",
                "{}",
                &[],
            )
            .unwrap();
        let invalid = lib
            .insert_item(
                "file",
                "outside.txt",
                "",
                "",
                "../outside.txt",
                7,
                "text/plain",
                "{}",
                &[],
            )
            .unwrap();
        lib.delete_items(&[valid.clone(), invalid.clone()]).unwrap();

        assert!(lib.purge_items(&[valid.clone(), invalid.clone()]).is_err());
        assert_eq!(fs::read(&stored).unwrap(), b"keep me");
        assert!(lib.get_item(&valid).unwrap().item.deleted_at.is_some());
        assert!(lib.get_item(&invalid).unwrap().item.deleted_at.is_some());

        {
            let conn = lib.db.lock().unwrap();
            conn.execute(
                "UPDATE items SET stored_path = 'files/missing/outside.txt' WHERE id = ?1",
                params![invalid],
            )
            .unwrap();
        }
        lib.purge_items(&[valid.clone(), invalid.clone()]).unwrap();
        assert!(!stored.exists());
        assert!(lib.get_item(&valid).is_err());
        assert!(lib.get_item(&invalid).is_err());
        assert!(fs::read_dir(&lib.root).unwrap().all(|entry| !entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with(".purge-")));
    }

    #[test]
    fn backup_export_switch_and_move_keep_verified_complete_copies() {
        let (temp, lib) = disk_library();
        let output = temp.0.join("output");
        let destination = temp.0.join("moved");
        fs::create_dir(&output).unwrap();
        fs::create_dir(&destination).unwrap();
        let collection = lib.create_collection("工作", None).unwrap();
        let note = lib
            .create_note("说明", "正文", &[collection.id.clone()])
            .unwrap();
        let stored = lib.root.join("files/file/data.txt");
        fs::create_dir_all(stored.parent().unwrap()).unwrap();
        fs::write(&stored, b"verified file").unwrap();
        let file_id = lib
            .insert_item(
                "file",
                "data.txt",
                "",
                "",
                "files/file/data.txt",
                13,
                "text/plain",
                "{}",
                &[collection.id.clone()],
            )
            .unwrap();
        lib.add_attachments(&note.id, &[file_id.clone()]).unwrap();
        lib.create_saved_view(
            "工作搜索",
            "正文",
            "updated",
            "collection",
            Some(&collection.id),
            None,
        )
        .unwrap();
        let trashed = lib.create_note("回收站笔记", "deleted", &[]).unwrap();
        lib.delete_items(std::slice::from_ref(&trashed.id)).unwrap();
        fs::write(lib.cache.join("ignored-thumbnail.png"), b"cache").unwrap();
        assert!(lib.backup_library(&lib.files_dir()).is_err());

        let backup = PathBuf::from(lib.backup_library(&output).unwrap());
        assert!(backup.join("nook.db").is_file());
        assert_eq!(
            fs::read(backup.join("files/file/data.txt")).unwrap(),
            b"verified file"
        );
        assert!(!backup.join("ignored-thumbnail.png").exists());
        let backup_db = Connection::open(backup.join("nook.db")).unwrap();
        assert_eq!(
            backup_db
                .query_row("PRAGMA integrity_check", [], |row| row.get::<_, String>(0))
                .unwrap(),
            "ok"
        );
        drop(backup_db);

        let export = PathBuf::from(lib.export_library(&output).unwrap());
        let manifest: serde_json::Value =
            serde_json::from_slice(&fs::read(export.join("manifest.json")).unwrap()).unwrap();
        assert_eq!(manifest["items"].as_array().unwrap().len(), 3);
        assert_eq!(manifest["savedViews"].as_array().unwrap().len(), 1);
        assert!(export
            .join(format!("Active/Files/{}/说明.md", note.id))
            .is_file());
        assert!(export
            .join(format!("Trash/Files/{}/回收站笔记.md", trashed.id))
            .is_file());

        assert_eq!(
            PathBuf::from(lib.use_existing_library(&backup).unwrap()),
            backup.canonicalize().unwrap()
        );
        fs::write(destination.join("occupied"), b"occupied").unwrap();
        assert!(lib.move_library(&destination).is_err());
        fs::remove_file(destination.join("occupied")).unwrap();
        lib.set_collection_locked(&collection.id, true).unwrap();
        assert_eq!(lib.move_library(&destination).unwrap_err(), LOCKED_ERROR);
        lib.unlock_for_session(10).unwrap();
        let moved = PathBuf::from(lib.move_library(&destination).unwrap());
        assert_eq!(
            fs::read(moved.join("files/file/data.txt")).unwrap(),
            b"verified file"
        );
        assert!(stored.is_file(), "the source library is retained");
        assert_eq!(
            fs::read_to_string(lib.app_data.join(LOCATION_FILE)).unwrap(),
            moved.to_string_lossy()
        );
    }

    #[test]
    fn item_export_writes_notes_and_copies_files_safely() {
        let (temp, lib) = disk_library();
        let output = temp.0.join("output");
        fs::create_dir(&output).unwrap();

        let note = lib.create_note("说明", "# 正文\n", &[]).unwrap();
        let note_path = output.join("说明.md");
        assert_eq!(
            lib.export_item(&note.id, &note_path).unwrap(),
            note_path.to_string_lossy()
        );
        assert_eq!(fs::read(&note_path).unwrap(), "# 正文\n".as_bytes());

        let source = temp.0.join("source.bin");
        fs::write(&source, b"verified file").unwrap();
        let file = lib
            .import_files(&[source.to_string_lossy().to_string()], None)
            .unwrap()
            .imported
            .remove(0)
            .item;
        let file_path = output.join("source.bin");
        lib.export_item(&file.id, &file_path).unwrap();
        assert_eq!(fs::read(file_path).unwrap(), b"verified file");

        let link = lib.create_link("https://example.com", "示例", &[]).unwrap();
        assert!(lib
            .export_item(&link.id, &output.join("example.url"))
            .is_err());
        assert!(lib
            .export_item(&note.id, &lib.root.join("inside.md"))
            .is_err());

        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;
            let target = output.join("target.md");
            let alias = output.join("alias.md");
            fs::write(&target, b"keep").unwrap();
            symlink(&target, &alias).unwrap();
            assert!(lib.export_item(&note.id, &alias).is_err());
            assert_eq!(fs::read(target).unwrap(), b"keep");
        }
    }

    #[cfg(unix)]
    #[test]
    fn transfer_rejects_symlinks_and_cleans_partial_output() {
        use std::os::unix::fs::symlink;

        let (temp, lib) = disk_library();
        let output = temp.0.join("output");
        fs::create_dir(&output).unwrap();
        let outside = temp.0.join("outside.txt");
        fs::write(&outside, b"outside").unwrap();
        symlink(&outside, lib.root.join("files/link.txt")).unwrap();
        lib.insert_item(
            "file",
            "link.txt",
            "",
            "",
            "files/link.txt",
            7,
            "text/plain",
            "{}",
            &[],
        )
        .unwrap();
        assert!(lib.backup_library(&output).is_err());
        assert!(fs::read_dir(&output).unwrap().next().is_none());
        assert!(lib.safe_stored_path("../outside.txt").is_err());
        assert!(lib.safe_stored_path("nook.db").is_err());
        assert!(lib.safe_stored_path("files/link.txt").is_err());
        fs::remove_file(lib.root.join("files/link.txt")).unwrap();
        assert!(
            lib.export_library(&output).is_err(),
            "missing files fail the whole export"
        );
        assert!(fs::read_dir(&output).unwrap().next().is_none());
    }

    #[cfg(unix)]
    #[test]
    fn existing_library_rejects_symlinked_database_and_files_root() {
        use std::os::unix::fs::symlink;

        let (temp, lib) = disk_library();
        let output = temp.0.join("output");
        fs::create_dir(&output).unwrap();
        let candidate = PathBuf::from(lib.backup_library(&output).unwrap());

        let database = candidate.join("nook.db");
        let outside_database = temp.0.join("outside.db");
        fs::rename(&database, &outside_database).unwrap();
        symlink(&outside_database, &database).unwrap();
        assert!(lib.use_existing_library(&candidate).is_err());
        fs::remove_file(&database).unwrap();
        fs::rename(&outside_database, &database).unwrap();

        let files = candidate.join(FILES_DIR);
        let outside_files = temp.0.join("outside-files");
        fs::rename(&files, &outside_files).unwrap();
        symlink(&outside_files, &files).unwrap();
        assert!(lib.use_existing_library(&candidate).is_err());
    }

    #[test]
    fn export_rejects_malformed_item_metadata_without_partial_output() {
        let (temp, lib) = disk_library();
        let output = temp.0.join("output");
        fs::create_dir(&output).unwrap();
        lib.insert_item("note", "bad meta", "body", "", "", 0, "", "{bad", &[])
            .unwrap();

        assert!(lib.export_library(&output).is_err());
        assert!(fs::read_dir(&output).unwrap().next().is_none());
    }

    #[test]
    fn text_file_edits_preserve_format_detect_conflicts_and_ignore_source() {
        let (temp, lib) = disk_library();
        let source = temp.0.join("source.txt");
        let original = [b"\xef\xbb\xbf".as_slice(), b"one\r\ntwo\r\n"].concat();
        fs::write(&source, &original).unwrap();
        let imported = lib
            .import_files(&[source.to_string_lossy().to_string()], None)
            .unwrap()
            .imported
            .remove(0)
            .item;

        let document = lib.read_text_file(&imported.id).unwrap();
        assert_eq!(document.content, "one\ntwo\n");
        assert_eq!(document.encoding, "utf8Bom");
        assert_eq!(document.line_ending, "crlf");

        let saved = lib
            .write_text_file(
                &imported.id,
                "changed\ntext\n",
                &document.version,
                &document.encoding,
                &document.line_ending,
            )
            .unwrap();
        let (saved_item, saved_version) = match saved {
            TextFileWriteResult::Saved { item, version } => (item, version),
            TextFileWriteResult::Conflict { .. } => panic!("unexpected conflict"),
        };
        let stored = lib.safe_stored_path(&saved_item.stored_path).unwrap();
        assert_eq!(
            fs::read(&stored).unwrap(),
            [b"\xef\xbb\xbf".as_slice(), b"changed\r\ntext\r\n"].concat()
        );
        assert_eq!(fs::read(&source).unwrap(), original);
        assert_eq!(saved_item.size, 18);
        let stored_sha: String = lib
            .db
            .lock()
            .unwrap()
            .query_row(
                "SELECT json_extract(meta, '$.sha256') FROM items WHERE id = ?1",
                params![imported.id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(stored_sha, saved_version);

        let conflict = lib
            .write_text_file(
                &saved_item.id,
                "must not win",
                &document.version,
                &document.encoding,
                &document.line_ending,
            )
            .unwrap();
        assert!(matches!(conflict, TextFileWriteResult::Conflict { .. }));
        assert_eq!(
            lib.read_text_file(&saved_item.id).unwrap().content,
            "changed\ntext\n"
        );

        fs::remove_file(source).unwrap();
        assert_eq!(
            lib.read_text_file(&saved_item.id).unwrap().content,
            "changed\ntext\n"
        );
        lib.delete_items(std::slice::from_ref(&saved_item.id))
            .unwrap();
        assert!(lib
            .write_text_file(
                &saved_item.id,
                "trash",
                &saved_version,
                &document.encoding,
                &document.line_ending,
            )
            .is_err());
        assert_eq!(
            lib.read_text_file(&saved_item.id).unwrap().content,
            "changed\ntext\n"
        );
    }

    #[test]
    fn text_file_reader_rejects_invalid_encoding_and_large_files() {
        let (_temp, lib) = disk_library();
        let invalid = lib.root.join("files/invalid/data.json");
        fs::create_dir_all(invalid.parent().unwrap()).unwrap();
        fs::write(&invalid, [0xff]).unwrap();
        let invalid_id = lib
            .insert_item(
                "file",
                "data.json",
                "",
                "",
                "files/invalid/data.json",
                1,
                "application/json",
                "{}",
                &[],
            )
            .unwrap();
        assert!(lib.read_text_file(&invalid_id).is_err());

        let large = lib.root.join("files/large/output.log");
        fs::create_dir_all(large.parent().unwrap()).unwrap();
        fs::write(&large, vec![b'a'; native::MAX_TEXT_FILE_BYTES as usize + 1]).unwrap();
        let large_id = lib
            .insert_item(
                "file",
                "output.log",
                "",
                "",
                "files/large/output.log",
                native::MAX_TEXT_FILE_BYTES as i64 + 1,
                "application/octet-stream",
                "{}",
                &[],
            )
            .unwrap();
        assert!(lib.read_text_file(&large_id).is_err());
    }

    #[test]
    fn text_file_save_restores_original_when_metadata_update_fails() {
        let (_temp, lib) = disk_library();
        let stored = lib.root.join("files/rollback/data.txt");
        fs::create_dir_all(stored.parent().unwrap()).unwrap();
        fs::write(&stored, b"original").unwrap();
        let id = lib
            .insert_item(
                "file",
                "data.txt",
                "",
                "",
                "files/rollback/data.txt",
                8,
                "text/plain",
                "{bad",
                &[],
            )
            .unwrap();
        let document = lib.read_text_file(&id).unwrap();

        assert!(lib
            .write_text_file(
                &id,
                "replacement",
                &document.version,
                &document.encoding,
                &document.line_ending,
            )
            .is_err());
        assert_eq!(fs::read(&stored).unwrap(), b"original");
        assert_eq!(fs::read_dir(stored.parent().unwrap()).unwrap().count(), 1);
    }

    #[test]
    fn create_note_writes_markdown_file_and_indexes_content() {
        let (_temp, lib) = disk_library();
        let item = lib.create_note("无标题", "hello body", &[]).unwrap();
        assert_eq!(item.item_type, "file");
        assert_eq!(item.mime, "text/markdown");
        assert_eq!(item.title, "无标题");
        assert!(item.stored_path.ends_with("/无标题.md"));
        assert_eq!(
            fs::read_to_string(lib.root.join(&item.stored_path)).unwrap(),
            "hello body"
        );
        assert_eq!(
            lib.list_items(&ListFilters {
                query: Some("hello".into()),
                ..ListFilters::default()
            })
            .unwrap()
            .entries
            .len(),
            1
        );
        assert_eq!(
            lib.list_items(&ListFilters {
                query: Some("type:note".into()),
                ..ListFilters::default()
            })
            .unwrap()
            .entries[0]
                .item
                .id,
            item.id
        );
    }

    #[test]
    fn migrate_notes_to_files_is_idempotent_and_searchable() {
        let (_temp, lib) = disk_library();
        let id = lib
            .insert_item(
                "note",
                "旧笔记",
                "searchable body",
                "",
                "",
                0,
                "",
                "{}",
                &[],
            )
            .unwrap();
        lib.migrate_notes_to_files().unwrap();
        lib.migrate_notes_to_files().unwrap();
        let item = lib.get_item(&id).unwrap().item;
        assert_eq!(item.item_type, "file");
        assert_eq!(item.mime, "text/markdown");
        assert_eq!(
            fs::read_to_string(lib.root.join(&item.stored_path)).unwrap(),
            "searchable body"
        );
        assert_eq!(
            lib.list_items(&ListFilters {
                query: Some("searchable".into()),
                ..ListFilters::default()
            })
            .unwrap()
            .entries
            .len(),
            1
        );
    }

    #[test]
    fn rename_file_changes_stem_and_switchable_format_keeps_bytes() {
        let (_temp, lib) = disk_library();
        let item = lib.create_note("草稿", "same-bytes", &[]).unwrap();
        let original = fs::read(lib.root.join(&item.stored_path)).unwrap();
        let renamed = lib.rename_file(&item.id, "日报", Some("csv")).unwrap();
        assert_eq!(renamed.title, "日报");
        assert_eq!(renamed.mime, "text/csv");
        assert!(renamed.stored_path.ends_with("/日报.csv"));
        assert!(!lib.root.join(&item.stored_path).exists());
        assert_eq!(
            fs::read(lib.root.join(&renamed.stored_path)).unwrap(),
            original
        );

        let stored = lib.root.join("files/doc/report.pdf");
        fs::create_dir_all(stored.parent().unwrap()).unwrap();
        fs::write(&stored, b"%PDF").unwrap();
        let pdf = lib
            .insert_item(
                "file",
                "report.pdf",
                "",
                "",
                "files/doc/report.pdf",
                4,
                "application/pdf",
                "{}",
                &[],
            )
            .unwrap();
        assert!(lib.rename_file(&pdf, "年度", Some("md")).is_err());
        let pdf_renamed = lib.rename_file(&pdf, "年度报告", None).unwrap();
        assert_eq!(pdf_renamed.title, "年度报告");
        assert!(pdf_renamed.stored_path.ends_with("/年度报告.pdf"));
    }

    #[test]
    #[ignore = "release-mode acceptance benchmark"]
    fn benchmark_100k_fts_hot_query_p95_under_100ms() {
        let lib = library();
        {
            let mut conn = lib.db.lock().unwrap();
            let tx = conn.transaction().unwrap();
            {
                let mut insert = tx.prepare(
                    "INSERT INTO items (id, type, title, content, created_at, updated_at) VALUES (?1, 'note', ?2, ?3, '2025-01-01', '2025-01-01')",
                ).unwrap();
                for index in 0..100_000 {
                    let content = if index % 1_000 == 0 {
                        "benchmark needle content"
                    } else {
                        "ordinary searchable content"
                    };
                    insert
                        .execute(params![
                            format!("item-{index}"),
                            format!("Note {index}"),
                            content
                        ])
                        .unwrap();
                }
            }
            tx.commit().unwrap();
        }
        let filters = ListFilters {
            query: Some("needle".into()),
            ..ListFilters::default()
        };
        lib.list_items(&filters).unwrap();
        let mut timings = Vec::new();
        for _ in 0..40 {
            let started = std::time::Instant::now();
            assert_eq!(lib.list_items(&filters).unwrap().entries.len(), 100);
            timings.push(started.elapsed());
        }
        timings.sort();
        let p95 = timings[37];
        eprintln!("100k FTS hot-query p95: {p95:?}");
        assert!(p95 < std::time::Duration::from_millis(100));
    }
}

fn uuid() -> String {
    Uuid::new_v4().to_string()
}

fn map_err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

fn row_to_item(row: &Row) -> rusqlite::Result<Item> {
    let is_locked = row.get::<_, i64>(13)? != 0;
    let collection_locked = row.get::<_, i64>(14)? != 0;
    let is_private = row.get::<_, i64>(15)? != 0;
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
        is_locked,
        is_private,
        collection_locked,
        effective_locked: is_locked || collection_locked || is_private,
        tags: Vec::new(),
        collections: Vec::new(),
    })
}

const COLLECTION_ITEM_LOCK: &str = "EXISTS (WITH RECURSIVE ancestors(id, parent_id, is_locked) AS (SELECT c.id, c.parent_id, c.is_locked FROM collections c JOIN item_collections ic ON ic.collection_id = c.id WHERE ic.item_id = i.id UNION SELECT c.id, c.parent_id, c.is_locked FROM collections c JOIN ancestors a ON a.parent_id = c.id) SELECT 1 FROM ancestors WHERE is_locked = 1)";
const EFFECTIVE_ITEM_LOCK: &str = "(i.is_locked = 1 OR i.is_private = 1 OR EXISTS (WITH RECURSIVE ancestors(id, parent_id, is_locked) AS (SELECT c.id, c.parent_id, c.is_locked FROM collections c JOIN item_collections ic ON ic.collection_id = c.id WHERE ic.item_id = i.id UNION SELECT c.id, c.parent_id, c.is_locked FROM collections c JOIN ancestors a ON a.parent_id = c.id) SELECT 1 FROM ancestors WHERE is_locked = 1))";
const ITEM_COLS: &str = "i.id, i.type, i.title, i.content, i.url, i.stored_path, i.size, i.mime, i.created_at, i.updated_at, i.last_opened_at, i.is_favorite, i.deleted_at, i.is_locked, EXISTS (WITH RECURSIVE ancestors(id, parent_id, is_locked) AS (SELECT c.id, c.parent_id, c.is_locked FROM collections c JOIN item_collections ic ON ic.collection_id = c.id WHERE ic.item_id = i.id UNION SELECT c.id, c.parent_id, c.is_locked FROM collections c JOIN ancestors a ON a.parent_id = c.id) SELECT 1 FROM ancestors WHERE is_locked = 1), i.is_private";
const LIST_ITEM_COLS: &str = "i.id, i.type, i.title, substr(i.content, 1, 240), i.url, i.stored_path, i.size, i.mime, i.created_at, i.updated_at, i.last_opened_at, i.is_favorite, i.deleted_at, i.is_locked, EXISTS (WITH RECURSIVE ancestors(id, parent_id, is_locked) AS (SELECT c.id, c.parent_id, c.is_locked FROM collections c JOIN item_collections ic ON ic.collection_id = c.id WHERE ic.item_id = i.id UNION SELECT c.id, c.parent_id, c.is_locked FROM collections c JOIN ancestors a ON a.parent_id = c.id) SELECT 1 FROM ancestors WHERE is_locked = 1), i.is_private";

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

    pub fn lock_session(&self) -> LockSession {
        let mut deadline = self.unlocked_until.lock().unwrap();
        let remaining = deadline
            .and_then(|until| until.checked_duration_since(Instant::now()))
            .unwrap_or_default();
        if remaining.is_zero() {
            *deadline = None;
        }
        LockSession {
            unlocked: !remaining.is_zero(),
            remaining_ms: remaining.as_millis().min(u64::MAX as u128) as u64,
        }
    }

    pub fn unlock_for_session(&self, minutes: u64) -> Result<LockSession, String> {
        if !(1..=120).contains(&minutes) {
            return Err("解锁时长必须是 1 到 120 分钟".into());
        }
        *self.unlocked_until.lock().unwrap() =
            Some(Instant::now() + Duration::from_secs(minutes * 60));
        Ok(self.lock_session())
    }

    pub fn lock_now(&self) {
        *self.unlocked_until.lock().unwrap() = None;
    }

    fn is_unlocked(&self) -> bool {
        self.lock_session().unlocked
    }

    fn item_effective_locked(conn: &Connection, id: &str) -> Result<bool, String> {
        conn.query_row(
            &format!("SELECT {EFFECTIVE_ITEM_LOCK} FROM items i WHERE i.id = ?1"),
            params![id],
            |row| row.get(0),
        )
        .optional()
        .map_err(map_err)?
        .ok_or_else(|| format!("item not found: {id}"))
    }

    fn collection_effective_locked(conn: &Connection, id: &str) -> Result<bool, String> {
        conn.query_row(
            "WITH RECURSIVE ancestors(id, parent_id, is_locked) AS (\
               SELECT id, parent_id, is_locked FROM collections WHERE id = ?1 \
               UNION ALL \
               SELECT c.id, c.parent_id, c.is_locked FROM collections c JOIN ancestors a ON a.parent_id = c.id\
             ) SELECT EXISTS(SELECT 1 FROM ancestors WHERE is_locked = 1)",
            params![id],
            |row| row.get(0),
        )
        .map_err(map_err)
    }

    fn clear_direct_locks_in_collection_tree(conn: &Connection, id: &str) -> Result<(), String> {
        conn.execute(
            "WITH RECURSIVE descendants(id) AS (\
               SELECT id FROM collections WHERE id = ?1 \
               UNION ALL SELECT c.id FROM collections c JOIN descendants d ON c.parent_id = d.id\
             ) UPDATE items SET is_locked = 0 WHERE is_locked = 1 AND id IN (\
               SELECT item_id FROM item_collections WHERE collection_id IN (SELECT id FROM descendants)\
             )",
            params![id],
        )
        .map_err(map_err)?;
        Ok(())
    }

    fn require_items_access(&self, conn: &Connection, ids: &[String]) -> Result<(), String> {
        if self.is_unlocked() {
            return Ok(());
        }
        for id in ids {
            if Self::item_effective_locked(conn, id)? {
                return Err(LOCKED_ERROR.into());
            }
        }
        Ok(())
    }

    fn require_item_access(&self, conn: &Connection, id: &str) -> Result<(), String> {
        self.require_items_access(conn, &[id.to_string()])
    }

    fn require_collection_access(&self, conn: &Connection, id: &str) -> Result<(), String> {
        if !self.is_unlocked() && Self::collection_effective_locked(conn, id)? {
            return Err(LOCKED_ERROR.into());
        }
        Ok(())
    }

    fn require_collection_tree_access(&self, conn: &Connection, id: &str) -> Result<(), String> {
        if self.is_unlocked() {
            return Ok(());
        }
        let mut stmt = conn
            .prepare(
                "WITH RECURSIVE descendants(id) AS (\
                   SELECT id FROM collections WHERE id = ?1 \
                   UNION ALL SELECT c.id FROM collections c JOIN descendants d ON c.parent_id = d.id\
                 ) SELECT id FROM descendants",
            )
            .map_err(map_err)?;
        let ids = stmt
            .query_map(params![id], |row| row.get::<_, String>(0))
            .map_err(map_err)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(map_err)?;
        for id in ids {
            if Self::collection_effective_locked(conn, &id)? {
                return Err(LOCKED_ERROR.into());
            }
        }
        let mut stmt = conn
            .prepare(
                "WITH RECURSIVE descendants(id) AS (\
                   SELECT id FROM collections WHERE id = ?1 \
                   UNION ALL SELECT c.id FROM collections c JOIN descendants d ON c.parent_id = d.id\
                 ) SELECT DISTINCT item_id FROM item_collections WHERE collection_id IN (SELECT id FROM descendants)",
            )
            .map_err(map_err)?;
        let item_ids = stmt
            .query_map(params![id], |row| row.get::<_, String>(0))
            .map_err(map_err)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(map_err)?;
        self.require_items_access(conn, &item_ids)?;
        Ok(())
    }

    fn require_tag_access(&self, conn: &Connection, id: &str) -> Result<(), String> {
        if self.is_unlocked() {
            return Ok(());
        }
        let mut stmt = conn
            .prepare("SELECT item_id FROM item_tags WHERE tag_id = ?1")
            .map_err(map_err)?;
        let ids = stmt
            .query_map(params![id], |row| row.get::<_, String>(0))
            .map_err(map_err)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(map_err)?;
        self.require_items_access(conn, &ids)
    }

    pub(crate) fn require_library_export_access(&self) -> Result<(), String> {
        if self.is_unlocked() {
            return Ok(());
        }
        let conn = self.db.lock().unwrap();
        let any_locked: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM items WHERE is_locked = 1 OR is_private = 1) \
                 OR EXISTS(SELECT 1 FROM collections WHERE is_locked = 1)",
                [],
                |row| row.get(0),
            )
            .map_err(map_err)?;
        if any_locked {
            Err(LOCKED_ERROR.into())
        } else {
            Ok(())
        }
    }

    fn redact_item(item: &mut Item) {
        item.content.clear();
        item.url.clear();
        item.stored_path.clear();
        item.size = 0;
        item.mime.clear();
        item.created_at.clear();
        item.updated_at.clear();
        item.last_opened_at.clear();
        item.is_favorite = false;
        item.tags.clear();
        item.collections.clear();
    }

    fn redact_item_content(item: &mut Item) {
        item.content.clear();
        item.url.clear();
    }

    pub fn init(app: &AppHandle) -> Result<Self, String> {
        let app_data = app.path().app_data_dir().map_err(map_err)?;
        let cache = app.path().app_cache_dir().map_err(map_err)?;
        std::fs::create_dir_all(&app_data).map_err(map_err)?;
        let location_file = app_data.join(LOCATION_FILE);
        let root = if location_file.exists() {
            let configured = std::fs::read_to_string(&location_file).map_err(map_err)?;
            let root = PathBuf::from(configured.trim());
            transfer::validate_library(&root)
                .map_err(|error| format!("资料库不可用：{}\n{error}", root.display()))?;
            root
        } else {
            app_data.clone()
        };
        std::fs::create_dir_all(root.join(FILES_DIR)).map_err(map_err)?;
        std::fs::create_dir_all(cache.join(THUMB_DIR)).map_err(map_err)?;
        let db_path = root.join("nook.db");
        let mut conn = db::open_db(&db_path).map_err(map_err)?;
        db::migrate(&mut conn)?;
        let lib = Self {
            db: Arc::new(Mutex::new(conn)),
            root,
            cache,
            app_data,
            files_lock: Arc::new(Mutex::new(())),
            unlocked_until: Arc::new(Mutex::new(None)),
        };
        lib.migrate_notes_to_files()?;
        Ok(lib)
    }

    pub fn files_dir(&self) -> PathBuf {
        self.root.join(FILES_DIR)
    }

    pub fn thumb_dir(&self) -> PathBuf {
        self.cache.join(THUMB_DIR)
    }

    pub(crate) fn safe_stored_path(&self, stored_path: &str) -> Result<PathBuf, String> {
        let relative = Path::new(stored_path);
        if relative.is_absolute()
            || !relative.starts_with(FILES_DIR)
            || relative.components().any(|component| {
                matches!(
                    component,
                    Component::ParentDir | Component::RootDir | Component::Prefix(_)
                )
            })
        {
            return Err("无效的库内文件路径".into());
        }
        let path = self.root.join(relative);
        if path.exists() {
            let files = self.files_dir().canonicalize().map_err(map_err)?;
            let canonical = path.canonicalize().map_err(map_err)?;
            if !canonical.starts_with(files) {
                return Err("库内文件路径越界".into());
            }
        }
        Ok(path)
    }

    fn stage_file_dirs(&self, paths: &[String]) -> Result<Vec<(PathBuf, PathBuf)>, String> {
        let mut seen = HashSet::new();
        let mut dirs = Vec::new();
        for stored_path in paths {
            let path = self.safe_stored_path(stored_path)?;
            let dir = path
                .parent()
                .filter(|dir| *dir != self.files_dir())
                .ok_or("无效的库内文件目录")?
                .to_path_buf();
            match std::fs::symlink_metadata(&dir) {
                Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => {
                    if seen.insert(dir.clone()) {
                        dirs.push(dir);
                    }
                }
                Ok(_) => return Err("无效的库内文件目录".into()),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(error.to_string()),
            }
        }
        if dirs.is_empty() {
            return Ok(Vec::new());
        }

        let staging = self.root.join(format!(".purge-{}", Uuid::new_v4()));
        std::fs::create_dir(&staging).map_err(map_err)?;
        let mut staged = Vec::new();
        for (index, source) in dirs.into_iter().enumerate() {
            let destination = staging.join(index.to_string());
            if let Err(error) = std::fs::rename(&source, &destination) {
                let restore = Self::restore_staged(&staged);
                let _ = std::fs::remove_dir_all(&staging);
                return Err(match restore {
                    Ok(()) => error.to_string(),
                    Err(restore_error) => {
                        format!("删除失败：{error}；恢复文件失败：{restore_error}")
                    }
                });
            }
            staged.push((source, destination));
        }
        Ok(staged)
    }

    fn restore_staged(staged: &[(PathBuf, PathBuf)]) -> Result<(), String> {
        for (source, destination) in staged.iter().rev() {
            std::fs::rename(destination, source).map_err(map_err)?;
        }
        if let Some((_, destination)) = staged.first() {
            if let Some(staging) = destination.parent() {
                let _ = std::fs::remove_dir(staging);
            }
        }
        Ok(())
    }

    fn discard_staged(staged: &[(PathBuf, PathBuf)]) {
        if let Some((_, destination)) = staged.first() {
            if let Some(staging) = destination.parent() {
                let _ = std::fs::remove_dir_all(staging);
            }
        }
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
            file_count: count(
                "SELECT COUNT(*) FROM items WHERE type='file' AND deleted_at IS NULL",
            )?,
            note_count: count(
                "SELECT COUNT(*) FROM items WHERE deleted_at IS NULL AND type='file' \
                 AND (mime = 'text/markdown' OR lower(stored_path) LIKE '%.md' \
                      OR lower(stored_path) LIKE '%.markdown')",
            )?,
            link_count: count(
                "SELECT COUNT(*) FROM items WHERE type='link' AND deleted_at IS NULL",
            )?,
        })
    }

    // ---- items: read ----------------------------------------------------

    pub fn list_items(&self, f: &ListFilters) -> Result<ListResult, String> {
        let conn = self.db.lock().unwrap();
        let unlocked = self.is_unlocked();
        let query = f.query.as_deref().unwrap_or("").trim();
        let parsed = search::parse_query(query);
        let fts_query = search::fts_query(&parsed.text);
        let snippet_sql = if fts_query.is_some() {
            "(SELECT snippet(items_fts, -1, '', '', ' … ', 24) FROM items_fts WHERE items_fts.rowid = i.rowid AND items_fts MATCH ?)"
        } else {
            "NULL"
        };
        let mut sql = format!(
            "SELECT {LIST_ITEM_COLS}, i.content, i.extracted_text, {snippet_sql} FROM items i WHERE 1=1"
        );
        let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
        if let Some(fts) = &fts_query {
            params.push(Box::new(fts.clone()));
        }

        if f.view == "trash" {
            sql.push_str(" AND i.deleted_at IS NOT NULL");
        } else if f.view == "privacy" {
            sql.push_str(" AND i.deleted_at IS NULL AND i.is_private = 1");
            if !unlocked {
                sql.push_str(" AND 0 = 1");
            }
        } else {
            sql.push_str(" AND i.deleted_at IS NULL AND i.is_private = 0");
            if f.view == "favorites" {
                sql.push_str(" AND i.is_favorite = 1");
                if !unlocked {
                    sql.push_str(&format!(" AND NOT ({COLLECTION_ITEM_LOCK})"));
                }
            } else if f.view == "recent" && !unlocked {
                sql.push_str(&format!(" AND NOT ({COLLECTION_ITEM_LOCK})"));
            } else if f.view == "uncollected" {
                sql.push_str(
                    " AND NOT EXISTS (SELECT 1 FROM item_collections ic WHERE ic.item_id = i.id)",
                );
            }
        }

        if let Some(cid) = &f.collection_id {
            sql.push_str(
                " AND EXISTS (\
                 WITH RECURSIVE descendants(id) AS (\
                   SELECT ? UNION ALL \
                   SELECT c.id FROM collections c JOIN descendants d ON c.parent_id = d.id\
                 ) \
                 SELECT 1 FROM item_collections ic \
                 JOIN descendants d ON d.id = ic.collection_id \
                 WHERE ic.item_id = i.id\
                 )",
            );
            params.push(Box::new(cid.clone()));
        }
        if let Some(tid) = &f.tag_id {
            sql.push_str(" AND EXISTS (SELECT 1 FROM item_tags it WHERE it.item_id = i.id AND it.tag_id = ?)");
            params.push(Box::new(tid.clone()));
        }
        if !parsed.item_types.is_empty() {
            let wants_file = parsed.item_types.iter().any(|value| value == "file");
            let wants_note = parsed.item_types.iter().any(|value| value == "note");
            let wants_link = parsed.item_types.iter().any(|value| value == "link");
            let mut clauses = Vec::new();
            if wants_file {
                clauses.push("i.type = 'file'");
            } else if wants_note {
                clauses.push(
                    "(i.type = 'note' OR (i.type = 'file' AND (i.mime = 'text/markdown' \
                     OR lower(i.stored_path) LIKE '%.md' OR lower(i.stored_path) LIKE '%.markdown')))",
                );
            }
            if wants_link {
                clauses.push("i.type = 'link'");
            }
            if !clauses.is_empty() {
                sql.push_str(" AND (");
                sql.push_str(&clauses.join(" OR "));
                sql.push(')');
            }
        }
        for tag in &parsed.tags {
            sql.push_str(" AND EXISTS (SELECT 1 FROM item_tags it JOIN tags t ON t.id = it.tag_id WHERE it.item_id = i.id AND t.name = ? COLLATE NOCASE)");
            params.push(Box::new(tag.clone()));
        }
        for collection in &parsed.collections {
            sql.push_str(" AND EXISTS (SELECT 1 FROM item_collections ic JOIN collections c ON c.id = ic.collection_id WHERE ic.item_id = i.id AND c.name = ? COLLATE NOCASE)");
            params.push(Box::new(collection.clone()));
        }
        for (op, date) in &parsed.dates {
            match op {
                '>' => sql.push_str(" AND date(i.created_at) > date(?)"),
                '<' => sql.push_str(" AND date(i.created_at) < date(?)"),
                _ => sql.push_str(" AND date(i.created_at) = date(?)"),
            }
            params.push(Box::new(date.clone()));
        }
        if !unlocked
            && (f.collection_id.is_some()
                || f.tag_id.is_some()
                || !parsed.tags.is_empty()
                || !parsed.collections.is_empty()
                || !parsed.dates.is_empty())
        {
            sql.push_str(&format!(" AND NOT ({COLLECTION_ITEM_LOCK})"));
        }
        if let Some(fts) = &fts_query {
            if unlocked {
                sql.push_str(
                    " AND i.rowid IN (SELECT rowid FROM items_fts WHERE items_fts MATCH ?)",
                );
                params.push(Box::new(fts.clone()));
            } else {
                sql.push_str(&format!(" AND ((NOT {EFFECTIVE_ITEM_LOCK} AND i.rowid IN (SELECT rowid FROM items_fts WHERE items_fts MATCH ?)) OR ({EFFECTIVE_ITEM_LOCK}"));
                params.push(Box::new(fts.clone()));
                for term in &parsed.text {
                    let pattern = format!(
                        "%{}%",
                        term.replace('\\', "\\\\")
                            .replace('%', "\\%")
                            .replace('_', "\\_")
                    );
                    sql.push_str(" AND i.title LIKE ? ESCAPE '\\'");
                    params.push(Box::new(pattern));
                }
                sql.push_str("))");
            }
        } else {
            for term in &parsed.text {
                let pattern = format!(
                    "%{}%",
                    term.replace('\\', "\\\\")
                        .replace('%', "\\%")
                        .replace('_', "\\_")
                );
                if unlocked {
                    sql.push_str(" AND (i.title LIKE ? ESCAPE '\\' OR i.content LIKE ? ESCAPE '\\' OR i.url LIKE ? ESCAPE '\\' OR i.extracted_text LIKE ? ESCAPE '\\')");
                } else {
                    sql.push_str(&format!(" AND (i.title LIKE ? ESCAPE '\\' OR (NOT {EFFECTIVE_ITEM_LOCK} AND (i.content LIKE ? ESCAPE '\\' OR i.url LIKE ? ESCAPE '\\' OR i.extracted_text LIKE ? ESCAPE '\\')))"));
                }
                for _ in 0..4 {
                    params.push(Box::new(pattern.clone()));
                }
            }
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

        let limit = if f.limit > 0 {
            f.limit
        } else if !query.is_empty() {
            500
        } else {
            0
        };
        if limit > 0 {
            sql.push_str(" LIMIT ?");
            params.push(Box::new(limit + 1));
        }

        let mut raw: Vec<(Item, String, String, Option<String>)> = {
            let mut stmt = conn.prepare(&sql).map_err(map_err)?;
            let rows = stmt
                .query_map(params_from_iter(params.iter().map(|b| b.as_ref())), |row| {
                    Ok((row_to_item(row)?, row.get(16)?, row.get(17)?, row.get(18)?))
                })
                .map_err(map_err)?;
            rows.collect::<Result<Vec<_>, _>>().map_err(map_err)?
        };
        let truncated = limit > 0 && raw.len() > limit as usize;
        if truncated {
            raw.truncate(limit as usize);
        }
        let mut items: Vec<Item> = raw.iter().map(|(item, _, _, _)| item.clone()).collect();
        load_relations(&conn, &mut items).map_err(map_err)?;
        let entries = items
            .into_iter()
            .zip(raw)
            .map(|(mut item, (_, content, extracted, fts_snippet))| {
                let locked = item.effective_locked && !unlocked;
                let snippet = (!locked)
                    .then(|| {
                        fts_snippet.or_else(|| {
                            search::plain_snippet(
                                &[&item.title, &content, &item.url, &extracted],
                                &parsed.text,
                            )
                        })
                    })
                    .flatten();
                if locked {
                    if item.collection_locked || item.is_private {
                        Self::redact_item(&mut item);
                        if item.is_private {
                            item.title.clear();
                        }
                    } else {
                        Self::redact_item_content(&mut item);
                    }
                }
                ListEntry {
                    snippet,
                    item: item.into(),
                    highlight_terms: parsed.text.clone(),
                }
            })
            .collect();
        Ok(ListResult { entries, truncated })
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
                 WHERE a.parent_id = ?1 AND (?2 = 1 OR i.is_private = 0) \
                 ORDER BY a.position"
            );
            let mut stmt = conn.prepare(&sql).map_err(map_err)?;
            let rows = stmt
                .query_map(params![id, item.is_private], row_to_item)
                .map_err(map_err)?;
            rows.collect::<Result<Vec<_>, _>>().map_err(map_err)?
        };
        load_relations(conn, &mut attachments).map_err(map_err)?;

        Ok(ItemDetail { item, attachments })
    }

    pub fn get_item(&self, id: &str) -> Result<ItemDetail, String> {
        let conn = self.db.lock().unwrap();
        self.require_item_access(&conn, id)?;
        let mut detail = self.get_item_locked(&conn, id)?;
        if !self.is_unlocked() {
            for attachment in &mut detail.attachments {
                if attachment.effective_locked {
                    if attachment.collection_locked || attachment.is_private {
                        Self::redact_item(attachment);
                        if attachment.is_private {
                            attachment.title.clear();
                        }
                    } else {
                        Self::redact_item_content(attachment);
                    }
                }
            }
        }
        Ok(detail)
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
        for collection_id in collection_ids {
            self.require_collection_access(&conn, collection_id)?;
        }
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
        let _files = self.files_lock.lock().unwrap();
        let stem = native::sanitize_stem(if title.trim().is_empty() {
            "无标题"
        } else {
            title
        })?;
        let dir = self.files_dir().join(uuid());
        std::fs::create_dir_all(&dir).map_err(map_err)?;
        let dest = dir.join(format!("{stem}.md"));
        if let Err(error) = std::fs::write(&dest, content.as_bytes()) {
            let _ = std::fs::remove_dir_all(&dir);
            return Err(error.to_string());
        }
        let rel = self.relative_path(&dest);
        let sha = native::sha256_bytes(content.as_bytes());
        let meta = serde_json::json!({ "sha256": sha }).to_string();
        match self.insert_item(
            "file",
            &stem,
            content,
            "",
            &rel,
            content.len() as i64,
            "text/markdown",
            &meta,
            collection_ids,
        ) {
            Ok(id) => self.get_item(&id).map(|d| d.item),
            Err(error) => {
                let _ = std::fs::remove_dir_all(&dir);
                Err(error)
            }
        }
    }

    pub fn migrate_notes_to_files(&self) -> Result<(), String> {
        let _files = self.files_lock.lock().unwrap();
        let notes: Vec<(String, String, String)> = {
            let conn = self.db.lock().unwrap();
            let mut stmt = conn
                .prepare("SELECT id, title, content FROM items WHERE type = 'note'")
                .map_err(map_err)?;
            let rows = stmt
                .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
                .map_err(map_err)?;
            rows.collect::<Result<Vec<_>, _>>().map_err(map_err)?
        };
        for (id, title, content) in notes {
            let stem = native::safe_stem(&title);
            let dir = self.files_dir().join(uuid());
            std::fs::create_dir_all(&dir).map_err(map_err)?;
            let dest = dir.join(format!("{stem}.md"));
            if let Err(error) = std::fs::write(&dest, content.as_bytes()) {
                let _ = std::fs::remove_dir_all(&dir);
                return Err(error.to_string());
            }
            let rel = self.relative_path(&dest);
            let sha = native::sha256_bytes(content.as_bytes());
            let conn = self.db.lock().unwrap();
            let updated = conn
                .execute(
                    "UPDATE items SET type = 'file', title = ?1, stored_path = ?2, \
                     size = ?3, mime = 'text/markdown', \
                     meta = json_set(CASE WHEN json_valid(meta) THEN meta ELSE '{}' END, '$.sha256', ?4) \
                     WHERE id = ?5 AND type = 'note'",
                    params![stem, rel, content.len() as i64, sha, id],
                )
                .map_err(map_err)?;
            if updated != 1 {
                let _ = std::fs::remove_dir_all(&dir);
                return Err(format!("迁移笔记失败: {id}"));
            }
        }
        Ok(())
    }

    pub fn rename_file(&self, id: &str, stem: &str, format: Option<&str>) -> Result<Item, String> {
        let _files = self.files_lock.lock().unwrap();
        let item = self.get_item(id)?.item;
        if item.item_type != "file" || item.stored_path.is_empty() {
            return Err("只有文件可以重命名".into());
        }
        if item.deleted_at.is_some() {
            return Err("回收站中的文件不可改名".into());
        }
        let stem = native::sanitize_stem(stem)?;
        let current_ext = native::file_extension(&item.stored_path);
        let new_ext = if let Some(format) = format {
            let canonical = native::canonical_format(format).ok_or("不支持的格式")?;
            if native::canonical_format(&current_ext).is_none() {
                return Err("此文件不能切换格式".into());
            }
            native::stored_extension(canonical)
                .ok_or("不支持的格式")?
                .to_string()
        } else {
            current_ext
        };
        let old_path = self.safe_stored_path(&item.stored_path)?;
        let new_name = if new_ext.is_empty() {
            stem.clone()
        } else {
            format!("{stem}.{new_ext}")
        };
        let new_path = old_path
            .parent()
            .ok_or("无效的库内文件目录")?
            .join(new_name);
        if new_path != old_path {
            if new_path.exists() {
                return Err("同名文件已存在".into());
            }
            std::fs::rename(&old_path, &new_path).map_err(map_err)?;
        }
        let rel = self.relative_path(&new_path);
        let mime = import::mime_of(new_path.file_name().and_then(|n| n.to_str()).unwrap_or(""));
        let result = (|| {
            let conn = self.db.lock().unwrap();
            let updated = conn
                .execute(
                    "UPDATE items SET title = ?1, stored_path = ?2, mime = ?3, \
                     updated_at = datetime('now') \
                     WHERE id = ?4 AND type = 'file' AND deleted_at IS NULL",
                    params![stem, rel, mime, id],
                )
                .map_err(map_err)?;
            if updated != 1 {
                return Err("文件条目不可改名".into());
            }
            Ok(())
        })();
        if let Err(error) = result {
            if new_path != old_path {
                let _ = std::fs::rename(&new_path, &old_path);
            }
            return Err(error);
        }
        self.get_item(id).map(|d| d.item)
    }

    pub fn create_link(
        &self,
        url: &str,
        title: &str,
        collection_ids: &[String],
    ) -> Result<Item, String> {
        let title = if title.is_empty() {
            url.to_string()
        } else {
            title.to_string()
        };
        let id = self.insert_item(
            "link",
            &title,
            "",
            url,
            "",
            0,
            "text/html",
            "{}",
            collection_ids,
        )?;
        self.get_item(&id).map(|d| d.item)
    }

    pub fn delete_items(&self, ids: &[String]) -> Result<(), String> {
        let conn = self.db.lock().unwrap();
        self.require_items_access(&conn, ids)?;
        let placeholders = vec!["?"; ids.len()].join(",");
        let sql = format!("UPDATE items SET deleted_at = datetime('now') WHERE id IN ({placeholders}) AND deleted_at IS NULL");
        conn.execute(&sql, params_from_iter(ids.iter()))
            .map_err(map_err)?;
        Ok(())
    }

    pub fn restore_items(&self, ids: &[String]) -> Result<(), String> {
        let conn = self.db.lock().unwrap();
        self.require_items_access(&conn, ids)?;
        let placeholders = vec!["?"; ids.len()].join(",");
        let sql = format!("UPDATE items SET deleted_at = NULL WHERE id IN ({placeholders})");
        conn.execute(&sql, params_from_iter(ids.iter()))
            .map_err(map_err)?;
        Ok(())
    }

    pub fn empty_trash(&self) -> Result<(), String> {
        let _files = self.files_lock.lock().unwrap();
        let mut conn = self.db.lock().unwrap();
        let all_ids = {
            let mut stmt = conn
                .prepare("SELECT id FROM items WHERE deleted_at IS NOT NULL")
                .map_err(map_err)?;
            let ids = stmt
                .query_map([], |row| row.get::<_, String>(0))
                .map_err(map_err)?
                .collect::<Result<Vec<_>, _>>()
                .map_err(map_err)?;
            ids
        };
        self.require_items_access(&conn, &all_ids)?;
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
        let staged = self.stage_file_dirs(&paths)?;
        let deleted = (|| {
            let transaction = conn.transaction().map_err(map_err)?;
            transaction
                .execute("DELETE FROM items WHERE deleted_at IS NOT NULL", [])
                .map_err(map_err)?;
            transaction.commit().map_err(map_err)
        })();
        if let Err(error) = deleted {
            Self::restore_staged(&staged)?;
            return Err(error);
        }
        Self::discard_staged(&staged);
        for id in &ids {
            let _ = std::fs::remove_file(self.thumb_dir().join(format!("{id}.png")));
        }
        Ok(())
    }

    /// Permanently delete specific trashed items (and their stored files).
    pub fn purge_items(&self, ids: &[String]) -> Result<(), String> {
        if ids.is_empty() {
            return Ok(());
        }
        let _files = self.files_lock.lock().unwrap();
        let mut conn = self.db.lock().unwrap();
        self.require_items_access(&conn, ids)?;
        let placeholders = vec!["?"; ids.len()].join(",");
        let rows: Vec<(String, String)> = {
            let sql = format!(
                "SELECT id, stored_path FROM items WHERE deleted_at IS NOT NULL AND type = 'file' AND id IN ({placeholders})"
            );
            let mut stmt = conn.prepare(&sql).map_err(map_err)?;
            let rows = stmt
                .query_map(params_from_iter(ids.iter()), |r| {
                    Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
                })
                .map_err(map_err)?;
            rows.collect::<Result<Vec<_>, _>>().map_err(map_err)?
        };
        let (file_ids, paths): (Vec<String>, Vec<String>) = rows.into_iter().unzip();
        let staged = self.stage_file_dirs(&paths)?;
        let sql =
            format!("DELETE FROM items WHERE deleted_at IS NOT NULL AND id IN ({placeholders})");
        let deleted = (|| {
            let transaction = conn.transaction().map_err(map_err)?;
            transaction
                .execute(&sql, params_from_iter(ids.iter()))
                .map_err(map_err)?;
            transaction.commit().map_err(map_err)
        })();
        if let Err(error) = deleted {
            Self::restore_staged(&staged)?;
            return Err(error);
        }
        Self::discard_staged(&staged);
        for id in file_ids {
            let _ = std::fs::remove_file(self.thumb_dir().join(format!("{id}.png")));
        }
        Ok(())
    }

    pub fn set_favorite(&self, id: &str, favorite: bool) -> Result<Item, String> {
        {
            let conn = self.db.lock().unwrap();
            self.require_item_access(&conn, id)?;
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
        self.require_item_access(&conn, id)?;
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
            .prepare("SELECT c.id, c.name, c.parent_id, c.position, c.created_at, c.is_locked, \
                      EXISTS(WITH RECURSIVE ancestors(id, parent_id, is_locked) AS (\
                        SELECT id, parent_id, is_locked FROM collections WHERE id = c.id \
                        UNION ALL SELECT p.id, p.parent_id, p.is_locked FROM collections p JOIN ancestors a ON a.parent_id = p.id\
                      ) SELECT 1 FROM ancestors WHERE is_locked = 1) \
                      FROM collections c ORDER BY c.position ASC, c.name COLLATE NOCASE")
            .map_err(map_err)?;
        let rows = stmt
            .query_map([], |r| {
                Ok(Collection {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    parent_id: r.get(2)?,
                    position: r.get(3)?,
                    created_at: r.get(4)?,
                    is_locked: r.get::<_, i64>(5)? != 0,
                    effective_locked: r.get::<_, i64>(6)? != 0,
                })
            })
            .map_err(map_err)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(map_err)
    }

    pub fn create_collection(
        &self,
        name: &str,
        parent_id: Option<&str>,
    ) -> Result<Collection, String> {
        let conn = self.db.lock().unwrap();
        let name = name.trim();
        if name.is_empty() {
            return Err("集合名称不能为空".into());
        }
        if let Some(parent_id) = parent_id {
            self.require_collection_access(&conn, parent_id)?;
            let exists: bool = conn
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM collections WHERE id = ?1)",
                    params![parent_id],
                    |r| r.get(0),
                )
                .map_err(map_err)?;
            if !exists {
                return Err("父集合不存在".into());
            }
        }
        let id = uuid();
        let position: i64 = conn
            .query_row(
                "SELECT COALESCE(MAX(position), -1) + 1 FROM collections WHERE parent_id IS ?1",
                params![parent_id],
                |r| r.get(0),
            )
            .map_err(map_err)?;
        conn.execute(
            "INSERT INTO collections (id, name, parent_id, position, created_at) VALUES (?1, ?2, ?3, ?4, datetime('now'))",
            params![id, name, parent_id, position],
        )
        .map_err(map_err)?;
        let created_at: String = conn
            .query_row("SELECT datetime('now')", [], |r| r.get(0))
            .map_err(map_err)?;
        let effective_locked = parent_id.is_some_and(|parent| {
            Self::collection_effective_locked(&conn, parent).unwrap_or(false)
        });
        Ok(Collection {
            id,
            name: name.to_string(),
            parent_id: parent_id.map(|s| s.to_string()),
            position,
            created_at,
            is_locked: false,
            effective_locked,
        })
    }

    pub fn set_items_locked(&self, ids: &[String], locked: bool) -> Result<(), String> {
        if ids.is_empty() {
            return Ok(());
        }
        let conn = self.db.lock().unwrap();
        if !locked {
            self.require_items_access(&conn, ids)?;
        }
        let placeholders = vec!["?"; ids.len()].join(",");
        let sql = if locked {
            format!(
                "UPDATE items AS i SET is_locked = 1 WHERE id IN ({placeholders}) AND NOT ({COLLECTION_ITEM_LOCK})"
            )
        } else {
            format!("UPDATE items SET is_locked = 0 WHERE id IN ({placeholders})")
        };
        let updated = conn
            .execute(&sql, params_from_iter(ids.iter()))
            .map_err(map_err)?;
        drop(conn);
        if locked && updated > 0 {
            self.lock_now();
        }
        Ok(())
    }

    pub fn set_items_private(&self, ids: &[String], private: bool) -> Result<(), String> {
        if ids.is_empty() {
            return Ok(());
        }
        let mut conn = self.db.lock().unwrap();
        self.require_items_access(&conn, ids)?;
        let placeholders = vec!["?"; ids.len()].join(",");
        let eligible: i64 = conn
            .query_row(
                &format!(
                    "SELECT COUNT(*) FROM items WHERE id IN ({placeholders}) \
                     AND type = 'file' AND deleted_at IS NULL"
                ),
                params_from_iter(ids.iter()),
                |row| row.get(0),
            )
            .map_err(map_err)?;
        if eligible != ids.len() as i64 {
            return Err("只有未删除的文件可以移入或移出保险箱".into());
        }

        let transaction = conn.transaction().map_err(map_err)?;
        if private {
            transaction
                .execute(
                    &format!("DELETE FROM item_collections WHERE item_id IN ({placeholders})"),
                    params_from_iter(ids.iter()),
                )
                .map_err(map_err)?;
        }
        transaction
            .execute(
                &format!(
                    "UPDATE items SET is_private = {} WHERE id IN ({placeholders})",
                    if private { 1 } else { 0 }
                ),
                params_from_iter(ids.iter()),
            )
            .map_err(map_err)?;
        transaction.commit().map_err(map_err)
    }

    pub fn set_collection_locked(&self, id: &str, locked: bool) -> Result<(), String> {
        let mut conn = self.db.lock().unwrap();
        if !locked {
            self.require_collection_access(&conn, id)?;
        }
        let transaction = conn.transaction().map_err(map_err)?;
        let updated = transaction
            .execute(
                "UPDATE collections SET is_locked = ?1 WHERE id = ?2",
                params![if locked { 1 } else { 0 }, id],
            )
            .map_err(map_err)?;
        if updated != 1 {
            return Err("集合不存在".into());
        }
        Self::clear_direct_locks_in_collection_tree(&transaction, id)?;
        transaction.commit().map_err(map_err)?;
        drop(conn);
        if locked {
            self.lock_now();
        }
        Ok(())
    }

    pub fn rename_collection(&self, id: &str, name: &str) -> Result<(), String> {
        let conn = self.db.lock().unwrap();
        self.require_collection_access(&conn, id)?;
        let name = name.trim();
        if name.is_empty() {
            return Err("集合名称不能为空".into());
        }
        let updated = conn
            .execute(
                "UPDATE collections SET name = ?1 WHERE id = ?2",
                params![name, id],
            )
            .map_err(map_err)?;
        if updated != 1 {
            return Err("集合不存在".into());
        }
        Ok(())
    }

    pub fn move_collection(
        &self,
        id: &str,
        parent_id: Option<&str>,
        before_id: Option<&str>,
    ) -> Result<(), String> {
        if parent_id == Some(id) || before_id == Some(id) {
            return Err("集合不能移动到自身".into());
        }

        let mut conn = self.db.lock().unwrap();
        let old_parent: Option<String> = conn
            .query_row(
                "SELECT parent_id FROM collections WHERE id = ?1",
                params![id],
                |r| r.get(0),
            )
            .optional()
            .map_err(map_err)?
            .ok_or_else(|| "集合不存在".to_string())?;
        if old_parent.as_deref() != parent_id {
            self.require_collection_access(&conn, id)?;
            if let Some(parent_id) = parent_id {
                self.require_collection_access(&conn, parent_id)?;
            }
        }
        let tx = conn.transaction().map_err(map_err)?;
        let was_locked = Self::collection_effective_locked(&tx, id)?;

        if let Some(parent_id) = parent_id {
            let invalid: bool = tx
                .query_row(
                    "WITH RECURSIVE descendants(id) AS (\
                       SELECT id FROM collections WHERE id = ?1 \
                       UNION ALL \
                       SELECT c.id FROM collections c JOIN descendants d ON c.parent_id = d.id\
                     ) SELECT EXISTS(SELECT 1 FROM descendants WHERE id = ?2)",
                    params![id, parent_id],
                    |r| r.get(0),
                )
                .map_err(map_err)?;
            if invalid {
                return Err("不能将集合移动到自己的子集合中".into());
            }
            let exists: bool = tx
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM collections WHERE id = ?1)",
                    params![parent_id],
                    |r| r.get(0),
                )
                .map_err(map_err)?;
            if !exists {
                return Err("父集合不存在".into());
            }
        }

        let sibling_ids = |parent: Option<&str>| -> Result<Vec<String>, String> {
            let mut stmt = tx
                .prepare(
                    "SELECT id FROM collections WHERE parent_id IS ?1 AND id != ?2 \
                     ORDER BY position, name COLLATE NOCASE",
                )
                .map_err(map_err)?;
            let rows = stmt
                .query_map(params![parent, id], |r| r.get::<_, String>(0))
                .map_err(map_err)?;
            rows.collect::<Result<Vec<_>, _>>().map_err(map_err)
        };

        let mut target = sibling_ids(parent_id)?;
        let insert_at = if let Some(before_id) = before_id {
            target
                .iter()
                .position(|candidate| candidate == before_id)
                .ok_or_else(|| "排序目标不属于目标父集合".to_string())?
        } else {
            target.len()
        };
        target.insert(insert_at, id.to_string());

        tx.execute(
            "UPDATE collections SET parent_id = ?1 WHERE id = ?2",
            params![parent_id, id],
        )
        .map_err(map_err)?;

        if old_parent.as_deref() != parent_id {
            for (position, sibling_id) in sibling_ids(old_parent.as_deref())?.iter().enumerate() {
                tx.execute(
                    "UPDATE collections SET position = ?1 WHERE id = ?2",
                    params![position as i64, sibling_id],
                )
                .map_err(map_err)?;
            }
        }
        for (position, sibling_id) in target.iter().enumerate() {
            tx.execute(
                "UPDATE collections SET position = ?1 WHERE id = ?2",
                params![position as i64, sibling_id],
            )
            .map_err(map_err)?;
        }
        if was_locked || Self::collection_effective_locked(&tx, id)? {
            Self::clear_direct_locks_in_collection_tree(&tx, id)?;
        }
        tx.commit().map_err(map_err)
    }

    pub fn delete_collection_tree(&self, id: &str) -> Result<i64, String> {
        let mut conn = self.db.lock().unwrap();
        self.require_collection_tree_access(&conn, id)?;
        let tx = conn.transaction().map_err(map_err)?;
        let count: i64 = tx
            .query_row(
                "WITH RECURSIVE descendants(id) AS (\
                   SELECT id FROM collections WHERE id = ?1 \
                   UNION ALL \
                   SELECT c.id FROM collections c JOIN descendants d ON c.parent_id = d.id\
                 ) SELECT COUNT(*) FROM descendants",
                params![id],
                |r| r.get(0),
            )
            .map_err(map_err)?;
        if count == 0 {
            return Err("集合不存在".into());
        }
        tx.execute(
            "WITH RECURSIVE descendants(id) AS (\
               SELECT id FROM collections WHERE id = ?1 \
               UNION ALL \
               SELECT c.id FROM collections c JOIN descendants d ON c.parent_id = d.id\
             ) DELETE FROM collections WHERE id IN (SELECT id FROM descendants)",
            params![id],
        )
        .map_err(map_err)?;
        tx.commit().map_err(map_err)?;
        Ok(count)
    }

    pub fn add_items_to_collection(
        &self,
        item_ids: &[String],
        collection_id: &str,
    ) -> Result<(), String> {
        if item_ids.is_empty() {
            return Ok(());
        }
        let mut conn = self.db.lock().unwrap();
        self.require_items_access(&conn, item_ids)?;
        self.require_collection_access(&conn, collection_id)?;
        let collection_locked = Self::collection_effective_locked(&conn, collection_id)?;
        let placeholders = vec!["?"; item_ids.len()].join(",");
        let private: bool = conn
            .query_row(
                &format!(
                    "SELECT EXISTS(SELECT 1 FROM items WHERE is_private = 1 AND id IN ({placeholders}))"
                ),
                params_from_iter(item_ids.iter()),
                |row| row.get(0),
            )
            .map_err(map_err)?;
        if private {
            return Err("保险箱内的文件不能加入集合".into());
        }
        let transaction = conn.transaction().map_err(map_err)?;
        for item_id in item_ids {
            transaction.execute(
                "INSERT OR IGNORE INTO item_collections (item_id, collection_id) VALUES (?1, ?2)",
                params![item_id, collection_id],
            )
            .map_err(map_err)?;
        }
        if collection_locked {
            transaction
                .execute(
                    &format!("UPDATE items SET is_locked = 0 WHERE id IN ({placeholders})"),
                    params_from_iter(item_ids.iter()),
                )
                .map_err(map_err)?;
        }
        transaction.commit().map_err(map_err)
    }

    pub fn remove_items_from_collection(
        &self,
        item_ids: &[String],
        collection_id: &str,
    ) -> Result<(), String> {
        let conn = self.db.lock().unwrap();
        self.require_items_access(&conn, item_ids)?;
        self.require_collection_access(&conn, collection_id)?;
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
        let name = name.trim();
        if name.is_empty() {
            return Err("标签名称不能为空".into());
        }
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
        self.require_tag_access(&conn, id)?;
        let name = name.trim();
        if name.is_empty() {
            return Err("标签名称不能为空".into());
        }
        let updated = conn
            .execute("UPDATE tags SET name = ?1 WHERE id = ?2", params![name, id])
            .map_err(map_err)?;
        if updated != 1 {
            return Err("标签不存在".into());
        }
        Ok(())
    }

    pub fn set_tag_color(&self, id: &str, color: Option<&str>) -> Result<Tag, String> {
        if color.is_some_and(|value| !TAG_COLORS.contains(&value)) {
            return Err("无效的标签颜色".into());
        }
        let conn = self.db.lock().unwrap();
        self.require_tag_access(&conn, id)?;
        let updated = conn
            .execute(
                "UPDATE tags SET color = ?1 WHERE id = ?2",
                params![color, id],
            )
            .map_err(map_err)?;
        if updated != 1 {
            return Err("标签不存在".into());
        }
        conn.query_row(
            "SELECT id, name, color, emoji FROM tags WHERE id = ?1",
            params![id],
            |r| {
                Ok(Tag {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    color: r.get(2)?,
                    emoji: r.get(3)?,
                })
            },
        )
        .map_err(map_err)
    }

    pub fn delete_tag(&self, id: &str) -> Result<(), String> {
        let conn = self.db.lock().unwrap();
        self.require_tag_access(&conn, id)?;
        conn.execute("DELETE FROM tags WHERE id = ?1", params![id])
            .map_err(map_err)?;
        Ok(())
    }

    pub fn set_item_tags(&self, item_id: &str, tag_ids: &[String]) -> Result<Item, String> {
        {
            let conn = self.db.lock().unwrap();
            self.require_item_access(&conn, item_id)?;
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

    pub fn add_attachments(
        &self,
        parent_id: &str,
        child_ids: &[String],
    ) -> Result<ItemDetail, String> {
        {
            let conn = self.db.lock().unwrap();
            self.require_item_access(&conn, parent_id)?;
            self.require_items_access(&conn, child_ids)?;
            let parent: (String, String, bool) = conn
                .query_row(
                    "SELECT type, stored_path, is_private FROM items WHERE id = ?1",
                    params![parent_id],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
                )
                .map_err(map_err)?;
            if parent.0 != "file" || !native::is_switchable_text(&parent.1) {
                return Err("只有文本文件可以挂附件".into());
            }
            for child_id in child_ids {
                if child_id == parent_id {
                    continue;
                }
                let child: (String, bool) = conn
                    .query_row(
                        "SELECT type, is_private FROM items WHERE id = ?1",
                        params![child_id],
                        |r| Ok((r.get(0)?, r.get(1)?)),
                    )
                    .map_err(map_err)?;
                if child.0 != "file" {
                    continue;
                }
                if child.1 && !parent.2 {
                    return Err("保险箱内的文件不能挂到普通文件".into());
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
            self.require_item_access(&conn, parent_id)?;
            self.require_item_access(&conn, child_id)?;
            conn.execute(
                "DELETE FROM attachments WHERE parent_id = ?1 AND child_id = ?2",
                params![parent_id, child_id],
            )
            .map_err(map_err)?;
        }
        self.get_item(parent_id)
    }

    // ---- import / preview / native ---------------------------------------

    pub fn import_files(
        &self,
        paths: &[String],
        collection_id: Option<&str>,
    ) -> Result<ImportResult, String> {
        if let Some(collection_id) = collection_id {
            let conn = self.db.lock().unwrap();
            self.require_collection_access(&conn, collection_id)?;
        }
        let _files = self.files_lock.lock().unwrap();
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

    pub fn read_text_file(&self, id: &str) -> Result<TextFileDocument, String> {
        let _files = self.files_lock.lock().unwrap();
        native::read_text_file(self, id)
    }

    pub fn write_text_file(
        &self,
        id: &str,
        content: &str,
        expected_version: &str,
        encoding: &str,
        line_ending: &str,
    ) -> Result<TextFileWriteResult, String> {
        let _files = self.files_lock.lock().unwrap();
        native::write_text_file(self, id, content, expected_version, encoding, line_ending)
    }

    /// Absolute path of a File item's stored file (for in-window preview).
    pub fn file_abs_path(&self, id: &str) -> Result<Option<String>, String> {
        let conn = self.db.lock().unwrap();
        self.require_item_access(&conn, id)?;
        let stored: Option<(String, String)> = conn
            .query_row(
                "SELECT stored_path, mime FROM items WHERE id = ?1 AND type = 'file'",
                params![id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(map_err)?;
        Ok(stored
            .filter(|(path, mime)| !path.is_empty() && !native::is_media(mime, path))
            .map(|(stored_path, _)| self.safe_stored_path(&stored_path))
            .transpose()?
            .map(|path| path.to_string_lossy().to_string()))
    }
}
