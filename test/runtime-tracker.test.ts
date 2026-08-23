import test from "node:test";
import assert from "node:assert/strict";
import { ProcessSessionRepository } from "../src/main/db/process-session-repository";
import {
  RuntimeTracker,
  type RuntimeTrackerScheduler
} from "../src/main/runtime/runtime-tracker";
import { TaskEventBus } from "../src/main/runtime/task-event-bus";
import type { ProcessInfo, TaskRuntimeEvent } from "../src/shared/process-types";
import { createTaskHarness } from "./task-test-helpers";

class FakeRuntimeScheduler implements RuntimeTrackerScheduler {
  readonly intervals = new Map<object, number>();

  setInterval(_callback: () => void, intervalMs: number): object {
    const handle = {};
    this.intervals.set(handle, intervalMs);
    return handle;
  }

  clearInterval(handle: unknown): void {
    this.intervals.delete(handle as object);
  }
}

const codexProcess: ProcessInfo = {
  pid: 100,
  executableName: "Codex.exe",
  executablePath: "C:\\Apps\\Codex\\Codex.exe"
};

function date(hour: number, minute: number, second: number): Date {
  return new Date(2026, 7, 23, hour, minute, second);
}

test("runtime uses memory ticks, checkpoints periodically, and accumulates sessions", () => {
  const harness = createTaskHarness(date(9, 0, 0));
  try {
    harness.service.createTask({
      title: "写代码",
      taskType: "daily",
      completionMode: "duration",
      targetDurationSec: 60
    });
    const item = harness.service.getTodayTasks()[0]!;
    const events = new TaskEventBus();
    const seenEvents: TaskRuntimeEvent[] = [];
    events.subscribe((event) => seenEvents.push(event));
    const scheduler = new FakeRuntimeScheduler();
    const tracker = new RuntimeTracker(harness.database, events, { scheduler });

    tracker.startTask(item.task.id, codexProcess, date(9, 0, 0));
    tracker.tick(date(9, 0, 10));
    assert.equal(harness.service.getTodayTasks()[0]!.occurrence.accumulatedSec, 0);
    assert.equal(tracker.snapshots(date(9, 0, 10))[0]!.accumulatedSec, 10);
    assert.deepEqual([...scheduler.intervals.values()].sort(), [1_000, 30_000]);

    tracker.checkpoint(date(9, 0, 30));
    assert.equal(harness.service.getTodayTasks()[0]!.occurrence.accumulatedSec, 30);
    tracker.stopTask(item.task.id, date(9, 0, 40));
    assert.equal(harness.service.getTodayTasks()[0]!.occurrence.status, "pending");
    assert.equal(harness.service.getTodayTasks()[0]!.occurrence.accumulatedSec, 40);

    tracker.startTask(item.task.id, { ...codexProcess, pid: 101 }, date(9, 10, 0));
    tracker.tick(date(9, 10, 20));
    const completed = harness.service.getTodayTasks()[0]!;
    assert.equal(completed.occurrence.status, "completed");
    assert.equal(completed.occurrence.accumulatedSec, 60);
    assert.equal(completed.occurrence.completionSource, "duration");
    assert.equal(tracker.activeTaskCount, 0);
    assert.equal(scheduler.intervals.size, 0);

    tracker.tick(date(9, 20, 0));
    assert.equal(
      seenEvents.filter((event) => event.type === "TASK_COMPLETED").length,
      1
    );
    const sessions = new ProcessSessionRepository(harness.database)
      .listForOccurrence(item.occurrence.id);
    assert.deepEqual(sessions.map((session) => session.durationSec), [40, 20]);
    assert.equal(sessions.every((session) => session.finalized), true);
  } finally {
    harness.close();
  }
});

test("suspected exit freezes checkpoints but a quick return keeps one session", () => {
  const harness = createTaskHarness(date(9, 0, 0));
  try {
    harness.service.createTask({
      title: "写代码",
      taskType: "one_time",
      completionMode: "duration",
      targetDurationSec: 120
    });
    const item = harness.service.getTodayTasks()[0]!;
    const tracker = new RuntimeTracker(harness.database, new TaskEventBus(), {
      scheduler: new FakeRuntimeScheduler()
    });
    tracker.startTask(item.task.id, codexProcess, date(9, 0, 0));
    tracker.suspectTaskExit(item.task.id, date(9, 0, 10));
    tracker.tick(date(9, 0, 15));
    tracker.checkpoint(date(9, 0, 15));
    assert.equal(tracker.snapshots(date(9, 0, 15))[0]!.accumulatedSec, 10);
    assert.equal(harness.service.getTodayTasks()[0]!.occurrence.accumulatedSec, 10);

    tracker.seeTask(item.task.id, { ...codexProcess, pid: 102 });
    tracker.tick(date(9, 0, 20));
    tracker.stopTask(item.task.id, date(9, 0, 20));
    assert.equal(harness.service.getTodayTasks()[0]!.occurrence.accumulatedSec, 20);
    assert.equal(
      new ProcessSessionRepository(harness.database).listForOccurrence(item.occurrence.id).length,
      1
    );
  } finally {
    harness.close();
  }
});

