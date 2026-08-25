import test from "node:test";
import assert from "node:assert/strict";
import { createTaskHarness } from "./task-test-helpers";

test("daily occurrences are materialized lazily once per local date", () => {
  const harness = createTaskHarness();
  try {
    const task = harness.service.createTask({
      title: "写代码",
      description: null,
      taskType: "daily",
      completionMode: "duration",
      targetDurationSec: 2400
    });

    assert.equal(harness.service.countOccurrencesForTask(task.id), 0);
    assert.equal(harness.service.getTodayTasks().length, 1);
    assert.equal(harness.service.countOccurrencesForTask(task.id), 1);
    assert.equal(harness.service.getTodayTasks().length, 1);
    assert.equal(harness.service.countOccurrencesForTask(task.id), 1);

    harness.clock.set(new Date(2026, 7, 24, 8, 0, 0));
    const nextDay = harness.service.getTodayTasks();
    assert.equal(nextDay.length, 1);
    assert.equal(nextDay[0]?.occurrence.occurrenceDate, "2026-08-24");
    assert.equal(harness.service.countOccurrencesForTask(task.id), 2);
  } finally {
    harness.close();
  }
});

test("one_time tasks keep one permanent occurrence across dates", () => {
  const harness = createTaskHarness();
  try {
    const task = harness.service.createTask({
      title: "交付课程项目",
      description: "一次性任务",
      taskType: "one_time",
      completionMode: "manual",
      targetDurationSec: 0
    });
    const firstOccurrence = harness.service.getTodayTasks()[0]?.occurrence;
    assert.ok(firstOccurrence);
    assert.equal(firstOccurrence.occurrenceDate, "2026-08-23");
    assert.equal(harness.service.countOccurrencesForTask(task.id), 1);

    harness.clock.set(new Date(2026, 7, 28, 15, 0, 0));
    const laterOccurrence = harness.service.getTodayTasks()[0]?.occurrence;
    assert.equal(laterOccurrence?.id, firstOccurrence.id);
    assert.equal(harness.service.countOccurrencesForTask(task.id), 1);
  } finally {
    harness.close();
  }
});
