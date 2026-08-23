import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openTaskDatabase } from "../src/main/db/database";
import { migrateDatabase, latestSchemaVersion } from "../src/main/db/migrations";
import { SettingsRepository } from "../src/main/db/task-repository";
import { createTaskHarness } from "./task-test-helpers";

test("initial migration establishes the P1 schema exactly once", () => {
  const harness = createTaskHarness();
  try {
    const tables = harness.database.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `).all() as Array<{ name: string }>;

    assert.deepEqual(tables.map((row) => row.name), [
      "schema_version",
      "settings",
      "task_occurrences",
      "tasks"
    ]);
    assert.equal(latestSchemaVersion(), 1);
    assert.equal(
      (harness.database.prepare("SELECT COUNT(*) AS count FROM schema_version").get() as { count: number }).count,
      1
    );

    migrateDatabase(harness.database, "2026-08-24T00:00:00.000Z");
    assert.equal(
      (harness.database.prepare("SELECT COUNT(*) AS count FROM schema_version").get() as { count: number }).count,
      1
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
      1
    );
  } finally {
    if (database.open) database.close();
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
