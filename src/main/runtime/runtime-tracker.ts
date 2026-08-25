/**
 * 任务运行时长核心。
 * 进程生命周期、内存 UI tick、SQLite checkpoint、跨 Session 累计和跨午夜都在这里协调。
 */
import { randomUUID } from "node:crypto";
import type { TaskDatabase } from "../db/database";
import { ProcessSessionRepository } from "../db/process-session-repository";
import { TaskRepository } from "../db/task-repository";
import type { TaskClock } from "../services/task-service";
import { toLocalDateKey } from "../../shared/local-date";
import type {
  ProcessInfo,
  ProcessSession,
  RuntimeTaskSnapshot,
  TaskRuntimeInterval
} from "../../shared/process-types";
import type { Task, TaskListItem, TaskOccurrence } from "../../shared/task-types";
import type { TaskEventBus } from "./task-event-bus";

interface ActiveRuntime {
  task: Task;
  occurrence: TaskOccurrence;
  session: ProcessSession;
  processInfo: ProcessInfo;
  // base 是本次 Session 开始前已累计的秒数，当前显示值 = base + 本次 wall-clock。
  baseAccumulatedSec: number;
  startedAtMs: number;
  suspectedExitAtMs: number | null;
}

export interface RuntimeTrackerScheduler {
  setInterval(callback: () => void, intervalMs: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface RuntimeTrackerOptions {
  clock?: TaskClock;
  idFactory?: () => string;
  scheduler?: RuntimeTrackerScheduler;
  uiTickMs?: number;
  checkpointMs?: number;
}

const defaultScheduler: RuntimeTrackerScheduler = {
  setInterval: (callback, intervalMs) => setInterval(callback, intervalMs),
  clearInterval: (handle) => clearInterval(handle as NodeJS.Timeout)
};

function elapsedSeconds(startedAtMs: number, endedAtMs: number): number {
  return Math.max(0, Math.floor((endedAtMs - startedAtMs) / 1_000));
}

function nextLocalMidnight(date: Date): Date {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + 1,
    0,
    0,
    0,
    0
  );
}

export class RuntimeTracker {
  readonly uiTickMs: number;
  readonly checkpointMs: number;
  private readonly tasks: TaskRepository;
  private readonly sessions: ProcessSessionRepository;
  private readonly clock: TaskClock;
  private readonly idFactory: () => string;
  private readonly scheduler: RuntimeTrackerScheduler;
  private readonly active = new Map<string, ActiveRuntime>();
  private uiTimer: unknown = null;
  private checkpointTimer: unknown = null;

  constructor(
    private readonly database: TaskDatabase,
    private readonly events: TaskEventBus,
    options: RuntimeTrackerOptions = {}
  ) {
    this.tasks = new TaskRepository(database);
    this.sessions = new ProcessSessionRepository(database);
    this.clock = options.clock ?? { now: () => new Date() };
    this.idFactory = options.idFactory ?? randomUUID;
    this.scheduler = options.scheduler ?? defaultScheduler;
    this.uiTickMs = options.uiTickMs ?? 1_000;
    this.checkpointMs = options.checkpointMs ?? 30_000;

    if (this.uiTickMs < 250) {
      throw new RangeError("Runtime UI tick must be at least 250 ms");
    }
    if (this.checkpointMs < 30_000 || this.checkpointMs > 60_000) {
      throw new RangeError("Runtime checkpoint must be between 30 and 60 seconds");
    }
  }

  get activeTaskCount(): number {
    return this.active.size;
  }

  get isTicking(): boolean {
    return this.uiTimer !== null;
  }

