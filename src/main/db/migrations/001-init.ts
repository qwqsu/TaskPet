export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const initialMigration: Migration = {
  version: 1,
  name: "001_init",
  sql: `
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120),
      description TEXT,
      task_type TEXT NOT NULL CHECK (task_type IN ('daily', 'one_time')),
      recurrence_rule TEXT,
      completion_mode TEXT NOT NULL CHECK (
        completion_mode IN ('manual', 'duration', 'process_start', 'process_exit')
      ),
      target_duration_sec INTEGER NOT NULL DEFAULT 0 CHECK (target_duration_sec >= 0),
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
      archived_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE task_occurrences (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      occurrence_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (
        status IN ('pending', 'active', 'completed')
      ),
      accumulated_sec INTEGER NOT NULL DEFAULT 0 CHECK (accumulated_sec >= 0),
      completed_at TEXT,
      completion_source TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (task_id, occurrence_date),
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );

    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE INDEX idx_tasks_today
      ON tasks(enabled, archived_at, task_type, sort_order);

    CREATE INDEX idx_occurrences_task_status
      ON task_occurrences(task_id, status, occurrence_date);

    CREATE INDEX idx_occurrences_completed_at
      ON task_occurrences(completed_at)
      WHERE completed_at IS NOT NULL;
  `
};
