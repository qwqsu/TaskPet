import test from "node:test";
import assert from "node:assert/strict";
import {
  RuntimeTracker,
  type RuntimeTrackerScheduler
} from "../src/main/runtime/runtime-tracker";
import { TaskEventBus } from "../src/main/runtime/task-event-bus";
import { TimeStatsService } from "../src/main/services/time-stats-service";
import type { ProcessInfo } from "../src/shared/process-types";
import { createTaskHarness } from "./task-test-helpers";

class NoopScheduler implements RuntimeTrackerScheduler {
  setInterval(): object { return {}; }
  clearInterval(): void {}
}

const processInfo: ProcessInfo = {
  pid: 7,
  executableName: "Study.exe",
  executablePath: "C:\\Study\\Study.exe"
};

function at(day: number, hour: number, minute = 0): Date {
  return new Date(2026, 7, day, hour, minute, 0);
}

test("today and week stats intersect real sessions and sort by accumulated time", () => {
  const harness = createTaskHarness(at(24, 8));
  try {
    const taskA = harness.service.createTask({
      title: "写代码",
      taskType: "one_time",
      completionMode: "manual",
      targetDurationSec: 0
    });
    const taskB = harness.service.createTask({
      title: "背单词",
      taskType: "one_time",
      completionMode: "manual",
      targetDurationSec: 0
    });
    const tracker = new RuntimeTracker(harness.database, new TaskEventBus(), {
      clock: harness.clock,
      scheduler: new NoopScheduler()
    });

    tracker.startTask(taskA.id, processInfo, at(24, 10));
    tracker.stopTask(taskA.id, at(24, 10, 30));
    tracker.startTask(taskA.id, processInfo, at(26, 9));
    tracker.stopTask(taskA.id, at(26, 10));

    tracker.startTask(taskB.id, processInfo, at(25, 23, 50));
    tracker.stopTask(taskB.id, at(26, 0, 10));
    tracker.startTask(taskB.id, processInfo, at(26, 11));
    tracker.stopTask(taskB.id, at(26, 11, 45));
    tracker.startTask(taskB.id, processInfo, at(26, 11, 50));

    harness.clock.set(at(26, 12));
    const stats = new TimeStatsService(harness.database, tracker, {
      clock: harness.clock
    });
    const today = stats.get("today");
    const todayFrom = new Date(today.from);
    const todayTo = new Date(today.to);
    assert.deepEqual(
      [todayFrom.getDate(), todayFrom.getHours(), todayFrom.getMinutes()],
      [26, 0, 0]
    );
    assert.deepEqual(
      [todayTo.getDate(), todayTo.getHours(), todayTo.getMinutes(), todayTo.getSeconds()],
      [26, 23, 59, 59]
    );
    assert.equal(today.totalSec, 7_500);
    assert.deepEqual(today.entries.map((entry) => [entry.title, entry.accumulatedSec]), [
      ["背单词", 3_900],
      ["写代码", 3_600]
    ]);

    const week = stats.get("week");
    const weekFrom = new Date(week.from);
    const weekTo = new Date(week.to);
    assert.deepEqual(
      [weekFrom.getMonth() + 1, weekFrom.getDate(), weekFrom.getDay(), weekFrom.getHours(), weekFrom.getMinutes()],
      [8, 24, 1, 0, 0]
    );
    assert.deepEqual(
      [weekTo.getMonth() + 1, weekTo.getDate(), weekTo.getDay(), weekTo.getHours(), weekTo.getMinutes(), weekTo.getSeconds()],
      [8, 30, 0, 23, 59, 59]
    );
    assert.equal(week.totalSec, 9_900);
    assert.deepEqual(week.entries.map((entry) => [entry.title, entry.accumulatedSec]), [
      ["写代码", 5_400],
      ["背单词", 4_500]
    ]);
    tracker.shutdown(at(26, 12));
  } finally {
    harness.close();
  }
});
