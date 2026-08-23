import test from "node:test";
import assert from "node:assert/strict";
import { createTaskHarness } from "./task-test-helpers";

test("manual complete is idempotent and reopen preserves accumulated time", () => {
  const harness = createTaskHarness();
  try {
    harness.service.createTask({
      title: "阅读",
      description: null,
      taskType: "one_time",
      completionMode: "duration",
      targetDurationSec: 600
    });
    const item = harness.service.getTodayTasks()[0];
    assert.ok(item);
    harness.database.prepare(`
      UPDATE task_occurrences SET accumulated_sec = 75 WHERE id = ?
    `).run(item.occurrence.id);

    const completed = harness.service.completeOccurrence(item.occurrence.id);
    assert.equal(completed.changed, true);
    assert.equal(completed.item.occurrence.status, "completed");
    assert.equal(completed.item.occurrence.completionSource, "manual");
    assert.equal(completed.item.occurrence.accumulatedSec, 75);
    const completedAt = completed.item.occurrence.completedAt;

    harness.clock.set(new Date(2026, 7, 23, 11, 0, 0));
    const duplicate = harness.service.completeOccurrence(item.occurrence.id);
    assert.equal(duplicate.changed, false);
    assert.equal(duplicate.item.occurrence.completedAt, completedAt);

    const reopened = harness.service.reopenOccurrence(item.occurrence.id);
    assert.equal(reopened.changed, true);
    assert.equal(reopened.item.occurrence.status, "pending");
    assert.equal(reopened.item.occurrence.completedAt, null);
    assert.equal(reopened.item.occurrence.completionSource, null);
    assert.equal(reopened.item.occurrence.accumulatedSec, 75);
    assert.equal(harness.service.reopenOccurrence(item.occurrence.id).changed, false);
  } finally {
    harness.close();
  }
});

test("a completed daily task gets a new pending occurrence the next day", () => {
  const harness = createTaskHarness();
  try {
    const task = harness.service.createTask({
      title: "背单词",
      description: null,
      taskType: "daily",
      completionMode: "manual",
      targetDurationSec: 0
    });
    const first = harness.service.getTodayTasks()[0];
    assert.ok(first);
    harness.service.completeOccurrence(first.occurrence.id);

    harness.clock.set(new Date(2026, 7, 24, 7, 0, 0));
    const next = harness.service.getTodayTasks()[0];
    assert.ok(next);
    assert.notEqual(next.occurrence.id, first.occurrence.id);
    assert.equal(next.occurrence.status, "pending");
    assert.equal(harness.service.countOccurrencesForTask(task.id), 2);
  } finally {
    harness.close();
  }
});

test("one_time history is grouped by completion date, not creation date", () => {
  const harness = createTaskHarness();
  try {
    harness.service.createTask({
      title: "完成项目",
      description: null,
      taskType: "one_time",
      completionMode: "manual",
      targetDurationSec: 0
    });
    const occurrence = harness.service.getTodayTasks()[0]?.occurrence;
    assert.ok(occurrence);

    harness.clock.set(new Date(2026, 7, 26, 18, 30, 0));
    harness.service.completeOccurrence(occurrence.id);
    assert.equal(harness.service.getTodayTasks()[0]?.occurrence.id, occurrence.id);

    harness.clock.set(new Date(2026, 7, 27, 9, 0, 0));
    assert.deepEqual(harness.service.getTodayTasks(), []);
    const history = harness.service.getHistory({
      fromDate: "2026-08-20",
      toDate: "2026-08-31"
    });
    assert.equal(history[0]?.date, "2026-08-26");
    assert.equal(history[0]?.entries[0]?.occurrence.occurrenceDate, "2026-08-23");
  } finally {
    harness.close();
  }
});
