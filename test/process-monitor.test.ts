import test from "node:test";
import assert from "node:assert/strict";
import {
  ProcessMonitor,
  type ProcessMonitorScheduler
} from "../src/main/process/process-monitor";
import type { ProcessProvider } from "../src/main/process/process-provider";
import type { ProcessInfo, TaskProcessRule } from "../src/shared/process-types";

class MutableProcessProvider implements ProcessProvider {
  processes: ProcessInfo[] = [];

  listProcesses(): ProcessInfo[] {
    return this.processes;
  }
}

class FakeIntervalScheduler implements ProcessMonitorScheduler {
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
  createdAt: "2026-08-23T00:00:00.000Z"
};

const firstProcess: ProcessInfo = {
  pid: 10,
  executableName: "Codex.exe",
  executablePath: "C:\\Codex\\Codex.exe"
};

test("monitor folds multiple PIDs into one task lifecycle and debounces final exit", async () => {
  const provider = new MutableProcessProvider();
  const scheduler = new FakeIntervalScheduler();
  const events: string[] = [];
  let stoppedAt: Date | null = null;
  const monitor = new ProcessMonitor(provider, {
    onStarted: () => { events.push("started"); },
    onSeen: () => events.push("seen"),
    onSuspectedExit: () => events.push("suspected"),
    onStopped: (_taskId, at) => {
      events.push("stopped");
      stoppedAt = at;
    }
  }, { scheduler, scanImmediately: false, exitDebounceMs: 4_000 });

  monitor.setTargets([{ taskId: "task-1", rules: [rule] }]);
  assert.equal(monitor.isRunning, true);
  assert.equal(scheduler.handles.size, 1);

  provider.processes = [firstProcess, { ...firstProcess, pid: 11 }];
  await monitor.scanNow(new Date("2026-08-23T01:00:00.000Z"));
  provider.processes = [{ ...firstProcess, pid: 11 }];
  await monitor.scanNow(new Date("2026-08-23T01:00:02.500Z"));
  assert.deepEqual(events, ["started", "seen"]);

  provider.processes = [];
  await monitor.scanNow(new Date("2026-08-23T01:00:05.000Z"));
  await monitor.scanNow(new Date("2026-08-23T01:00:08.900Z"));
  assert.deepEqual(events, ["started", "seen", "suspected"]);
  await monitor.scanNow(new Date("2026-08-23T01:00:09.000Z"));
  assert.deepEqual(events, ["started", "seen", "suspected", "stopped"]);
  assert.equal((stoppedAt as Date | null)?.toISOString(), "2026-08-23T01:00:05.000Z");

  monitor.setTargets([]);
  assert.equal(monitor.isRunning, false);
  assert.equal(scheduler.handles.size, 0);
});

test("a process returning during debounce remains the same continuous run", async () => {
  const provider = new MutableProcessProvider();
  const events: string[] = [];
  const monitor = new ProcessMonitor(provider, {
    onStarted: () => { events.push("started"); },
    onSeen: () => events.push("seen"),
    onSuspectedExit: () => events.push("suspected"),
    onStopped: () => events.push("stopped")
  }, {
    scheduler: new FakeIntervalScheduler(),
    scanImmediately: false
  });
  monitor.setTargets([{ taskId: "task-1", rules: [rule] }]);

  provider.processes = [firstProcess];
  await monitor.scanNow(new Date("2026-08-23T01:00:00.000Z"));
  provider.processes = [];
  await monitor.scanNow(new Date("2026-08-23T01:00:02.500Z"));
  provider.processes = [firstProcess];
  await monitor.scanNow(new Date("2026-08-23T01:00:05.000Z"));
  assert.deepEqual(events, ["started", "suspected", "seen"]);
  monitor.close();
});

test("monitor retries a process start that the runtime layer did not accept", async () => {
  const provider = new MutableProcessProvider();
  provider.processes = [firstProcess];
  let attempts = 0;
  const monitor = new ProcessMonitor(provider, {
    onStarted: () => {
      attempts += 1;
      return false;
    },
    onSeen: () => assert.fail("a rejected start must not become running"),
    onSuspectedExit: () => undefined,
    onStopped: () => undefined
  }, {
    scheduler: new FakeIntervalScheduler(),
    scanImmediately: false
  });
  monitor.setTargets([{ taskId: "task-1", rules: [rule] }]);
  await monitor.scanNow(new Date("2026-08-23T01:00:00.000Z"));
  await monitor.scanNow(new Date("2026-08-23T01:00:02.500Z"));
  assert.equal(attempts, 2);
  monitor.close();
});
