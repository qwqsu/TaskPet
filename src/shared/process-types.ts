import type { OccurrenceStatus, TaskCompletionMode } from "./task-types";

export type ProcessMatchMode = "exact_path" | "process_name";

export interface TaskProcessRule {
  id: string;
  taskId: string;
  platform: string;
  executableName: string | null;
  executablePath: string | null;
  bundleId: string | null;
  matchMode: ProcessMatchMode;
  createdAt: string;
}

export interface ProcessInfo {
  pid: number;
  executableName: string;
  executablePath: string | null;
}

export interface RunningProgram {
  executableName: string;
  executablePath: string | null;
  pidCount: number;
}

export interface ProcessSession {
  id: string;
  taskId: string;
  occurrenceId: string;
  executableName: string | null;
  executablePath: string | null;
  startedAt: string;
  lastSeenAt: string;
  endedAt: string | null;
  durationSec: number;
  finalized: boolean;
}

export interface RuntimeTaskSnapshot {
  taskId: string;
  occurrenceId: string;
  title: string;
  occurrenceStatus: OccurrenceStatus;
  completionMode: TaskCompletionMode;
  accumulatedSec: number;
  targetDurationSec: number;
  active: boolean;
}

export type TaskRuntimeEvent =
  | { type: "TASK_ACTIVE"; task: RuntimeTaskSnapshot }
  | { type: "TASK_PROGRESS"; task: RuntimeTaskSnapshot }
  | { type: "TASK_PAUSED"; task: RuntimeTaskSnapshot }
  | { type: "TASK_COMPLETED"; task: RuntimeTaskSnapshot }
  | { type: "TASK_REOPENED"; task: RuntimeTaskSnapshot };
