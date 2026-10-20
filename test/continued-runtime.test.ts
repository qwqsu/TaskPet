import test from "node:test";
import assert from "node:assert/strict";
import { RuntimeTracker } from "../src/main/runtime/runtime-tracker";
import { TaskEventBus } from "../src/main/runtime/task-event-bus";
import { ProcessSessionRepository } from "../src/main/db/process-session-repository";
import { TimeStatsService } from "../src/main/services/time-stats-service";
import { createTaskHarness } from "./task-test-helpers";
import { toLocalDateKey } from "../src/shared/local-date";
import { MonitorControl } from "../src/main/runtime/monitor-control";

const program = {pid: 1, executableName: "Study.exe", executablePath: "C:\\Study.exe"};
const at = (day: number, hour = 9, minute = 0, second = 0) => new Date(2026, 9, day, hour, minute, second);
function setup(mode: "duration" | "manual" | "process_start" = "duration", daily = false) {
  const h = createTaskHarness(at(18));
  const task = h.service.createTask({title: "学习", taskType: daily ? "daily" : "one_time",
    completionMode: mode, targetDurationSec: mode === "duration" ? 1800 : 0, continueTimingAfterCompletion: true});
  const events = new TaskEventBus();
  let completions = 0;
  events.subscribe(event => { if (event.type === "TASK_COMPLETED") completions++; });
  const runtime = new RuntimeTracker(h.database, events, {clock: h.clock, scheduler: {setInterval: () => ({}), clearInterval: () => {}}});
  const stats = new TimeStatsService(h.database, runtime, {clock: h.clock});
  const sessions = new ProcessSessionRepository(h.database);
  return {...h, task, events, runtime, stats, sessions, completions: () => completions};
}

test("duration completes once at 30min and keeps one session through 75min", () => {
  const h = setup();
  try {
    h.runtime.startTask(h.task.id, program, at(18));
    h.runtime.tick(at(18, 9, 30));
    const completed = h.service.getTodayTasks()[0]!.occurrence;
    assert.equal(completed.status, "completed");
    assert.equal(h.runtime.activeTaskCount, 1);
    h.runtime.tick(at(18, 10, 15));
    h.runtime.checkpoint(at(18, 10, 15));
    h.runtime.stopTask(h.task.id, at(18, 10, 15));
    const after = h.service.getTodayTasks()[0]!.occurrence;
    assert.equal(after.accumulatedSec, 4500);
    assert.equal(after.status, "completed");
    assert.equal(after.completedAt, completed.completedAt);
    assert.equal(h.completions(), 1);
    assert.deepEqual(h.sessions.listForOccurrence(after.id).map(s => s.durationSec), [4500]);
    h.runtime.startTask(h.task.id, {...program, pid: 2}, at(18, 11));
    h.runtime.stopTask(h.task.id, at(18, 11, 10));
    assert.equal(h.service.getTodayTasks()[0]!.occurrence.accumulatedSec, 5100);
    assert.equal(h.completions(), 1);
  } finally { h.close(); }
});

test("manual completion and reopening preserve an active session without duplicate completion", () => {
  const h = setup("manual");
  try {
    h.runtime.startTask(h.task.id, program, at(18));
    h.clock.set(at(18, 9, 10));
    h.runtime.checkpoint();
    const item = h.service.getTodayTasks()[0]!;
    h.runtime.announceManualCompletion(h.service.completeOccurrence(item.occurrence.id).item);
    assert.equal(h.runtime.snapshots()[0]!.occurrenceStatus, "completed");
    h.clock.set(at(18, 9, 15));
    h.runtime.announceReopened(h.service.reopenOccurrence(item.occurrence.id).item);
    assert.equal(h.runtime.snapshots()[0]!.occurrenceStatus, "active");
    assert.equal(h.sessions.listForOccurrence(item.occurrence.id).length, 1);
    h.runtime.stopTask(h.task.id, at(18, 9, 20));
    assert.equal(h.service.getTodayTasks()[0]!.occurrence.accumulatedSec, 1200);
  } finally { h.close(); }
});

test("process_start can complete and continue timing, including restart and crash recovery", () => {
  const h = setup("process_start");
  try {
    h.runtime.startTask(h.task.id, program, at(18));
    const item = h.service.getTodayTasks()[0]!;
    assert.equal(item.occurrence.status, "completed");
    h.runtime.checkpoint(at(18, 9, 10));
    const recovered = new RuntimeTracker(h.database, h.events, {clock: h.clock});
    assert.equal(recovered.recoverStaleSessions(), 1);
    assert.equal(h.sessions.listForOccurrence(item.occurrence.id)[0]!.durationSec, 600);
    assert.equal(h.service.getTodayTasks()[0]!.occurrence.status, "completed");
    assert.equal(h.service.getTodayTasks()[0]!.occurrence.accumulatedSec, 600);
    assert.equal(h.completions(), 1);
  } finally { h.close(); }
});

