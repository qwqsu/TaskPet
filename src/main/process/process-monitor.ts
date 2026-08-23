/**
 * 低频进程监控器。
 * 它只负责“扫描 + 匹配 + 生命周期回调”，Session 和累计时长由 RuntimeTracker 管理。
 */
import type { ProcessInfo, TaskProcessRule } from "../../shared/process-types";
import { matchProcessesForRules } from "./process-matcher";
import type { ProcessProvider } from "./process-provider";

export interface ProcessWatchTarget {
  taskId: string;
  rules: readonly TaskProcessRule[];
}

export interface ProcessMonitorCallbacks {
  onStarted(taskId: string, processInfo: ProcessInfo, observedAt: Date): boolean | void;
  onSeen(taskId: string, processInfo: ProcessInfo, observedAt: Date): void;
  onSuspectedExit(taskId: string, missingSince: Date): void;
  onStopped(taskId: string, stoppedAt: Date): void;
  onError?(error: unknown): void;
}

export interface ProcessMonitorScheduler {
  setInterval(callback: () => void, intervalMs: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface ProcessMonitorOptions {
  scanIntervalMs?: number;
  exitDebounceMs?: number;
  now?: () => Date;
  scheduler?: ProcessMonitorScheduler;
  scanImmediately?: boolean;
}

const defaultScheduler: ProcessMonitorScheduler = {
  setInterval: (callback, intervalMs) => setInterval(callback, intervalMs),
  clearInterval: (handle) => clearInterval(handle as NodeJS.Timeout)
};

export class ProcessMonitor {
  readonly scanIntervalMs: number;
  readonly exitDebounceMs: number;
  private readonly now: () => Date;
  private readonly scheduler: ProcessMonitorScheduler;
  private readonly scanImmediately: boolean;
  // 三张内存表分别表示监控目标、已匹配任务和第一次疑似退出时间，不会持久化完整进程快照。
  private readonly targets = new Map<string, ProcessWatchTarget>();
  private readonly running = new Map<string, ProcessInfo>();
  private readonly missingSince = new Map<string, Date>();
  private intervalHandle: unknown = null;
  private scanInFlight = false;

  constructor(
    private readonly provider: ProcessProvider,
    private readonly callbacks: ProcessMonitorCallbacks,
    options: ProcessMonitorOptions = {}
  ) {
    this.scanIntervalMs = options.scanIntervalMs ?? 2_500;
    this.exitDebounceMs = options.exitDebounceMs ?? 4_000;
    this.now = options.now ?? (() => new Date());
    this.scheduler = options.scheduler ?? defaultScheduler;
    this.scanImmediately = options.scanImmediately ?? true;

    if (this.scanIntervalMs < 1_000) {
      throw new RangeError("Process scan interval must be at least 1000 ms");
    }
    if (this.exitDebounceMs < 3_000 || this.exitDebounceMs > 5_000) {
      throw new RangeError("Process exit debounce must be between 3000 and 5000 ms");
    }
  }

  get isRunning(): boolean {
    return this.intervalHandle !== null;
  }

  get watchedTaskCount(): number {
    return this.targets.size;
  }

  setTargets(targets: readonly ProcessWatchTarget[]): void {
    const nextIds = new Set(targets.map((target) => target.taskId));
    for (const taskId of this.targets.keys()) {
      if (nextIds.has(taskId)) continue;
      this.running.delete(taskId);
      this.missingSince.delete(taskId);
    }

    this.targets.clear();
    for (const target of targets) {
      if (target.rules.length > 0) this.targets.set(target.taskId, target);
    }

    // 没有“未完成 + 已绑定程序”的任务时立即停表，降低常驻开销。
    if (this.targets.size === 0) {
      this.stopTimer();
      this.running.clear();
      this.missingSince.clear();
      return;
    }

    this.startTimer();
  }

  async scanNow(observedAt = this.now()): Promise<void> {
    // 防止一次异步扫描尚未结束时启动第二次重叠扫描。
    if (this.targets.size === 0 || this.scanInFlight) return;
    this.scanInFlight = true;

    try {
      const processes = await this.provider.listProcesses();
      this.applySnapshot(processes, observedAt);
    } catch (error) {
      this.callbacks.onError?.(error);
    } finally {
      this.scanInFlight = false;
    }
  }

  forgetTask(taskId: string): void {
    this.running.delete(taskId);
    this.missingSince.delete(taskId);
  }

  close(): void {
    this.stopTimer();
    this.targets.clear();
    this.running.clear();
    this.missingSince.clear();
  }

  private applySnapshot(processes: readonly ProcessInfo[], observedAt: Date): void {
    for (const target of this.targets.values()) {
      const matches = matchProcessesForRules(processes, target.rules);
      const matchedProcess = matches[0];

      if (matchedProcess) {
        const wasRunning = this.running.has(target.taskId);
        this.missingSince.delete(target.taskId);
        if (wasRunning) {
          this.running.set(target.taskId, matchedProcess);
          this.callbacks.onSeen(target.taskId, matchedProcess, observedAt);
        } else {
          const accepted = this.callbacks.onStarted(
            target.taskId,
            matchedProcess,
            observedAt
          );
          if (accepted === false) continue;
          this.running.set(target.taskId, matchedProcess);
        }
        continue;
      }

      if (!this.running.has(target.taskId)) continue;
      const missingAt = this.missingSince.get(target.taskId);
      if (!missingAt) {
        // 第一次消失只冻结计时并进入 suspected_exit，不立刻结束 Session。
        const firstMissingAt = new Date(observedAt.getTime());
        this.missingSince.set(target.taskId, firstMissingAt);
        this.callbacks.onSuspectedExit(target.taskId, firstMissingAt);
        continue;
      }

      // 防抖期内重新出现仍算同一次连续运行；超过阈值才确认停止。
      if (observedAt.getTime() - missingAt.getTime() < this.exitDebounceMs) continue;
      this.callbacks.onStopped(target.taskId, new Date(missingAt.getTime()));
      this.running.delete(target.taskId);
      this.missingSince.delete(target.taskId);
    }
  }

  private startTimer(): void {
    if (this.intervalHandle !== null) return;
    this.intervalHandle = this.scheduler.setInterval(() => {
      void this.scanNow();
    }, this.scanIntervalMs);
    if (this.scanImmediately) void this.scanNow();
  }

  private stopTimer(): void {
    if (this.intervalHandle === null) return;
    this.scheduler.clearInterval(this.intervalHandle);
    this.intervalHandle = null;
  }
}
