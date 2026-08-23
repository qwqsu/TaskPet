export type TaskType = "daily" | "one_time";

export type TaskCompletionMode =
  | "manual"
  | "duration"
  | "process_start"
  | "process_exit";

export type P1CompletionMode = Extract<TaskCompletionMode, "manual" | "duration">;
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

export interface HistoryEntry extends TaskListItem {
  historyDate: string;
}

export interface HistoryDay {
  date: string;
  entries: HistoryEntry[];
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
