/**
 * 进程监控层的共享数据契约。
 * 此文件只定义 Main、preload 和 Renderer 之间传递的数据，不执行系统扫描。
 */
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

// 一次目标程序连续运行对应一条 Session，用于累计和崩溃恢复。
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

// RuntimeTracker 每秒生成轻量快照供桌宠和任务面板显示，不代表每秒写库。
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

// 事件总线把运行时变化与具体 UI 解耦。
export type TaskRuntimeEvent =
  | { type: "TASK_ACTIVE"; task: RuntimeTaskSnapshot }
  | { type: "TASK_PROGRESS"; task: RuntimeTaskSnapshot }
  | { type: "TASK_PAUSED"; task: RuntimeTaskSnapshot }
  | { type: "TASK_COMPLETED"; task: RuntimeTaskSnapshot }
  | { type: "TASK_REOPENED"; task: RuntimeTaskSnapshot };
