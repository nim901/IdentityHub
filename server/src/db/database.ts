import Database from "better-sqlite3";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function applyMigrations(db: Database.Database) {
  db.exec("CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY)");
  const directory = new URL("../../migrations/", import.meta.url);
  const migrations = readdirSync(fileURLToPath(directory))
    .filter((name) => /^\d+_.*\.sql$/.test(name))
    .sort();

  for (const name of migrations) {
    if (db.prepare("SELECT name FROM migrations WHERE name = ?").get(name))
      continue;
    db.transaction(() => {
      db.exec(readFileSync(new URL(name, directory), "utf8"));
      db.prepare("INSERT INTO migrations (name) VALUES (?)").run(name);
    })();
  }
}

export function openDatabase(path: string) {
  const db = new Database(path);
  db.pragma("foreign_keys = ON");
  applyMigrations(db);
  return db;
}
