/**
 * 数据库 v2：增加用户主动绑定的程序规则和与任务相关的运行 Session。
 * 不保存完整系统进程历史，只保存匹配任务所需的信息。
 */
import type { Migration } from "./001-init";

export const processRuntimeMigration: Migration = {
  version: 2,
  name: "002_process_runtime",
  sql: `
    CREATE TABLE task_process_rules (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      executable_name TEXT,
      executable_path TEXT,
      bundle_id TEXT,
      match_mode TEXT NOT NULL CHECK (
        match_mode IN ('exact_path', 'process_name')
      ),
      created_at TEXT NOT NULL,
      CHECK (executable_name IS NOT NULL OR executable_path IS NOT NULL OR bundle_id IS NOT NULL),
      CHECK (match_mode <> 'exact_path' OR executable_path IS NOT NULL),
      CHECK (match_mode <> 'process_name' OR executable_name IS NOT NULL),
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );

    CREATE TABLE process_sessions (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      occurrence_id TEXT NOT NULL,
      executable_name TEXT,
      executable_path TEXT,
      started_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      ended_at TEXT,
      duration_sec INTEGER NOT NULL DEFAULT 0 CHECK (duration_sec >= 0),
      finalized INTEGER NOT NULL DEFAULT 0 CHECK (finalized IN (0, 1)),
      CHECK (
        (finalized = 0 AND ended_at IS NULL)
        OR (finalized = 1 AND ended_at IS NOT NULL)
      ),
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (occurrence_id) REFERENCES task_occurrences(id) ON DELETE CASCADE
    );

    CREATE INDEX idx_process_rules_task
      ON task_process_rules(task_id);

    CREATE INDEX idx_process_sessions_occurrence
      ON process_sessions(occurrence_id, started_at);

    CREATE INDEX idx_process_sessions_open
      ON process_sessions(finalized, last_seen_at)
      WHERE finalized = 0;

    CREATE UNIQUE INDEX idx_process_sessions_one_open_occurrence
      ON process_sessions(occurrence_id)
      WHERE finalized = 0;
  `
};