  recoverStaleSessions(): number {
    // 崩溃后只能可信地累计到最后一次 checkpoint 的 last_seen_at，不能算到重新启动时。
    const openSessions = this.sessions.listOpen();
    if (openSessions.length === 0) {
      this.tasks.resetAllActiveOccurrences(this.clock.now().toISOString());
      return 0;
    }

    this.database.transaction(() => {
      for (const session of openSessions) {
        const lastSeenMs = new Date(session.lastSeenAt).getTime();
        const startedMs = new Date(session.startedAt).getTime();
        const recoveredDuration = Math.max(
          session.durationSec,
          elapsedSeconds(startedMs, lastSeenMs)
        );
        this.sessions.finalize(session.id, session.lastSeenAt, recoveredDuration);

        const item = this.tasks.findOccurrenceItem(session.occurrenceId);
        if (item && item.occurrence.status !== "completed") {
          this.tasks.resetActiveOccurrence(
            session.occurrenceId,
            item.occurrence.accumulatedSec,
            session.lastSeenAt
          );
        }
      }
      this.tasks.resetAllActiveOccurrences(this.clock.now().toISOString());
    })();

    return openSessions.length;
  }

  startTask(taskId: string, processInfo: ProcessInfo, observedAt = this.clock.now()): boolean {
    const existing = this.active.get(taskId);
    if (existing) {
      this.seeTask(taskId, processInfo);
      return true;
    }

    const item = this.findOrCreateRuntimeCandidate(taskId, observedAt);
    if (!item) return false;
    if (item.task.completionMode === "process_start") {
      return this.completeProcessStart(item, observedAt);
    }
    const timestamp = observedAt.toISOString();
    let session: ProcessSession | null = null;

    // occurrence 进入 active 与创建 open Session 必须原子完成。
    this.database.transaction(() => {
      if (!this.tasks.markOccurrenceActive(item.occurrence.id, timestamp)) return;
      session = this.sessions.insert({
        id: this.idFactory(),
        taskId: item.task.id,
        occurrenceId: item.occurrence.id,
        executableName: processInfo.executableName,
        executablePath: processInfo.executablePath,
        startedAt: timestamp,
        lastSeenAt: timestamp,
        endedAt: null,
        durationSec: 0,
        finalized: false
      });
    })();
    if (!session) return false;

    const active: ActiveRuntime = {
      task: item.task,
      occurrence: { ...item.occurrence, status: "active", updatedAt: timestamp },
      session,
      processInfo,
      baseAccumulatedSec: item.occurrence.accumulatedSec,
      startedAtMs: observedAt.getTime(),
      suspectedExitAtMs: null
    };
    this.active.set(taskId, active);
    this.ensureTimers();
    this.events.emit({ type: "TASK_ACTIVE", task: this.snapshot(active, observedAt.getTime()) });
    this.advanceTaskTo(taskId, observedAt.getTime());
    return true;
  }

  seeTask(taskId: string, processInfo: ProcessInfo): void {
    const active = this.active.get(taskId);
    if (!active) return;
    active.processInfo = processInfo;
    active.suspectedExitAtMs = null;
  }

  suspectTaskExit(taskId: string, missingSince: Date): void {
    const active = this.active.get(taskId);
    if (!active || active.suspectedExitAtMs !== null) return;
    active.suspectedExitAtMs = Math.max(active.startedAtMs, missingSince.getTime());
  }

  stopTask(taskId: string, stoppedAt = this.clock.now()): void {
    this.advanceTaskTo(taskId, stoppedAt.getTime());
    const active = this.active.get(taskId);
    if (!active) return;
    this.finalizeIncomplete(active, stoppedAt.getTime());
  }

  stopOccurrence(occurrenceId: string, stoppedAt = this.clock.now()): void {
    const active = [...this.active.values()].find(
      (runtime) => runtime.occurrence.id === occurrenceId
    );
    if (active) this.stopTask(active.task.id, stoppedAt);
  }

  tick(now = this.clock.now()): void {
    // 高频 tick 只更新内存快照和 UI 事件，不在这里写 SQLite。
    const nowMs = now.getTime();
    for (const taskId of [...this.active.keys()]) {
      this.advanceTaskTo(taskId, nowMs);
      const active = this.active.get(taskId);
      if (active) {
        this.events.emit({ type: "TASK_PROGRESS", task: this.snapshot(active, nowMs) });
      }
    }
  }

