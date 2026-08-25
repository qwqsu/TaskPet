/**
 * TaskPet 的核心领域模型。
 * Task 保存长期规则；TaskOccurrence 保存某一天/某一次的实际执行与完成记录。
 */
export type TaskType = "daily" | "one_time";

export type TaskCompletionMode =
  | "manual"
  | "duration"
  | "process_start"
  | "process_exit";

export type OccurrenceStatus = "pending" | "active" | "completed";
export type CompletionSource = TaskCompletionMode | null;

export interface Task {
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

export interface TaskOccurrence {
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

export interface TaskListItem {
  task: Task;
  occurrence: TaskOccurrence;
}

// 历史记录额外提供用于页面分组的本地日期。
export interface HistoryEntry extends TaskListItem {
  historyDate: string;
}

export interface HistoryDay {
  date: string;
  entries: HistoryEntry[];
}

export type TimeStatsPeriod = "today" | "week";

export interface TimeStatsEntry {
  taskId: string;
  title: string;
  accumulatedSec: number;
}

export interface TimeStatsSnapshot {
  period: TimeStatsPeriod;
  from: string;
  to: string;
  totalSec: number;
  entries: TimeStatsEntry[];
}

export interface OccurrenceMutationResult {
  item: TaskListItem;
  changed: boolean;
}

export type TaskApiErrorCode =
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INTERNAL_ERROR";

export type TaskApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: TaskApiErrorCode; message: string } };
