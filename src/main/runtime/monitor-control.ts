/**
 * 用户主动暂停/恢复进程监控的协调层。
 * ProcessMonitor 和 RuntimeTracker 的核心算法保持不变，本类只管理启停边界。
 */
import type { RuntimeTaskSnapshot } from "../../shared/process-types";
import type { ProcessWatchTarget } from "../process/process-monitor";

export interface ControllableProcessMonitor {
  setTargets(targets: readonly ProcessWatchTarget[]): void;
}

export interface PausableRuntimeTracker {
  snapshots(now?: Date): RuntimeTaskSnapshot[];
  stopTask(taskId: string, stoppedAt?: Date): void;
}

export class MonitorControl {
  private targets: ProcessWatchTarget[] = [];
  private paused = false;

  constructor(
    private readonly monitor: ControllableProcessMonitor,
    private readonly runtime: PausableRuntimeTracker
  ) {}

  get isPaused(): boolean {
    return this.paused;
  }

  setTargets(targets: readonly ProcessWatchTarget[]): void {
    this.targets = targets.map((target) => ({
      taskId: target.taskId,
      rules: [...target.rules]
    }));
    this.monitor.setTargets(this.paused ? [] : this.targets);
  }

  setPaused(paused: boolean, changedAt = new Date()): boolean {
    if (this.paused === paused) return false;
    this.paused = paused;

    if (paused) {
      // 同一时刻收尾所有活跃 Session，避免逐项调用期间引入可见计时偏差。
      const activeTaskIds = this.runtime.snapshots(changedAt)
        .filter((snapshot) => snapshot.active)
        .map((snapshot) => snapshot.taskId);
      for (const taskId of activeTaskIds) {
        this.runtime.stopTask(taskId, changedAt);
      }
      this.monitor.setTargets([]);
      return true;
    }

    // ProcessMonitor 在重新得到非空 targets 时会立即扫描一次。
    this.monitor.setTargets(this.targets);
    return true;
  }
}

