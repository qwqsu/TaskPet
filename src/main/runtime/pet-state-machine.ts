/**
 * 把任务运行事件转换成桌宠的 idle / working / done 状态。
 * 多个 active 任务按固定间隔轮播；done 临时覆盖 working，播放结束后再恢复。
 */
import type {
  RuntimeTaskSnapshot,
  TaskRuntimeEvent
} from "../../shared/process-types";
import type { TaskEventBus } from "./task-event-bus";

export type RuntimePetState = "idle" | "working" | "done";

export interface PetStateSink {
  setState(state: RuntimePetState, message: string, detail?: string): void;
}

export interface PetStateScheduler {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface PetStateMachineOptions {
  doneDurationMs?: number;
  taskRotationMs?: number;
  scheduler?: PetStateScheduler;
}

const defaultScheduler: PetStateScheduler = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout)
};

export function formatRuntimeSeconds(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safeSeconds / 3_600);
  const minutes = Math.floor((safeSeconds % 3_600) / 60);
  const remainingSeconds = safeSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

export class PetStateMachine {
  // Map 的插入顺序就是轮播顺序；TASK_PROGRESS 更新已有 key 时不会改变顺序。
  private readonly activeTasks = new Map<string, RuntimeTaskSnapshot>();
  private readonly doneDurationMs: number;
  private readonly taskRotationMs: number;
  private readonly scheduler: PetStateScheduler;
  private readonly unsubscribe: () => void;
  private doneTimer: unknown = null;
  private rotationTimer: unknown = null;
  private visibleTaskId: string | null = null;
  private showingDone = false;

  constructor(
    events: TaskEventBus,
    private readonly sink: PetStateSink,
    options: PetStateMachineOptions = {}
  ) {
    this.doneDurationMs = options.doneDurationMs ?? 2_500;
    this.taskRotationMs = options.taskRotationMs ?? 3_000;
    this.scheduler = options.scheduler ?? defaultScheduler;
    this.unsubscribe = events.subscribe((event) => this.handleEvent(event));
  }

  dispose(): void {
    this.unsubscribe();
    if (this.doneTimer !== null) this.scheduler.clearTimeout(this.doneTimer);
    this.clearRotationTimer();
    this.doneTimer = null;
    this.visibleTaskId = null;
    this.activeTasks.clear();
  }

  private handleEvent(event: TaskRuntimeEvent): void {
    if (event.type === "TASK_ACTIVE" || event.type === "TASK_PROGRESS") {
      this.activeTasks.set(event.task.taskId, event.task);
      this.visibleTaskId ??= event.task.taskId;
      this.renderSteadyState();
      return;
    }

    if (event.type === "TASK_PAUSED") {
      this.removeActiveTask(event.task.taskId);
      this.renderSteadyState();
      return;
    }

    if (event.type === "TASK_REOPENED") {
      this.renderSteadyState();
      return;
    }

    // 走到这里的事件是 TASK_COMPLETED；完成态拥有短暂显示优先级。
    this.removeActiveTask(event.task.taskId);
    this.showingDone = true;
    this.clearRotationTimer();
    if (this.doneTimer !== null) this.scheduler.clearTimeout(this.doneTimer);
    this.sink.setState("done", `已完成：${event.task.title}`);
    this.doneTimer = this.scheduler.setTimeout(() => {
      this.doneTimer = null;
      this.showingDone = false;
      this.renderSteadyState();
    }, this.doneDurationMs);
  }

  private renderSteadyState(): void {
    if (this.showingDone) return;
    if (this.visibleTaskId === null || !this.activeTasks.has(this.visibleTaskId)) {
      this.visibleTaskId = this.activeTasks.keys().next().value ?? null;
    }
    const active = this.visibleTaskId === null
      ? undefined
      : this.activeTasks.get(this.visibleTaskId);
    if (!active) {
      this.visibleTaskId = null;
      this.clearRotationTimer();
      this.sink.setState("idle", "");
      return;
    }
    // message 与 detail 分开传递，长任务名被省略时不会挤掉计时。
    this.sink.setState(
      "working",
      active.title,
      formatRuntimeSeconds(active.accumulatedSec)
    );
    this.scheduleRotation();
  }

  private removeActiveTask(taskId: string): void {
    const taskIds = [...this.activeTasks.keys()];
    const removedIndex = taskIds.indexOf(taskId);
    const removedVisibleTask = this.visibleTaskId === taskId;
    this.activeTasks.delete(taskId);

    if (!removedVisibleTask) return;
    const remainingTaskIds = [...this.activeTasks.keys()];
    this.visibleTaskId = remainingTaskIds.length === 0
      ? null
      : remainingTaskIds[Math.max(removedIndex, 0) % remainingTaskIds.length] ?? null;
    this.clearRotationTimer();
  }

  private scheduleRotation(): void {
    // 单任务无需额外 timer；进度事件也不会重置已经存在的 3 秒 timer。
    if (this.showingDone || this.activeTasks.size < 2) {
      this.clearRotationTimer();
      return;
    }
    if (this.rotationTimer !== null) return;

    this.rotationTimer = this.scheduler.setTimeout(() => {
      this.rotationTimer = null;
      this.rotateVisibleTask();
    }, this.taskRotationMs);
  }

  private rotateVisibleTask(): void {
    if (this.showingDone || this.activeTasks.size < 2) {
      this.renderSteadyState();
      return;
    }

    const taskIds = [...this.activeTasks.keys()];
    const currentIndex = this.visibleTaskId === null
      ? -1
      : taskIds.indexOf(this.visibleTaskId);
    this.visibleTaskId = taskIds[(currentIndex + 1) % taskIds.length] ?? null;
    this.renderSteadyState();
  }

  private clearRotationTimer(): void {
    if (this.rotationTimer !== null) {
      this.scheduler.clearTimeout(this.rotationTimer);
      this.rotationTimer = null;
    }
  }
}
