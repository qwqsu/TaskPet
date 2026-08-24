/**
 * Task / TaskOccurrence 的业务服务。
 * 负责 daily/one_time、lazy materialization、归档、手动完成/重开和历史分组。
 */
import { randomUUID } from "node:crypto";
import type { TaskDatabase } from "../db/database";
import { TaskRepository } from "../db/task-repository";
import {
  CreateTaskInputSchema,
  HistoryQuerySchema,
  UpdateTaskInputSchema,
  type CreateTaskInput,
  type HistoryQuery,
  type UpdateTaskPatch
} from "../../shared/task-schemas";
import { isLocalDateKey, localDateKeyFromIso, toLocalDateKey } from "../../shared/local-date";
import type {
  HistoryDay,
  HistoryEntry,
  OccurrenceMutationResult,
  Task,
  TaskApiErrorCode,
  TaskListItem
} from "../../shared/task-types";

export interface TaskClock {
  now(): Date;
}

export interface TaskServiceOptions {
  clock?: TaskClock;
  idFactory?: () => string;
}

export class TaskServiceError extends Error {
  constructor(
    readonly code: Extract<TaskApiErrorCode, "NOT_FOUND" | "CONFLICT">,
    message: string
  ) {
    super(message);
    this.name = "TaskServiceError";
  }
}

export class TaskService {
  private readonly repository: TaskRepository;
  private readonly clock: TaskClock;
  private readonly idFactory: () => string;

  constructor(database: TaskDatabase, options: TaskServiceOptions = {}) {
    this.repository = new TaskRepository(database);
    this.clock = options.clock ?? { now: () => new Date() };
    this.idFactory = options.idFactory ?? randomUUID;
  }

  createTask(input: CreateTaskInput): Task {
    const parsed = CreateTaskInputSchema.parse(input);
    const now = this.clock.now();
    const timestamp = now.toISOString();
    const occurrenceDate = toLocalDateKey(now);

    // 一次性任务立即创建唯一 occurrence；daily 等到当天首次读取时再创建。
    return this.repository.transaction(() => {
      const task = this.repository.insertTask({
        id: this.idFactory(),
        title: parsed.title,
        description: parsed.description,
        taskType: parsed.taskType,
        recurrenceRule: parsed.taskType === "daily"
          ? JSON.stringify({ frequency: "daily", interval: 1 })
          : null,
        completionMode: parsed.completionMode,
        targetDurationSec: parsed.targetDurationSec,
        enabled: true,
        archivedAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
        sortOrder: parsed.sortOrder ?? this.repository.nextSortOrder()
      });

      if (task.taskType === "one_time") {
        this.repository.insertOccurrenceIfMissing({
          id: this.idFactory(),
          taskId: task.id,
          occurrenceDate,
          status: "pending",
          accumulatedSec: 0,
          completedAt: null,
          completionSource: null,
          createdAt: timestamp,
          updatedAt: timestamp
        });
      }

      return task;
    });
  }

  updateTask(id: string, patch: UpdateTaskPatch): Task {
    const parsed = UpdateTaskInputSchema.parse({ id, patch });
    const task = this.requireTask(parsed.id);
    if (task.archivedAt) {
      throw new TaskServiceError("CONFLICT", "已归档任务不能再编辑");
    }

    // 切换完成方式时同步修正目标时长，避免 manual 携带无意义 duration。
    const nextCompletionMode = parsed.patch.completionMode ?? task.completionMode;
    let nextTargetDuration = parsed.patch.targetDurationSec ?? task.targetDurationSec;

    if (nextCompletionMode !== "duration") {
      if (parsed.patch.targetDurationSec !== undefined && parsed.patch.targetDurationSec !== 0) {
        throw new TaskServiceError("CONFLICT", "非时长任务的目标时长必须为 0");
      }
      nextTargetDuration = 0;
    } else if (nextCompletionMode === "duration" && nextTargetDuration <= 0) {
      throw new TaskServiceError("CONFLICT", "时长任务必须设置大于 0 的目标时长");
    }

    return this.repository.updateTask({
      ...task,
      title: parsed.patch.title ?? task.title,
      description: parsed.patch.description === undefined
        ? task.description
        : parsed.patch.description,
      completionMode: nextCompletionMode,
      targetDurationSec: nextTargetDuration,
      sortOrder: parsed.patch.sortOrder ?? task.sortOrder,
      updatedAt: this.clock.now().toISOString()
    });
  }

