import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { openTaskDatabase } from "../src/main/db/database";
import { migrateDatabase, latestSchemaVersion } from "../src/main/db/migrations";
import { initialMigration } from "../src/main/db/migrations/001-init";
import { SettingsRepository } from "../src/main/db/task-repository";
import { createTaskHarness } from "./task-test-helpers";

test("migrations establish the task and process runtime schema exactly once", () => {
  const harness = createTaskHarness();
  try {
    const tables = harness.database.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `).all() as Array<{ name: string }>;

    assert.deepEqual(tables.map((row) => row.name), [
      "process_sessions",
      "schema_version",
      "settings",
      "task_occurrences",
      "task_process_rules",
      "tasks"
    ]);
    assert.equal(latestSchemaVersion(), 2);
    assert.equal(
      (harness.database.prepare("SELECT COUNT(*) AS count FROM schema_version").get() as { count: number }).count,
      2
    );

    migrateDatabase(harness.database, "2026-08-24T00:00:00.000Z");
    assert.equal(
      (harness.database.prepare("SELECT COUNT(*) AS count FROM schema_version").get() as { count: number }).count,
      2
    );
    assert.equal(harness.database.pragma("foreign_keys", { simple: true }), 1);
  } finally {
    harness.close();
  }
});

test("settings repository persists key-value application settings", () => {
  const harness = createTaskHarness();
  try {
    const settings = new SettingsRepository(harness.database);
    assert.equal(settings.get("panel.view"), null);
    settings.set("panel.view", "today");
    settings.set("panel.view", "history");
    assert.equal(settings.get("panel.view"), "history");
  } finally {
    harness.close();
  }
});

test("a migrated on-disk database can be reopened with its data intact", () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "taskpet-db-test-"));
  const databasePath = path.join(temporaryRoot, "taskpet.sqlite3");
  let database = openTaskDatabase(databasePath);

  try {
    const settings = new SettingsRepository(database);
    settings.set("test.persistence", "kept");
    database.close();

    database = openTaskDatabase(databasePath);
    assert.equal(new SettingsRepository(database).get("test.persistence"), "kept");
    assert.equal(
      (database.prepare("SELECT COUNT(*) AS count FROM schema_version").get() as { count: number }).count,
      2
    );
  } finally {
    if (database.open) database.close();
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("an existing database is backed up before a pending migration", () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "taskpet-migration-backup-"));
  const databasePath = path.join(temporaryRoot, "taskpet.sqlite3");
  const backupDirectory = path.join(temporaryRoot, "backups");
  const legacy = new Database(databasePath);
  legacy.exec(`
    CREATE TABLE schema_version (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
    ${initialMigration.sql}
  `);
  legacy.prepare(`
    INSERT INTO schema_version (version, name, applied_at)
    VALUES (1, '001_init', '2026-08-23T00:00:00.000Z')
  `).run();
  legacy.prepare("INSERT INTO settings (key, value) VALUES (?, ?)")
    .run("before.migration", "preserved");
  legacy.close();

  const createdBackups: string[] = [];
  const database = openTaskDatabase(databasePath, {
    backupDirectory,
    migrationTimestamp: "2026-08-24T01:02:03.000Z",
    onBackupCreated: (backupPath) => createdBackups.push(backupPath)
  });

  try {
    assert.equal(createdBackups.length, 1);
    assert.equal(fs.existsSync(createdBackups[0]!), true);
    assert.equal(latestSchemaVersion(), 2);
    assert.equal(
      (database.prepare("SELECT COUNT(*) AS count FROM schema_version").get() as { count: number }).count,
      2
    );

    const backup = new Database(createdBackups[0]!, { readonly: true });
    try {
      assert.equal(
        (backup.prepare("SELECT COUNT(*) AS count FROM schema_version").get() as { count: number }).count,
        1
      );
      assert.equal(
        (backup.prepare("SELECT value FROM settings WHERE key = ?").get("before.migration") as { value: string }).value,
        "preserved"
      );
      assert.equal(
        (backup.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name = 'process_sessions'").get() as { count: number }).count,
        0
      );
    } finally {
      backup.close();
    }
  } finally {
    database.close();
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
