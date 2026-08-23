import type { TaskDatabase } from "./database";
import type {
  CompletionSource,
  OccurrenceStatus,
  Task,
  TaskCompletionMode,
  TaskListItem,
  TaskOccurrence,
  TaskType
} from "../../shared/task-types";

interface TaskRow {
  id: string;
  title: string;
  description: string | null;
  task_type: TaskType;
  recurrence_rule: string | null;
  completion_mode: TaskCompletionMode;
  target_duration_sec: number;
  enabled: number;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  sort_order: number;
}

interface OccurrenceRow {
  id: string;
  task_id: string;
  occurrence_date: string;
  status: OccurrenceStatus;
  accumulated_sec: number;
  completed_at: string | null;
  completion_source: CompletionSource;
  created_at: string;
  updated_at: string;
}

interface JoinedRow extends TaskRow {
  occurrence_id: string;
  occurrence_task_id: string;
  occurrence_date: string;
  occurrence_status: OccurrenceStatus;
  occurrence_accumulated_sec: number;
  occurrence_completed_at: string | null;
  occurrence_completion_source: CompletionSource;
  occurrence_created_at: string;
  occurrence_updated_at: string;
}

export interface NewTaskRow {
  id: string;
  title: string;
  description: string | null;
  taskType: TaskType;
  recurrenceRule: string | null;
  completionMode: TaskCompletionMode;
  targetDurationSec: number;
  enabled: boolean;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  sortOrder: number;
}

export interface NewOccurrenceRow {
  id: string;
  taskId: string;
  occurrenceDate: string;
  status: OccurrenceStatus;
  accumulatedSec: number;
  completedAt: string | null;
  completionSource: CompletionSource;
  createdAt: string;
  updatedAt: string;
}

function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    taskType: row.task_type,
    recurrenceRule: row.recurrence_rule,
    completionMode: row.completion_mode,
    targetDurationSec: row.target_duration_sec,
    enabled: row.enabled === 1,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sortOrder: row.sort_order
  };
}