  checkpoint(now = this.clock.now()): void {
    // 低频 checkpoint 才把 Session last_seen_at 和累计时间写入数据库。
    const nowMs = now.getTime();
    for (const taskId of [...this.active.keys()]) {
      this.advanceTaskTo(taskId, nowMs);
      const active = this.active.get(taskId);
      if (active) this.persistCheckpoint(active, nowMs);
    }
  }

  snapshots(now = this.clock.now()): RuntimeTaskSnapshot[] {
    const nowMs = now.getTime();
    return [...this.active.values()].map((active) => this.snapshot(active, nowMs));
  }

  activeIntervals(now = this.clock.now()): TaskRuntimeInterval[] {
    const nowMs = now.getTime();
    return [...this.active.values()].map((active) => ({
      taskId: active.task.id,
      title: active.task.title,
      startedAt: new Date(active.startedAtMs).toISOString(),
      endedAt: new Date(Math.max(
        active.startedAtMs,
        Math.min(nowMs, active.suspectedExitAtMs ?? Number.POSITIVE_INFINITY)
      )).toISOString()
    }));
  }

  announceManualCompletion(item: TaskListItem): void {
    this.events.emit({
      type: "TASK_COMPLETED",
      task: this.itemSnapshot(item, false)
    });
  }

  announceReopened(item: TaskListItem): void {
    this.events.emit({
      type: "TASK_REOPENED",
      task: this.itemSnapshot(item, false)
    });
  }

  shutdown(now = this.clock.now()): void {
    for (const taskId of [...this.active.keys()]) this.stopTask(taskId, now);
    this.stopTimers();
  }

  private findOrCreateRuntimeCandidate(taskId: string, observedAt: Date): TaskListItem | null {
    // 程序可能跨午夜保持运行，因此这里也能为新一天 lazy materialize occurrence。
    const occurrenceDate = toLocalDateKey(observedAt);
    const existing = this.tasks.findRuntimeCandidate(taskId, occurrenceDate);
    if (existing) return existing;

    const task = this.tasks.findTask(taskId);
    if (!task || task.taskType !== "daily" || !task.enabled || task.archivedAt) return null;
    const timestamp = observedAt.toISOString();
    this.tasks.insertOccurrenceIfMissing({
      id: this.idFactory(),
      taskId,
      occurrenceDate,
      status: "pending",
      accumulatedSec: 0,
      completedAt: null,
      completionSource: null,
      createdAt: timestamp,
      updatedAt: timestamp
    });
    return this.tasks.findRuntimeCandidate(taskId, occurrenceDate);
  }

  private completeProcessStart(item: TaskListItem, observedAt: Date): boolean {
    const completedAt = observedAt.toISOString();
    const changed = this.tasks.completeProcessStartOccurrence(
      item.occurrence.id,
      completedAt
    );
    if (!changed) return false;
    const completed = this.tasks.findOccurrenceItem(item.occurrence.id);
    if (!completed) return false;
    this.events.emit({
      type: "TASK_COMPLETED",
      task: this.itemSnapshot(completed, false)
    });
    return true;
  }

  private advanceTaskTo(taskId: string, requestedMs: number): void {
    // 在同一次推进中比较“达到目标”和“本地午夜”两个边界，先到者先处理。
    let active = this.active.get(taskId);
    while (active) {
      const limitMs = Math.max(
        active.startedAtMs,
        Math.min(requestedMs, active.suspectedExitAtMs ?? Number.POSITIVE_INFINITY)
      );
      const midnightMs = active.task.taskType === "daily"
        ? nextLocalMidnight(new Date(active.startedAtMs)).getTime()
        : Number.POSITIVE_INFINITY;
      const completionMs = this.completionTime(active);

      if (completionMs !== null && completionMs <= Math.min(limitMs, midnightMs)) {
        this.completeDuration(active, completionMs);
        return;
      }

      if (midnightMs <= limitMs) {
        this.rolloverDaily(active, midnightMs);
        active = this.active.get(taskId);
        continue;
      }
      return;
    }
  }

