import type Database from "better-sqlite3";
import { initialMigration, type Migration } from "./001-init";

const migrations: readonly Migration[] = [initialMigration];

interface SchemaVersionRow {
  version: number;
  name: string;
}

export function migrateDatabase(
  database: Database.Database,
  appliedAt = new Date().toISOString()
): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const appliedRows = database
    .prepare("SELECT version, name FROM schema_version ORDER BY version")
    .all() as SchemaVersionRow[];
  const applied = new Map(appliedRows.map((row) => [row.version, row.name]));
  const latestKnownVersion = migrations.at(-1)?.version ?? 0;
  const latestAppliedVersion = appliedRows.at(-1)?.version ?? 0;

  if (latestAppliedVersion > latestKnownVersion) {
    throw new Error(
      `TaskPet database schema ${latestAppliedVersion} is newer than supported schema ${latestKnownVersion}`
    );
  }

  const applyMigration = database.transaction((migration: Migration) => {
    database.exec(migration.sql);
    database.prepare(`
      INSERT INTO schema_version (version, name, applied_at)
      VALUES (?, ?, ?)
    `).run(migration.version, migration.name, appliedAt);
  });

  for (const migration of migrations) {
    const appliedName = applied.get(migration.version);
    if (appliedName === migration.name) continue;
    if (appliedName) {
      throw new Error(
        `TaskPet database migration ${migration.version} is recorded as ${appliedName}, expected ${migration.name}`
      );
    }
    applyMigration(migration);
  }
}

export function latestSchemaVersion(): number {
  return migrations.at(-1)?.version ?? 0;
}