test("completed daily timing crosses midnight into an independent next occurrence", () => {
  const h = setup("duration", true);
  try {
    h.runtime.startTask(h.task.id, program, at(18, 23));
    h.clock.set(at(19, 0, 10));
    h.runtime.checkpoint();
    const old = h.database.prepare("SELECT status, accumulated_sec FROM task_occurrences WHERE occurrence_date = '2026-10-18'").get();
    assert.deepEqual(old, {status: "completed", accumulated_sec: 3600});
    const today = h.service.getTodayTasks()[0]!;
    assert.equal(today.occurrence.status, "active");
    assert.equal(today.occurrence.accumulatedSec, 600);
    assert.equal(h.completions(), 1);
    assert.deepEqual([...h.stats.dailyTotals("2026-10-18", "2026-10-19")], [["2026-10-18", 3600], ["2026-10-19", 600]]);
    h.runtime.shutdown();
  } finally { h.close(); }
});

test("one-time history splits sessions by day and includes days without completed tasks", () => {
  const h = setup("manual");
  try {
    h.runtime.startTask(h.task.id, program, at(18, 23, 30));
    h.clock.set(at(19, 1));
    const query = {fromDate: "2026-10-18", toDate: "2026-10-19"};
    let history = h.service.getHistory(query, h.stats.dailyTotals(query.fromDate, query.toDate));
    assert.deepEqual(history.map(day => [day.date, day.totalSec, day.entries.length]), [["2026-10-19", 3600, 0], ["2026-10-18", 1800, 0]]);
    assert.equal(h.service.countOccurrencesForTask(h.task.id), 1);
    h.runtime.stopTask(h.task.id);
    h.service.archiveTask(h.task.id);
    history = h.service.getHistory(query);
    assert.equal(history[0]!.totalSec, h.stats.get("today").totalSec);
    h.service.deleteTask(h.task.id);
    assert.deepEqual(h.service.getHistory(query), []);
    assert.equal(h.sessions.listOpen().length, 0);
  } finally { h.close(); }
});

test("archive restores daily only on restore day and deleting safely cascades all data", () => {
  const h = setup("duration", true);
  try {
    const occurrence = h.service.getTodayTasks()[0]!.occurrence;
    h.runtime.startTask(h.task.id, program, at(18));
    h.runtime.stopTask(h.task.id, at(18, 9, 10));
    h.service.archiveTask(h.task.id);
    assert.equal(h.service.getArchivedTasks()[0]!.accumulatedSec, 600);
    h.clock.set(at(21));
    h.service.restoreTask(h.task.id);
    assert.equal(h.service.getTodayTasks()[0]!.occurrence.occurrenceDate, toLocalDateKey(at(21)));
    assert.equal(h.service.countOccurrencesForTask(h.task.id), 2);
    h.service.deleteTask(h.task.id);
    assert.equal(h.service.countOccurrencesForTask(h.task.id), 0);
    assert.equal(h.sessions.listForOccurrence(occurrence.id).length, 0);
    assert.equal(h.service.deleteTask(h.task.id), false);
  } finally { h.close(); }
});

test("turning off continuation stops completed tasks from being runtime candidates", () => {
  const h = setup();
  try {
    h.runtime.startTask(h.task.id, program, at(18));
    h.runtime.tick(at(18, 9, 31));
    h.runtime.stopTask(h.task.id, at(18, 9, 31));
    h.service.updateTask(h.task.id, {continueTimingAfterCompletion: false});
    assert.deepEqual(h.service.getRuntimeCandidates(), []);
    assert.equal(h.runtime.startTask(h.task.id, program, at(18, 10)), false);
    assert.equal(h.service.getTodayTasks()[0]!.occurrence.accumulatedSec, 1860);
  } finally { h.close(); }
});

test("completed timing freezes during exit confirmation and global pause preserves completion", () => {
  const h = setup();
  try {
    h.runtime.startTask(h.task.id, program, at(18));
    h.runtime.tick(at(18, 9, 30));
    h.runtime.suspectTaskExit(h.task.id, at(18, 9, 31));
    h.runtime.checkpoint(at(18, 9, 31, 4));
    assert.equal(h.runtime.snapshots(at(18, 9, 31, 4))[0]!.accumulatedSec, 1860);
    const control = new MonitorControl({setTargets: () => {}}, h.runtime);
    control.setPaused(true, at(18, 9, 31, 4));
    assert.equal(h.runtime.activeTaskCount, 0);
    assert.equal(h.runtime.isTicking, false);
    const item = h.service.getTodayTasks()[0]!;
    assert.equal(item.occurrence.status, "completed");
    assert.equal(item.occurrence.accumulatedSec, 1860);
    assert.equal(h.sessions.listForOccurrence(item.occurrence.id)[0]!.endedAt, at(18, 9, 31).toISOString());
  } finally { h.close(); }
});

test("completed one-time tasks remain editable and watchable on following days", () => {
  const h = setup("process_start");
  try {
    h.runtime.startTask(h.task.id, program, at(18));
    h.runtime.stopTask(h.task.id, at(18, 10));
    const completedAt = h.service.getTodayTasks()[0]!.occurrence.completedAt;
    h.clock.set(at(19));
    assert.equal(h.service.getTodayTasks()[0]!.task.id, h.task.id);
    assert.equal(h.service.getRuntimeCandidates()[0]!.task.id, h.task.id);
    h.runtime.startTask(h.task.id, program, at(19));
    h.runtime.stopTask(h.task.id, at(19, 9, 10));
    assert.equal(h.service.countOccurrencesForTask(h.task.id), 1);
    assert.equal(h.service.getTodayTasks()[0]!.occurrence.completedAt, completedAt);
    assert.equal(h.completions(), 1);
  } finally { h.close(); }
});