  private completionTime(active: ActiveRuntime): number | null {
    if (active.task.completionMode !== "duration" || active.task.targetDurationSec <= 0) {
      return null;
    }
    const remaining = active.task.targetDurationSec - active.baseAccumulatedSec;
    return active.startedAtMs + Math.max(0, remaining) * 1_000;
  }

  private completeDuration(active: ActiveRuntime, completedMs: number): void {
    const completedAt = new Date(completedMs).toISOString();
    const sessionDuration = elapsedSeconds(active.startedAtMs, completedMs);
    const accumulatedSec = Math.max(
      active.task.targetDurationSec,
      active.baseAccumulatedSec + sessionDuration
    );
    let changed = false;

    // Session 收尾和 occurrence 完成同事务提交，避免只完成其中一半。
    this.database.transaction(() => {
      this.sessions.finalize(active.session.id, completedAt, sessionDuration);
      changed = this.tasks.completeDurationOccurrence(
        active.occurrence.id,
        accumulatedSec,
        completedAt
      );
    })();
    this.active.delete(active.task.id);
    this.stopTimersIfIdle();

    if (changed) {
      this.events.emit({
        type: "TASK_COMPLETED",
        task: {
          ...this.snapshot(active, completedMs),
          occurrenceStatus: "completed",
          accumulatedSec,
          active: false
        }
      });
    }
  }

  private finalizeIncomplete(active: ActiveRuntime, stoppedMs: number): void {
    // confirmed exit 使用第一次消失时间，防抖等待本身不计入运行时长。
    const effectiveStoppedMs = Math.max(
      active.startedAtMs,
      Math.min(stoppedMs, active.suspectedExitAtMs ?? Number.POSITIVE_INFINITY)
    );
    const endedAt = new Date(effectiveStoppedMs).toISOString();
    const sessionDuration = elapsedSeconds(active.startedAtMs, effectiveStoppedMs);
    const accumulatedSec = active.baseAccumulatedSec + sessionDuration;

    this.database.transaction(() => {
      this.sessions.finalize(active.session.id, endedAt, sessionDuration);
      this.tasks.pauseOccurrence(active.occurrence.id, accumulatedSec, endedAt);
    })();
    this.active.delete(active.task.id);
    this.stopTimersIfIdle();
    this.events.emit({
      type: "TASK_PAUSED",
      task: {
        ...this.snapshot(active, effectiveStoppedMs),
        occurrenceStatus: "pending",
        accumulatedSec,
        active: false
      }
    });
  }

  private rolloverDaily(active: ActiveRuntime, midnightMs: number): void {
    // daily 任务在本地 00:00 切成旧日 Session 和新日 Session；进程无需重新启动。
    const boundary = new Date(midnightMs);
    const timestamp = boundary.toISOString();
    const oldSessionDuration = elapsedSeconds(active.startedAtMs, midnightMs);
    const oldAccumulated = active.baseAccumulatedSec + oldSessionDuration;
    const rollover = this.database.transaction((): {
      item: TaskListItem;
      session: ProcessSession;
    } | null => {
      this.sessions.finalize(active.session.id, timestamp, oldSessionDuration);
      this.tasks.pauseOccurrence(active.occurrence.id, oldAccumulated, timestamp);
      this.tasks.insertOccurrenceIfMissing({
        id: this.idFactory(),
        taskId: active.task.id,
        occurrenceDate: toLocalDateKey(boundary),
        status: "pending",
        accumulatedSec: 0,
        completedAt: null,
        completionSource: null,
        createdAt: timestamp,
        updatedAt: timestamp
      });
      const nextItem = this.tasks.findRuntimeCandidate(
        active.task.id,
        toLocalDateKey(boundary)
      );
      if (!nextItem) return null;
      if (!this.tasks.markOccurrenceActive(nextItem.occurrence.id, timestamp)) {
        return null;
      }
      const nextSession = this.sessions.insert({
        id: this.idFactory(),
        taskId: active.task.id,
        occurrenceId: nextItem.occurrence.id,
        executableName: active.processInfo.executableName,
        executablePath: active.processInfo.executablePath,
        startedAt: timestamp,
        lastSeenAt: timestamp,
        endedAt: null,
        durationSec: 0,
        finalized: false
      });
      return { item: nextItem, session: nextSession };
    })();

    if (!rollover) {
      this.active.delete(active.task.id);
      this.stopTimersIfIdle();
      this.events.emit({
        type: "TASK_PAUSED",
        task: {
          ...this.snapshot(active, midnightMs),
          occurrenceStatus: "pending",
          accumulatedSec: oldAccumulated,
          active: false
        }
      });
      return;
    }

    const { item: nextItem, session: nextSession } = rollover;

    const nextActive: ActiveRuntime = {
      task: nextItem.task,
      occurrence: { ...nextItem.occurrence, status: "active", updatedAt: timestamp },
      session: nextSession,
      processInfo: active.processInfo,
      baseAccumulatedSec: nextItem.occurrence.accumulatedSec,
      startedAtMs: midnightMs,
      suspectedExitAtMs: active.suspectedExitAtMs
    };
    this.active.set(active.task.id, nextActive);
    this.events.emit({ type: "TASK_ACTIVE", task: this.snapshot(nextActive, midnightMs) });
  }

