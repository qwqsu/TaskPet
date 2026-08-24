import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { openTaskDatabase } from "../src/main/db/database";
import { DataService } from "../src/main/services/data-service";

test("data service opens userData and exports a consistent SQLite backup", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "taskpet-data-service-"));
  const dataDirectory = path.join(root, "TaskPet");
  const backupDirectory = path.join(dataDirectory, "backups");
  const databasePath = path.join(dataDirectory, "taskpet.sqlite3");
  const exportPath = path.join(root, "exports", "taskpet-copy.sqlite3");
  const database = openTaskDatabase(databasePath);
  const opened: string[] = [];
  const logMessages: string[] = [];

  try {
    database.prepare("INSERT INTO settings (key, value) VALUES (?, ?)")
      .run("test.backup", "preserved");
    const service = new DataService(database, {
      databasePath,
      dataDirectory,
      backupDirectory,
      showSaveDialog: async () => ({ canceled: false, filePath: exportPath }),
      openPath: async (targetPath) => {
        opened.push(targetPath);
        return "";
      },
      logger: {
        info: (message) => logMessages.push(message),
        warn: () => {}
      },
      now: () => new Date("2026-08-24T01:02:03.000Z")
    });

    assert.deepEqual(await service.openDataDirectory(), {
      canceled: false,
      filePath: dataDirectory
    });
    assert.deepEqual(opened, [dataDirectory]);
    assert.deepEqual(await service.exportBackup(), {
      canceled: false,
      filePath: exportPath
    });
    assert.deepEqual(logMessages, ["Database backup exported"]);
    assert.equal(logMessages.some((message) => message.includes(exportPath)), false);

    const backup = new Database(exportPath, { readonly: true });
    try {
      assert.equal(
        (backup.prepare("SELECT value FROM settings WHERE key = ?").get("test.backup") as { value: string }).value,
        "preserved"
      );
    } finally {
      backup.close();
    }
  } finally {
    database.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("canceling export does not create a backup file", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "taskpet-data-cancel-"));
  const database = openTaskDatabase(":memory:");
  try {
    const service = new DataService(database, {
      databasePath: ":memory:",
      dataDirectory: root,
      backupDirectory: path.join(root, "backups"),
      showSaveDialog: async () => ({ canceled: true }),
      openPath: async () => ""
    });
    assert.deepEqual(await service.exportBackup(), { canceled: true, filePath: null });
  } finally {
    database.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
