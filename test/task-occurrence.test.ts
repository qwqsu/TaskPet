import test from "node:test";
import assert from "node:assert/strict";
import { createTaskHarness } from "./task-test-helpers";

test("task updates do not rewrite an existing occurrence", () => {
  const harness = createTaskHarness();
  try {
    const task = harness.service.createTask({
      title: "旧标题",
      description: null,
      taskType: "daily",
      completionMode: "manual",
      targetDurationSec: 0
    });
    const before = harness.service.getTodayTasks()[0];
    assert.ok(before);

    const updated = harness.service.updateTask(task.id, {
      title: "新标题",
      description: "保留 occurrence",
      completionMode: "duration",
      targetDurationSec: 1800
    });
    const after = harness.service.getTodayTasks()[0];

    assert.equal(updated.title, "新标题");
    assert.equal(updated.taskType, "daily");
    assert.equal(after?.occurrence.id, before.occurrence.id);
    assert.equal(after?.task.title, "新标题");
    assert.equal(after?.task.targetDurationSec, 1800);
  } finally {
    harness.close();
  }
});

test("archiving hides a task while retaining completed history", () => {
  const harness = createTaskHarness();
  try {
    const task = harness.service.createTask({
      title: "整理笔记",
      description: null,
      taskType: "daily",
      completionMode: "manual",
      targetDurationSec: 0
    });
    const item = harness.service.getTodayTasks()[0];
    assert.ok(item);
    harness.service.completeOccurrence(item.occurrence.id);

    const archived = harness.service.archiveTask(task.id);
    assert.ok(archived.archivedAt);
    assert.equal(archived.enabled, false);
    assert.deepEqual(harness.service.getTodayTasks(), []);

    const history = harness.service.getHistory({
      fromDate: "2026-08-01",
      toDate: "2026-08-31"
    });
    assert.equal(history[0]?.entries[0]?.task.id, task.id);
    assert.ok(history[0]?.entries[0]?.task.archivedAt);

    harness.clock.set(new Date(2026, 7, 24, 10, 0, 0));
    harness.service.getTodayTasks();
    assert.equal(harness.service.countOccurrencesForTask(task.id), 1);
  } finally {
    harness.close();
  }
});