  private persistCheckpoint(active: ActiveRuntime, requestedMs: number): void {
    const checkpointMs = Math.max(
      active.startedAtMs,
      Math.min(requestedMs, active.suspectedExitAtMs ?? Number.POSITIVE_INFINITY)
    );
    const timestamp = new Date(checkpointMs).toISOString();
    const sessionDuration = elapsedSeconds(active.startedAtMs, checkpointMs);
    const accumulatedSec = active.baseAccumulatedSec + sessionDuration;
    this.database.transaction(() => {
      this.sessions.checkpoint(active.session.id, timestamp, sessionDuration);
      this.tasks.checkpointOccurrence(active.occurrence.id, accumulatedSec, timestamp);
    })();
  }

  private snapshot(active: ActiveRuntime, requestedMs: number): RuntimeTaskSnapshot {
    const effectiveMs = Math.max(
      active.startedAtMs,
      Math.min(requestedMs, active.suspectedExitAtMs ?? Number.POSITIVE_INFINITY)
    );
    return {
      taskId: active.task.id,
      occurrenceId: active.occurrence.id,
      title: active.task.title,
      occurrenceStatus: "active",
      completionMode: active.task.completionMode,
      accumulatedSec: active.baseAccumulatedSec + elapsedSeconds(active.startedAtMs, effectiveMs),
      targetDurationSec: active.task.targetDurationSec,
      active: true
    };
  }

  private itemSnapshot(item: TaskListItem, active: boolean): RuntimeTaskSnapshot {
    return {
      taskId: item.task.id,
      occurrenceId: item.occurrence.id,
      title: item.task.title,
      occurrenceStatus: item.occurrence.status,
      completionMode: item.task.completionMode,
      accumulatedSec: item.occurrence.accumulatedSec,
      targetDurationSec: item.task.targetDurationSec,
      active
    };
  }

  private ensureTimers(): void {
    // UI 刷新和持久化频率分开，且只有至少一个 active task 时运行。
    if (this.uiTimer === null) {
      this.uiTimer = this.scheduler.setInterval(() => this.tick(), this.uiTickMs);
    }
    if (this.checkpointTimer === null) {
      this.checkpointTimer = this.scheduler.setInterval(
        () => this.checkpoint(),
        this.checkpointMs
      );
    }
  }

  private stopTimersIfIdle(): void {
    if (this.active.size === 0) this.stopTimers();
  }

  private stopTimers(): void {
    if (this.uiTimer !== null) this.scheduler.clearInterval(this.uiTimer);
    if (this.checkpointTimer !== null) this.scheduler.clearInterval(this.checkpointTimer);
    this.uiTimer = null;
    this.checkpointTimer = null;
  }
}
