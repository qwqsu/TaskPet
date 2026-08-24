import test from "node:test";
import assert from "node:assert/strict";
import { MonitorControl } from "../src/main/runtime/monitor-control";
import {
  ProcessMonitor,
  type ProcessMonitorScheduler,
  type ProcessWatchTarget
} from "../src/main/process/process-monitor";
import type { ProcessProvider } from "../src/main/process/process-provider";
import type { RuntimeTaskSnapshot, TaskProcessRule } from "../src/shared/process-types";

class FakeScheduler implements ProcessMonitorScheduler {
  readonly handles = new Set<object>();
  setInterval(): object {
    const handle = {};
    this.handles.add(handle);
    return handle;
  }
  clearInterval(handle: unknown): void {
    this.handles.delete(handle as object);
  }
}

const rule: TaskProcessRule = {
  id: "rule-1",
  taskId: "task-1",
  platform: "win32",
  executableName: "Codex.exe",
  executablePath: null,
  bundleId: null,
  matchMode: "process_name",
  createdAt: "2026-08-24T00:00:00.000Z"
};

function target(taskId = "task-1"): ProcessWatchTarget {
  return { taskId, rules: [{ ...rule, taskId }] };
}

test("pause finalizes active runtime and removes the ProcessMonitor timer", () => {
  const scheduler = new FakeScheduler();
  const provider: ProcessProvider = { listProcesses: () => [] };
  const monitor = new ProcessMonitor(provider, {
    onStarted: () => undefined,
    onSeen: () => undefined,
    onSuspectedExit: () => undefined,
    onStopped: () => undefined
  }, { scheduler, scanImmediately: false });
  const stopped: Array<{ taskId: string; at: string }> = [];
  const snapshots: RuntimeTaskSnapshot[] = [{
    taskId: "task-1",
    occurrenceId: "occurrence-1",
    title: "写代码",
    occurrenceStatus: "active",
    completionMode: "duration",
    accumulatedSec: 12,
    targetDurationSec: 60,
    active: true
  }];
  const control = new MonitorControl(monitor, {
    snapshots: () => snapshots,
    stopTask: (taskId, at) => stopped.push({ taskId, at: at!.toISOString() })
  });

  control.setTargets([target()]);
  assert.equal(monitor.isRunning, true);
  assert.equal(scheduler.handles.size, 1);
  const pausedAt = new Date("2026-08-24T01:02:03.000Z");
  assert.equal(control.setPaused(true, pausedAt), true);
  assert.equal(control.isPaused, true);
  assert.deepEqual(stopped, [{ taskId: "task-1", at: pausedAt.toISOString() }]);
  assert.equal(monitor.isRunning, false);
  assert.equal(scheduler.handles.size, 0);

  control.setTargets([target("task-2")]);
  assert.equal(monitor.isRunning, false);
  assert.equal(control.setPaused(false, pausedAt), true);
  assert.equal(monitor.isRunning, true);
  assert.equal(monitor.watchedTaskCount, 1);
  assert.equal(scheduler.handles.size, 1);
  monitor.close();
});

test("repeating the same pause state is idempotent", () => {
  const targetHistory: readonly ProcessWatchTarget[][] = [];
  const mutableHistory = targetHistory as ProcessWatchTarget[][];
  const control = new MonitorControl({
    setTargets: (targets) => mutableHistory.push([...targets])
  }, {
    snapshots: () => [],
    stopTask: () => assert.fail("no active task should be stopped")
  });

  assert.equal(control.setPaused(true), true);
  assert.equal(control.setPaused(true), false);
  assert.equal(targetHistory.length, 1);
});