function toOccurrence(row: OccurrenceRow): TaskOccurrence {
  return {
    id: row.id,
    taskId: row.task_id,
    occurrenceDate: row.occurrence_date,
    status: row.status,
    accumulatedSec: row.accumulated_sec,
    completedAt: row.completed_at,
    completionSource: row.completion_source,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toTaskListItem(row: JoinedRow): TaskListItem {
  return {
    task: toTask(row),
    occurrence: toOccurrence({
      id: row.occurrence_id,
      task_id: row.occurrence_task_id,
      occurrence_date: row.occurrence_date,
      status: row.occurrence_status,
      accumulated_sec: row.occurrence_accumulated_sec,
      completed_at: row.occurrence_completed_at,
      completion_source: row.occurrence_completion_source,
      created_at: row.occurrence_created_at,
      updated_at: row.occurrence_updated_at
    })
  };
}

const JOINED_TASK_SELECT = `
  SELECT
    t.id,
    t.title,
    t.description,
    t.task_type,
    t.recurrence_rule,
    t.completion_mode,
    t.target_duration_sec,
    t.enabled,
    t.archived_at,
    t.created_at,
    t.updated_at,
    t.sort_order,
    o.id AS occurrence_id,
    o.task_id AS occurrence_task_id,
    o.occurrence_date,
    o.status AS occurrence_status,
    o.accumulated_sec AS occurrence_accumulated_sec,
    o.completed_at AS occurrence_completed_at,
    o.completion_source AS occurrence_completion_source,
    o.created_at AS occurrence_created_at,
    o.updated_at AS occurrence_updated_at
  FROM task_occurrences o
  JOIN tasks t ON t.id = o.task_id
`;

export class TaskRepository {
  constructor(private readonly database: TaskDatabase) {}

  transaction<T>(operation: () => T): T {
    return this.database.transaction(operation)();
  }

  insertTask(task: NewTaskRow): Task {
    this.database.prepare(`
      INSERT INTO tasks (
        id, title, description, task_type, recurrence_rule,
        completion_mode, target_duration_sec, enabled, archived_at,
        created_at, updated_at, sort_order
      ) VALUES (
        @id, @title, @description, @taskType, @recurrenceRule,
        @completionMode, @targetDurationSec, @enabled, @archivedAt,
        @createdAt, @updatedAt, @sortOrder
      )
    `).run({ ...task, enabled: task.enabled ? 1 : 0 });

    return this.requireTask(task.id);
  }

  updateTask(task: Task): Task {
    this.database.prepare(`
      UPDATE tasks
      SET title = @title,
          description = @description,
          recurrence_rule = @recurrenceRule,
          completion_mode = @completionMode,
          target_duration_sec = @targetDurationSec,
          enabled = @enabled,
          archived_at = @archivedAt,
          updated_at = @updatedAt,
          sort_order = @sortOrder
      WHERE id = @id
    `).run({ ...task, enabled: task.enabled ? 1 : 0 });

    return this.requireTask(task.id);
  }

  archiveTask(id: string, archivedAt: string): Task {
    const result = this.database.prepare(`
      UPDATE tasks
      SET enabled = 0, archived_at = ?, updated_at = ?
      WHERE id = ? AND archived_at IS NULL
    `).run(archivedAt, archivedAt, id);

    if (result.changes === 0) return this.requireTask(id);
    return this.requireTask(id);
  }

  findTask(id: string): Task | null {
    const row = this.database.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRow | undefined;
    return row ? toTask(row) : null;
  }

  requireTask(id: string): Task {
    const task = this.findTask(id);
    if (!task) throw new Error(`Task not found: ${id}`);
    return task;
  }

  nextSortOrder(): number {
    const row = this.database.prepare(`
      SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_sort_order
      FROM tasks
      WHERE archived_at IS NULL
    `).get() as { next_sort_order: number };
    return row.next_sort_order;
  }

  listMaterializableDailyTasks(): Task[] {
    const rows = this.database.prepare(`
      SELECT * FROM tasks
      WHERE task_type = 'daily' AND enabled = 1 AND archived_at IS NULL
      ORDER BY sort_order, created_at
    `).all() as TaskRow[];
    return rows.map(toTask);
  }

  insertOccurrenceIfMissing(occurrence: NewOccurrenceRow): boolean {
    const result = this.database.prepare(`
      INSERT INTO task_occurrences (
        id, task_id, occurrence_date, status, accumulated_sec,
        completed_at, completion_source, created_at, updated_at
      ) VALUES (
        @id, @taskId, @occurrenceDate, @status, @accumulatedSec,
        @completedAt, @completionSource, @createdAt, @updatedAt
      )
      ON CONFLICT(task_id, occurrence_date) DO NOTHING
    `).run(occurrence);
    return result.changes === 1;
  }

  listTodayCandidates(date: string): TaskListItem[] {
    const rows = this.database.prepare(`${JOINED_TASK_SELECT}
      WHERE t.enabled = 1
        AND t.archived_at IS NULL
        AND (
          (t.task_type = 'daily' AND o.occurrence_date = ?)
          OR t.task_type = 'one_time'
        )
      ORDER BY t.sort_order, t.created_at, o.created_at
    `).all(date) as JoinedRow[];
    return rows.map(toTaskListItem);
  }

  listCompletedItems(): TaskListItem[] {
    const rows = this.database.prepare(`${JOINED_TASK_SELECT}
      WHERE o.status = 'completed' AND o.completed_at IS NOT NULL
      ORDER BY o.completed_at DESC, t.sort_order, t.created_at
    `).all() as JoinedRow[];
    return rows.map(toTaskListItem);
  }

  findOccurrenceItem(occurrenceId: string): TaskListItem | null {
    const row = this.database.prepare(`${JOINED_TASK_SELECT}
      WHERE o.id = ?
    `).get(occurrenceId) as JoinedRow | undefined;
    return row ? toTaskListItem(row) : null;
  }

  findRuntimeCandidate(taskId: string, date: string): TaskListItem | null {
    const row = this.database.prepare(`${JOINED_TASK_SELECT}
      WHERE t.id = ?
        AND t.enabled = 1
        AND t.archived_at IS NULL
        AND o.status <> 'completed'
        AND (
          (t.task_type = 'daily' AND o.occurrence_date = ?)
          OR t.task_type = 'one_time'
        )
      ORDER BY o.created_at
      LIMIT 1
    `).get(taskId, date) as JoinedRow | undefined;
    return row ? toTaskListItem(row) : null;
  }

  markOccurrenceActive(occurrenceId: string, updatedAt: string): boolean {
    return this.database.prepare(`
      UPDATE task_occurrences
      SET status = 'active', updated_at = ?
      WHERE id = ? AND status <> 'completed'
    `).run(updatedAt, occurrenceId).changes === 1;
  }

  checkpointOccurrence(
    occurrenceId: string,
    accumulatedSec: number,
    updatedAt: string
  ): boolean {
    return this.database.prepare(`
      UPDATE task_occurrences
      SET accumulated_sec = MAX(accumulated_sec, ?), updated_at = ?
      WHERE id = ? AND status = 'active'
    `).run(accumulatedSec, updatedAt, occurrenceId).changes === 1;
  }

  pauseOccurrence(
    occurrenceId: string,
    accumulatedSec: number,
    updatedAt: string
  ): boolean {
    return this.database.prepare(`
      UPDATE task_occurrences
      SET status = 'pending',
          accumulated_sec = MAX(accumulated_sec, ?),
          updated_at = ?
      WHERE id = ? AND status = 'active'
    `).run(accumulatedSec, updatedAt, occurrenceId).changes === 1;
  }

  completeDurationOccurrence(
    occurrenceId: string,
    accumulatedSec: number,
    completedAt: string
  ): boolean {
    return this.database.prepare(`
      UPDATE task_occurrences
      SET status = 'completed',
          accumulated_sec = MAX(accumulated_sec, ?),
          completed_at = ?,
          completion_source = 'duration',
          updated_at = ?
      WHERE id = ? AND status <> 'completed'
    `).run(accumulatedSec, completedAt, completedAt, occurrenceId).changes === 1;
  }

  resetActiveOccurrence(
    occurrenceId: string,
    accumulatedSec: number,
    updatedAt: string
  ): boolean {
    return this.pauseOccurrence(occurrenceId, accumulatedSec, updatedAt);
  }

  resetAllActiveOccurrences(updatedAt: string): number {
    return this.database.prepare(`
      UPDATE task_occurrences
      SET status = 'pending', updated_at = ?
      WHERE status = 'active'
    `).run(updatedAt).changes;
  }

  completeOccurrence(occurrenceId: string, completedAt: string): boolean {
    const result = this.database.prepare(`
      UPDATE task_occurrences
      SET status = 'completed',
          completed_at = ?,
          completion_source = 'manual',
          updated_at = ?
      WHERE id = ? AND status <> 'completed'
    `).run(completedAt, completedAt, occurrenceId);
    return result.changes === 1;
  }

  reopenOccurrence(occurrenceId: string, updatedAt: string): boolean {
    const result = this.database.prepare(`
      UPDATE task_occurrences
      SET status = 'pending',
          completed_at = NULL,
          completion_source = NULL,
          updated_at = ?
      WHERE id = ? AND status = 'completed'
    `).run(updatedAt, occurrenceId);
    return result.changes === 1;
  }

  countOccurrencesForTask(taskId: string): number {
    const row = this.database.prepare(`
      SELECT COUNT(*) AS count FROM task_occurrences WHERE task_id = ?
    `).get(taskId) as { count: number };
    return row.count;
  }
}

export class SettingsRepository {
  constructor(private readonly database: TaskDatabase) {}

  get(key: string): string | null {
    const row = this.database.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  }

  set(key: string, value: string): void {
    this.database.prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, value);
  }
}