test("crash recovery finalizes an open session at last_seen_at", () => {
  const harness = createTaskHarness(date(9, 0, 0));
  try {
    harness.service.createTask({
      title: "写代码",
      taskType: "one_time",
      completionMode: "duration",
      targetDurationSec: 120
    });
    const item = harness.service.getTodayTasks()[0]!;
    const first = new RuntimeTracker(harness.database, new TaskEventBus(), {
      scheduler: new FakeRuntimeScheduler()
    });
    first.startTask(item.task.id, codexProcess, date(9, 0, 0));
    first.checkpoint(date(9, 0, 30));

    harness.clock.set(date(9, 5, 0));
    const recovered = new RuntimeTracker(harness.database, new TaskEventBus(), {
      clock: harness.clock,
      scheduler: new FakeRuntimeScheduler()
    });
    assert.equal(recovered.recoverStaleSessions(), 1);
    const session = new ProcessSessionRepository(harness.database)
      .listForOccurrence(item.occurrence.id)[0]!;
    assert.equal(session.finalized, true);
    assert.equal(session.endedAt, date(9, 0, 30).toISOString());
    assert.equal(session.durationSec, 30);
    assert.equal(harness.service.getTodayTasks()[0]!.occurrence.status, "pending");
    assert.equal(harness.service.getTodayTasks()[0]!.occurrence.accumulatedSec, 30);
  } finally {
    harness.close();
  }
});

test("daily runtime splits at local midnight while one process remains running", () => {
  const start = date(23, 59, 50);
  const harness = createTaskHarness(start);
  try {
    const task = harness.service.createTask({
      title: "跨午夜写代码",
      taskType: "daily",
      completionMode: "duration",
      targetDurationSec: 3_600
    });
    const oldOccurrence = harness.service.getTodayTasks()[0]!.occurrence;
    const tracker = new RuntimeTracker(harness.database, new TaskEventBus(), {
      scheduler: new FakeRuntimeScheduler()
    });
    tracker.startTask(task.id, codexProcess, start);

    const nextDayAtTenSeconds = new Date(2026, 7, 24, 0, 0, 10);
    tracker.tick(nextDayAtTenSeconds);
    const oldItem = harness.database.prepare(
      "SELECT status, accumulated_sec FROM task_occurrences WHERE id = ?"
    ).get(oldOccurrence.id) as { status: string; accumulated_sec: number };
    assert.deepEqual(oldItem, { status: "pending", accumulated_sec: 10 });
    const active = tracker.snapshots(nextDayAtTenSeconds)[0]!;
    assert.notEqual(active.occurrenceId, oldOccurrence.id);
    assert.equal(active.accumulatedSec, 10);

    tracker.stopTask(task.id, new Date(2026, 7, 24, 0, 0, 20));
    const nextOccurrence = harness.database.prepare(`
      SELECT status, accumulated_sec FROM task_occurrences
      WHERE task_id = ? AND occurrence_date = '2026-08-24'
    `).get(task.id) as { status: string; accumulated_sec: number };
    assert.deepEqual(nextOccurrence, { status: "pending", accumulated_sec: 20 });
  } finally {
    harness.close();
  }
});

test("manual completion stops runtime and a completed occurrence cannot restart", () => {
  const harness = createTaskHarness(date(9, 0, 0));
  try {
    harness.service.createTask({
      title: "手动验收",
      taskType: "one_time",
      completionMode: "duration",
      targetDurationSec: 120
    });
    const item = harness.service.getTodayTasks()[0]!;
    const tracker = new RuntimeTracker(harness.database, new TaskEventBus(), {
      scheduler: new FakeRuntimeScheduler()
    });
    tracker.startTask(item.task.id, codexProcess, date(9, 0, 0));
    tracker.stopOccurrence(item.occurrence.id, date(9, 0, 10));
    const result = harness.service.completeOccurrence(item.occurrence.id);
    assert.equal(result.item.occurrence.status, "completed");
    assert.equal(result.item.occurrence.accumulatedSec, 10);

    tracker.startTask(item.task.id, codexProcess, date(9, 0, 20));
    tracker.tick(date(9, 1, 0));
    assert.equal(tracker.activeTaskCount, 0);
    assert.equal(
      new ProcessSessionRepository(harness.database).listForOccurrence(item.occurrence.id).length,
      1
    );
  } finally {
    harness.close();
  }
});

test("runtime lazily materializes a new daily occurrence at the start boundary", () => {
  const harness = createTaskHarness(new Date(2026, 7, 23, 23, 50, 0));
  try {
    const task = harness.service.createTask({
      title: "午夜启动",
      taskType: "daily",
      completionMode: "duration",
      targetDurationSec: 300
    });
    harness.service.getTodayTasks();
    const tracker = new RuntimeTracker(harness.database, new TaskEventBus(), {
      scheduler: new FakeRuntimeScheduler()
    });
    const afterMidnight = new Date(2026, 7, 24, 0, 0, 1);

    assert.equal(tracker.startTask(task.id, codexProcess, afterMidnight), true);
    const active = tracker.snapshots(afterMidnight)[0]!;
    const occurrence = harness.database.prepare(`
      SELECT occurrence_date, status FROM task_occurrences WHERE id = ?
    `).get(active.occurrenceId) as { occurrence_date: string; status: string };
    assert.deepEqual(occurrence, { occurrence_date: "2026-08-24", status: "active" });
    tracker.stopTask(task.id, afterMidnight);
  } finally {
    harness.close();
  }
});
