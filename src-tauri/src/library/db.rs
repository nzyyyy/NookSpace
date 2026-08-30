use rusqlite::Connection;
use rusqlite_migration::{Migrations, M};
use std::path::Path;
use std::sync::LazyLock;

pub static MIGRATIONS: LazyLock<Migrations> = LazyLock::new(|| {
    Migrations::new(vec![
        M::up(include_str!("migrations/001_init.sql")),
        M::up(include_str!("migrations/002_v1.sql")),
        M::up(include_str!("migrations/003_locks.sql")),
        M::up(include_str!("migrations/004_privacy.sql")),
        M::up(include_str!("migrations/005_collection_lock_ownership.sql")),
    ])
});

pub fn open_db(path: &Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    conn.busy_timeout(std::time::Duration::from_secs(5))?;
    Ok(conn)
}

pub fn migrate(conn: &mut Connection) -> Result<(), String> {
    MIGRATIONS
        .to_latest(conn)
        .map_err(|e| format!("migration failed: {e}"))
}
