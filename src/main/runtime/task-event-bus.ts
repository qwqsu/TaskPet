import type { TaskRuntimeEvent } from "../../shared/process-types";

export type TaskRuntimeEventListener = (event: TaskRuntimeEvent) => void;

export class TaskEventBus {
  private readonly listeners = new Set<TaskRuntimeEventListener>();

  emit(event: TaskRuntimeEvent): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch (error) {
        console.error("TaskPet runtime event listener failed", error);
      }
    }
  }

  subscribe(listener: TaskRuntimeEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
