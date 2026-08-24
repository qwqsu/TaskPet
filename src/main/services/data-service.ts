/**
 * P4 数据目录与备份服务。
 * 数据库保持打开时使用 SQLite Online Backup API，避免直接复制 WAL 数据库。
 */
import fs from "node:fs";
import path from "node:path";
import type { TaskDatabase } from "../db/database";
import type { DataActionResult } from "../../shared/app-settings";

export interface SaveDialogResult {
  canceled: boolean;
  filePath?: string;
}

export interface DataServiceLogger {
  info(message: string): void;
  warn(message: string, error?: unknown): void;
}

export interface DataServiceOptions {
  databasePath: string;
  dataDirectory: string;
  backupDirectory: string;
  showSaveDialog(options: {
    title: string;
    buttonLabel: string;
    defaultPath: string;
    filters: Array<{ name: string; extensions: string[] }>;
  }): Promise<SaveDialogResult>;
  openPath(targetPath: string): Promise<string>;
  now?: () => Date;
  logger?: DataServiceLogger;
}

function backupTimestamp(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  const second = String(date.getSeconds()).padStart(2, "0");
  return `${year}${month}${day}-${hour}${minute}${second}`;
}

function comparablePath(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLocaleLowerCase("en-US") : resolved;
}

export class DataService {
  private readonly now: () => Date;

  constructor(
    private readonly database: TaskDatabase,
    private readonly options: DataServiceOptions
  ) {
    this.now = options.now ?? (() => new Date());
    fs.mkdirSync(options.dataDirectory, { recursive: true });
    fs.mkdirSync(options.backupDirectory, { recursive: true });
  }

  async openDataDirectory(): Promise<DataActionResult> {
    fs.mkdirSync(this.options.dataDirectory, { recursive: true });
    const errorMessage = await this.options.openPath(this.options.dataDirectory);
    if (errorMessage) throw new Error(errorMessage);
    return { canceled: false, filePath: this.options.dataDirectory };
  }

  async exportBackup(): Promise<DataActionResult> {
    const defaultPath = path.join(
      this.options.backupDirectory,
      `taskpet-backup-${backupTimestamp(this.now())}.sqlite3`
    );
    const result = await this.options.showSaveDialog({
      title: "导出 TaskPet 备份",
      buttonLabel: "导出备份",
      defaultPath,
      filters: [{ name: "TaskPet SQLite 备份", extensions: ["sqlite3", "db"] }]
    });
    if (result.canceled || !result.filePath) {
      return { canceled: true, filePath: null };
    }

    const destination = /\.(?:sqlite3|db)$/i.test(result.filePath)
      ? result.filePath
      : `${result.filePath}.sqlite3`;
    if (comparablePath(destination) === comparablePath(this.options.databasePath)) {
      throw new Error("备份文件不能覆盖正在使用的 TaskPet 数据库");
    }
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    await this.database.backup(destination);
    this.options.logger?.info("Database backup exported");
    return { canceled: false, filePath: destination };
  }
}
