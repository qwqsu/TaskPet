import test from "node:test";
import assert from "node:assert/strict";
import {
  PetStateMachine,
  type PetStateScheduler,
  type RuntimePetState
} from "../src/main/runtime/pet-state-machine";
import { TaskEventBus } from "../src/main/runtime/task-event-bus";
import type { RuntimeTaskSnapshot } from "../src/shared/process-types";

interface CapturedPetState {
  state: RuntimePetState;
  message: string;
  detail?: string;
}

function recordState(states: CapturedPetState[]) {
  return (state: RuntimePetState, message: string, detail?: string): void => {
    states.push(detail === undefined
      ? { state, message }
      : { state, message, detail });
  };
}

class FakeTimeoutScheduler implements PetStateScheduler {
  private nextHandle = 1;
  private readonly timers = new Map<number, { callback: () => void; delayMs: number }>();

  setTimeout(callback: () => void, delayMs: number): number {
    const handle = this.nextHandle++;
    this.timers.set(handle, { callback, delayMs });
    return handle;
  }

  clearTimeout(handle: unknown): void {
    if (typeof handle === "number") this.timers.delete(handle);
  }

  pendingHandles(delayMs?: number): number[] {
    return [...this.timers.entries()]
      .filter(([, timer]) => delayMs === undefined || timer.delayMs === delayMs)
      .map(([handle]) => handle);
  }

  fire(delayMs: number): void {
    const entry = [...this.timers.entries()].find(([, timer]) => timer.delayMs === delayMs);
    assert.ok(entry, `Expected a pending ${delayMs} ms timer`);
    const [handle, timer] = entry;
    this.timers.delete(handle);
    timer.callback();
  }
}

function snapshot(overrides: Partial<RuntimeTaskSnapshot> = {}): RuntimeTaskSnapshot {
  return {
    taskId: "task-1",
    occurrenceId: "occurrence-1",
    title: "写代码",
    occurrenceStatus: "active",
    completionMode: "duration",
    accumulatedSec: 65,
    targetDurationSec: 120,
    active: true,
    ...overrides
  };
}

test("pet state machine shows runtime, plays done, then restores working", () => {
  const bus = new TaskEventBus();
  const scheduler = new FakeTimeoutScheduler();
  const states: CapturedPetState[] = [];
  const machine = new PetStateMachine(bus, {
    setState: recordState(states)
  }, { scheduler, doneDurationMs: 2_500 });

  bus.emit({ type: "TASK_ACTIVE", task: snapshot() });
  assert.deepEqual(states.at(-1), {
    state: "working",
    message: "写代码",
    detail: "1:05"
  });

  bus.emit({
    type: "TASK_ACTIVE",
    task: snapshot({ taskId: "task-2", occurrenceId: "occurrence-2", title: "整理资料" })
  });
  bus.emit({
    type: "TASK_COMPLETED",
    task: snapshot({ occurrenceStatus: "completed", active: false })
  });
  assert.deepEqual(states.at(-1), { state: "done", message: "已完成：写代码" });
  assert.deepEqual(scheduler.pendingHandles(2_500).length, 1);
  assert.deepEqual(scheduler.pendingHandles(3_000).length, 0);

  bus.emit({
    type: "TASK_PROGRESS",
    task: snapshot({
      taskId: "task-2",
      occurrenceId: "occurrence-2",
      title: "整理资料",
      accumulatedSec: 70
    })
  });
  assert.equal(states.at(-1)!.state, "done");
  scheduler.fire(2_500);
  assert.deepEqual(states.at(-1), {
    state: "working",
    message: "整理资料",
    detail: "1:10"
  });

  bus.emit({
    type: "TASK_PAUSED",
    task: snapshot({ taskId: "task-2", occurrenceId: "occurrence-2", active: false })
  });
  assert.deepEqual(states.at(-1), { state: "idle", message: "" });

  bus.emit({
    type: "TASK_COMPLETED",
    task: snapshot({ occurrenceStatus: "completed", active: false })
  });
  assert.equal(states.at(-1)!.state, "done");
  scheduler.fire(2_500);
  assert.deepEqual(states.at(-1), { state: "idle", message: "" });
  machine.dispose();
});

