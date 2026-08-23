import type {
  RuntimeTaskSnapshot,
  TaskRuntimeEvent
} from "../../shared/process-types";
import type { TaskEventBus } from "./task-event-bus";

export type RuntimePetState = "idle" | "working" | "done";

export interface PetStateSink {
  setState(state: RuntimePetState, message: string): void;
}

export interface PetStateScheduler {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface PetStateMachineOptions {
  doneDurationMs?: number;
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
  private readonly activeTasks = new Map<string, RuntimeTaskSnapshot>();
  private readonly doneDurationMs: number;
  private readonly scheduler: PetStateScheduler;
  private readonly unsubscribe: () => void;
  private doneTimer: unknown = null;
  private showingDone = false;

  constructor(
    events: TaskEventBus,
    private readonly sink: PetStateSink,
    options: PetStateMachineOptions = {}
  ) {
    this.doneDurationMs = options.doneDurationMs ?? 2_500;
    this.scheduler = options.scheduler ?? defaultScheduler;
    this.unsubscribe = events.subscribe((event) => this.handleEvent(event));
  }

  dispose(): void {
    this.unsubscribe();
    if (this.doneTimer !== null) this.scheduler.clearTimeout(this.doneTimer);
    this.doneTimer = null;
    this.activeTasks.clear();
  }

  private handleEvent(event: TaskRuntimeEvent): void {
    if (event.type === "TASK_ACTIVE" || event.type === "TASK_PROGRESS") {
      this.activeTasks.delete(event.task.taskId);
      this.activeTasks.set(event.task.taskId, event.task);
      this.renderSteadyState();
      return;
    }

    if (event.type === "TASK_PAUSED") {
      this.activeTasks.delete(event.task.taskId);
      this.renderSteadyState();
      return;
    }

    if (event.type === "TASK_REOPENED") {
      this.renderSteadyState();
      return;
    }

    this.activeTasks.delete(event.task.taskId);
    this.showingDone = true;
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
    const active = [...this.activeTasks.values()].at(-1);
    if (!active) {
      this.sink.setState("idle", "");
      return;
    }
    this.sink.setState(
      "working",
      `${active.title} · ${formatRuntimeSeconds(active.accumulatedSec)}`
    );
  }
}
