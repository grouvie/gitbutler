use std::{
    fs, path,
    sync::{Arc, Mutex},
};

use anyhow::{Context, Result};

use rusqlite::{Connection, Transaction};
use tauri::AppHandle;

mod embedded {
    use refinery::embed_migrations;
    embed_migrations!("src/database/migrations");
}

#[derive(Clone)]
pub struct Database {
    conn: Arc<Mutex<Connection>>,
}

impl TryFrom<&path::PathBuf> for Database {
    type Error = anyhow::Error;

    fn try_from(path: &path::PathBuf) -> Result<Self, Self::Error> {
        Self::open(path)
    }
}

impl TryFrom<&AppHandle> for Database {
    type Error = anyhow::Error;

    fn try_from(value: &AppHandle) -> Result<Self, Self::Error> {
        let local_data_dir = value
            .path_resolver()
            .app_local_data_dir()
            .ok_or_else(|| anyhow::anyhow!("Failed to get local data dir"))?;
        fs::create_dir_all(&local_data_dir).context("Failed to create local data dir")?;
        Self::try_from(&local_data_dir.join("database.sqlite3"))
    }
}

impl Database {
    #[cfg(test)]
    pub fn memory() -> Result<Self> {
        let mut conn = Connection::open_in_memory().context("Failed to open in memory database")?;
        embedded::migrations::runner()
            .run(&mut conn)
            .map(|report| {
                report
                    .applied_migrations()
                    .iter()
                    .for_each(|m| tracing::info!("Applied migration: {}", m))
            })
            .context("Failed to run migrations")?;
        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
        })
    }

    fn open<P: AsRef<path::Path>>(path: P) -> Result<Self> {
        let path = path.as_ref();
        let mut conn = Connection::open(path).context("Failed to open database")?;
        embedded::migrations::runner()
            .run(&mut conn)
            .map(|report| {
                report
                    .applied_migrations()
                    .iter()
                    .for_each(|m| tracing::info!("Applied migration: {}", m))
            })
            .context("Failed to run migrations")?;
        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
        })
    }

    pub fn transaction<T>(&self, f: impl FnOnce(&Transaction) -> Result<T>) -> Result<T> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction().context("Failed to start transaction")?;
        let result = f(&tx)?;
        tx.commit().context("Failed to commit transaction")?;
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn test_memory() {
        let db = Database::memory().unwrap();
        db.transaction(|tx| {
            tx.execute("CREATE TABLE test (id INTEGER PRIMARY KEY)", [])
                .unwrap();
            tx.execute("INSERT INTO test (id) VALUES (1)", []).unwrap();
            let mut stmt = tx.prepare("SELECT id FROM test").unwrap();
            let mut rows = stmt.query([]).unwrap();
            let row = rows.next().unwrap().unwrap();
            let id: i32 = row.get(0).unwrap();
            assert_eq!(id, 1);
            Ok(())
        })
        .unwrap();
    }
}
