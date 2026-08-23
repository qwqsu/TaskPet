/**
 * SQLite 连接入口：创建数据目录、设置连接 pragma，并在返回前完成 migration。
 * Renderer 永远不会直接引用本模块，只能通过 Main Process 的服务与 IPC 访问数据。
 */
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
    // 外键保证 Task 删除时关联数据一致；WAL 降低读写互相阻塞的概率。
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