  archiveTask(id: string): Task {
    const task = this.requireTask(id);
    if (task.archivedAt) return task;
    return this.repository.archiveTask(id, this.clock.now().toISOString());
  }

  ensureTodayOccurrences(date = toLocalDateKey(this.clock.now())): number {
    if (!isLocalDateKey(date)) {
      throw new TypeError("Occurrence date must be a valid YYYY-MM-DD value");
    }

    const timestamp = this.clock.now().toISOString();
    // 可重复调用：Repository 的 UNIQUE + ON CONFLICT 会确保每天每任务只有一条。
    return this.repository.transaction(() => {
      let inserted = 0;
      for (const task of this.repository.listMaterializableDailyTasks()) {
        if (this.repository.insertOccurrenceIfMissing({
          id: this.idFactory(),
          taskId: task.id,
          occurrenceDate: date,
          status: "pending",
          accumulatedSec: 0,
          completedAt: null,
          completionSource: null,
          createdAt: timestamp,
          updatedAt: timestamp
        })) {
          inserted += 1;
        }
      }
      return inserted;
    });
  }

  getTodayTasks(): TaskListItem[] {
    const today = toLocalDateKey(this.clock.now());
    this.ensureTodayOccurrences(today);

    // 已完成的一次性任务只在完成当天继续显示，之后从“今日”隐藏但保留历史。
    return this.repository.listTodayCandidates(today).filter((item) => {
      if (item.task.taskType === "daily") return true;
      if (item.occurrence.status !== "completed") return true;
      return item.occurrence.completedAt !== null
        && localDateKeyFromIso(item.occurrence.completedAt) === today;
    });
  }

  getHistory(query: HistoryQuery): HistoryDay[] {
    const parsed = HistoryQuerySchema.parse(query);
    const groups = new Map<string, HistoryEntry[]>();

    for (const item of this.repository.listCompletedItems()) {
      if (!item.occurrence.completedAt) continue;
      // daily 按 occurrenceDate；one_time 按真正 completedAt 的本地日期归档。
      const historyDate = item.task.taskType === "daily"
        ? item.occurrence.occurrenceDate
        : localDateKeyFromIso(item.occurrence.completedAt);

      if (historyDate < parsed.fromDate || historyDate > parsed.toDate) continue;
      const entries = groups.get(historyDate) ?? [];
      entries.push({ ...item, historyDate });
      groups.set(historyDate, entries);
    }

    return [...groups.entries()]
      .sort(([left], [right]) => right.localeCompare(left))
      .map(([date, entries]) => ({ date, entries }));
  }

  completeOccurrence(occurrenceId: string): OccurrenceMutationResult {
    // changed 让 IPC 可以避免重复广播和重复播放 done 动画。
    return this.repository.transaction(() => {
      const before = this.requireEditableOccurrence(occurrenceId);
      if (before.occurrence.status === "completed") {
        return { item: before, changed: false };
      }

      const changed = this.repository.completeOccurrence(
        occurrenceId,
        this.clock.now().toISOString()
      );
      return { item: this.requireOccurrence(occurrenceId), changed };
    });
  }

  reopenOccurrence(occurrenceId: string): OccurrenceMutationResult {
    return this.repository.transaction(() => {
      const before = this.requireEditableOccurrence(occurrenceId);
      if (before.occurrence.status !== "completed") {
        return { item: before, changed: false };
      }

      const changed = this.repository.reopenOccurrence(
        occurrenceId,
        this.clock.now().toISOString()
      );
      return { item: this.requireOccurrence(occurrenceId), changed };
    });
  }

  countOccurrencesForTask(taskId: string): number {
    return this.repository.countOccurrencesForTask(taskId);
  }

  private requireTask(id: string): Task {
    const task = this.repository.findTask(id);
    if (!task) throw new TaskServiceError("NOT_FOUND", "任务不存在");
    return task;
  }

  private requireOccurrence(id: string): TaskListItem {
    const item = this.repository.findOccurrenceItem(id);
    if (!item) throw new TaskServiceError("NOT_FOUND", "任务实例不存在");
    return item;
  }

  private requireEditableOccurrence(id: string): TaskListItem {
    const item = this.requireOccurrence(id);
    if (!item.task.enabled || item.task.archivedAt) {
      throw new TaskServiceError("CONFLICT", "已归档或停用任务不能修改完成状态");
    }
    return item;
  }
}