test("pet state machine rotates active task messages every three seconds", () => {
  const bus = new TaskEventBus();
  const scheduler = new FakeTimeoutScheduler();
  const states: CapturedPetState[] = [];
  const machine = new PetStateMachine(bus, {
    setState: recordState(states)
  }, { scheduler });

  bus.emit({
    type: "TASK_ACTIVE",
    task: snapshot({ title: "ChatGPT写代码" })
  });
  bus.emit({
    type: "TASK_ACTIVE",
    task: snapshot({
      taskId: "task-2",
      occurrenceId: "occurrence-2",
      title: "听音乐",
      accumulatedSec: 40
    })
  });

  assert.deepEqual(states.at(-1), {
    state: "working",
    message: "ChatGPT写代码",
    detail: "1:05"
  });
  const firstRotationHandle = scheduler.pendingHandles(3_000);
  assert.equal(firstRotationHandle.length, 1);

  bus.emit({
    type: "TASK_PROGRESS",
    task: snapshot({ title: "ChatGPT写代码", accumulatedSec: 66 })
  });
  bus.emit({
    type: "TASK_PROGRESS",
    task: snapshot({
      taskId: "task-2",
      occurrenceId: "occurrence-2",
      title: "听音乐",
      accumulatedSec: 42
    })
  });
  assert.deepEqual(scheduler.pendingHandles(3_000), firstRotationHandle);
  assert.deepEqual(states.at(-1), {
    state: "working",
    message: "ChatGPT写代码",
    detail: "1:06"
  });

  scheduler.fire(3_000);
  assert.deepEqual(states.at(-1), {
    state: "working",
    message: "听音乐",
    detail: "0:42"
  });
  assert.equal(scheduler.pendingHandles(3_000).length, 1);

  scheduler.fire(3_000);
  assert.deepEqual(states.at(-1), {
    state: "working",
    message: "ChatGPT写代码",
    detail: "1:06"
  });

  bus.emit({
    type: "TASK_PAUSED",
    task: snapshot({ occurrenceStatus: "pending", active: false })
  });
  assert.deepEqual(states.at(-1), {
    state: "working",
    message: "听音乐",
    detail: "0:42"
  });
  assert.equal(scheduler.pendingHandles(3_000).length, 0);

  machine.dispose();
});

test("done temporarily pauses task rotation and resumes it afterward", () => {
  const bus = new TaskEventBus();
  const scheduler = new FakeTimeoutScheduler();
  const states: CapturedPetState[] = [];
  const machine = new PetStateMachine(bus, {
    setState: recordState(states)
  }, { scheduler, doneDurationMs: 2_500, taskRotationMs: 3_000 });

  for (const [taskId, title] of [
    ["task-1", "写代码"],
    ["task-2", "听音乐"],
    ["task-3", "整理资料"]
  ]) {
    bus.emit({
      type: "TASK_ACTIVE",
      task: snapshot({ taskId, occurrenceId: `occurrence-${taskId}`, title })
    });
  }
  assert.equal(scheduler.pendingHandles(3_000).length, 1);

  bus.emit({
    type: "TASK_COMPLETED",
    task: snapshot({
      taskId: "task-3",
      occurrenceId: "occurrence-task-3",
      title: "整理资料",
      occurrenceStatus: "completed",
      active: false
    })
  });
  assert.deepEqual(states.at(-1), { state: "done", message: "已完成：整理资料" });
  assert.equal(scheduler.pendingHandles(3_000).length, 0);
  assert.equal(scheduler.pendingHandles(2_500).length, 1);

  scheduler.fire(2_500);
  assert.deepEqual(states.at(-1), {
    state: "working",
    message: "写代码",
    detail: "1:05"
  });
  assert.equal(scheduler.pendingHandles(3_000).length, 1);

  machine.dispose();
  assert.equal(scheduler.pendingHandles().length, 0);
});
