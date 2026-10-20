/** 今日/本周实际任务运行时间统计；只读取 ProcessSession 与活动内存区间。 */
import type { TaskDatabase } from "../db/database";
import { ProcessSessionRepository } from "../db/process-session-repository";
import type { TaskClock } from "./task-service";
import type { TaskRuntimeInterval } from "../../shared/process-types";
import { toLocalDateKey } from "../../shared/local-date";
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
    return { period, from: from.toISOString(), to: to.toISOString(), ...this.summarize(from, new Date(to.getTime() + 1), now) };
  }

  /** 自然日采用半开区间，历史和今日/本周复用同一交集与秒级舍入口径。 */
  dailyTotals(fromDate: string, toDate: string): Map<string, number> {
    const parse = (key: string) => {
      const [year, month, day] = key.split("-").map(Number);
      return new Date(year!, month! - 1, day!);
    };
    const start = parse(fromDate);
    const end = parse(toDate);
    end.setDate(end.getDate() + 1);
    const now = this.clock.now();
    const intervals = this.intervals(start, end, now);
    const totals = new Map<string, number>();
    for (const day = new Date(start); day < end; day.setDate(day.getDate() + 1)) {
      const next = new Date(day);
      next.setDate(next.getDate() + 1);
      const seconds = intervals.reduce((sum, interval) => sum + intersectedSeconds(
        interval, day.getTime(), Math.min(next.getTime(), now.getTime())
      ), 0);
      if (seconds > 0) totals.set(toLocalDateKey(day), seconds);
    }
    return totals;
  }

  private intervals(from: Date, to: Date, now: Date): TaskRuntimeInterval[] {
    const until = new Date(Math.min(to.getTime(), now.getTime()));
    return [...this.sessions.listFinalizedIntervals(from.toISOString(), until.toISOString()),
      ...this.activeSource.activeIntervals(now)];
  }

  private summarize(from: Date, to: Date, now: Date): Pick<TimeStatsSnapshot, "entries" | "totalSec"> {
    const fromMs = from.getTime();
    const accumulationToMs = Math.min(to.getTime(), now.getTime());
    const totals = new Map<string, TimeStatsEntry>();
    const intervals = this.intervals(from, to, now);

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
      totalSec: entries.reduce((sum, entry) => sum + entry.accumulatedSec, 0),
      entries
    };
  }
}
