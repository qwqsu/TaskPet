/** 今日/本周实际任务运行时间统计；只读取 ProcessSession 与活动内存区间。 */
import type { TaskDatabase } from "../db/database";
import { ProcessSessionRepository } from "../db/process-session-repository";
import type { TaskClock } from "./task-service";
import type { TaskRuntimeInterval } from "../../shared/process-types";
import type {
  TimeStatsEntry,
  TimeStatsPeriod,
  TimeStatsSnapshot
} from "../../shared/task-types";

export interface ActiveIntervalSource {
  activeIntervals(now?: Date): TaskRuntimeInterval[];
}

export interface TimeStatsServiceOptions {
  clock?: TaskClock;
}

function periodBounds(now: Date, period: TimeStatsPeriod): { from: Date; to: Date } {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (period === "week") {
    // getDay(): Sunday=0；这里统一使用周一作为自然周起点。
    const daysSinceMonday = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - daysSinceMonday);
  }
  const end = new Date(start);
  end.setDate(end.getDate() + (period === "week" ? 7 : 1));
  end.setMilliseconds(-1);
  return { from: start, to: end };
}

function intersectedSeconds(
  interval: TaskRuntimeInterval,
  fromMs: number,
  toMs: number
): number {
  const startedMs = new Date(interval.startedAt).getTime();
  const endedMs = new Date(interval.endedAt).getTime();
  if (!Number.isFinite(startedMs) || !Number.isFinite(endedMs)) return 0;
  return Math.max(0, Math.floor(
    (Math.min(endedMs, toMs) - Math.max(startedMs, fromMs)) / 1_000
  ));
}

export class TimeStatsService {
  private readonly sessions: ProcessSessionRepository;
  private readonly clock: TaskClock;

  constructor(
    database: TaskDatabase,
    private readonly activeSource: ActiveIntervalSource,
    options: TimeStatsServiceOptions = {}
  ) {
    this.sessions = new ProcessSessionRepository(database);
    this.clock = options.clock ?? { now: () => new Date() };
  }

  get(period: TimeStatsPeriod): TimeStatsSnapshot {
    const now = this.clock.now();
    const { from, to } = periodBounds(now, period);
    const fromMs = from.getTime();
    // 展示完整自然日/自然周，但统计只能累计到现在，不能把未来区间算进去。
    const accumulationToMs = now.getTime();
    const fromIso = from.toISOString();
    const accumulationToIso = now.toISOString();
    const totals = new Map<string, TimeStatsEntry>();
    const intervals = [
      ...this.sessions.listFinalizedIntervals(fromIso, accumulationToIso),
      ...this.activeSource.activeIntervals(now)
    ];

    for (const interval of intervals) {
      const seconds = intersectedSeconds(interval, fromMs, accumulationToMs);
      if (seconds <= 0) continue;
      const entry = totals.get(interval.taskId) ?? {
        taskId: interval.taskId,
        title: interval.title,
        accumulatedSec: 0
      };
      entry.title = interval.title;
      entry.accumulatedSec += seconds;
      totals.set(interval.taskId, entry);
    }

    const entries = [...totals.values()].sort((left, right) => (
      right.accumulatedSec - left.accumulatedSec
      || left.title.localeCompare(right.title, "zh-CN")
    ));
    return {
      period,
      from: fromIso,
      to: to.toISOString(),
      totalSec: entries.reduce((sum, entry) => sum + entry.accumulatedSec, 0),
      entries
    };
  }
}
