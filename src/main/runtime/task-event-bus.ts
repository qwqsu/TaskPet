/**
 * Main Process 内的轻量同步事件总线。
 * RuntimeTracker 发事件，桌宠状态机和 TaskSystem 各自订阅，彼此不直接依赖。
 */
import type { TaskRuntimeEvent } from "../../shared/process-types";

export type TaskRuntimeEventListener = (event: TaskRuntimeEvent) => void;

export class TaskEventBus {
  private readonly listeners = new Set<TaskRuntimeEventListener>();

  emit(event: TaskRuntimeEvent): void {
    // 拷贝 Set，允许 listener 在回调中取消订阅而不破坏本轮遍历。
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
