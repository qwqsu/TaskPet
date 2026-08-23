import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { migrateDatabase } from "./migrations";

export type TaskDatabase = Database.Database;

export interface OpenTaskDatabaseOptions {
  migrationTimestamp?: string;
}

export function openTaskDatabase(
  filePath: string,
  options: OpenTaskDatabaseOptions = {}
): TaskDatabase {
  if (filePath !== ":memory:") {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }

  const database = new Database(filePath);

  try {
    database.pragma("foreign_keys = ON");
    database.pragma("busy_timeout = 5000");
    if (filePath !== ":memory:") {
      database.pragma("journal_mode = WAL");
    }
    migrateDatabase(database, options.migrationTimestamp);
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}
