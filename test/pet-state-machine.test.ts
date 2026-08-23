import test from "node:test";
import assert from "node:assert/strict";
import {
  PetStateMachine,
  type PetStateScheduler,
  type RuntimePetState
} from "../src/main/runtime/pet-state-machine";
import { TaskEventBus } from "../src/main/runtime/task-event-bus";
import type { RuntimeTaskSnapshot } from "../src/shared/process-types";

class FakeTimeoutScheduler implements PetStateScheduler {
  callback: (() => void) | null = null;
  delayMs = 0;

  setTimeout(callback: () => void, delayMs: number): object {
    this.callback = callback;
    this.delayMs = delayMs;
    return {};
  }

  clearTimeout(): void {
    this.callback = null;
  }

  fire(): void {
    const callback = this.callback;
    this.callback = null;
    callback?.();
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
  const states: Array<{ state: RuntimePetState; message: string }> = [];
  const machine = new PetStateMachine(bus, {
    setState: (state, message) => states.push({ state, message })
  }, { scheduler, doneDurationMs: 2_500 });

  bus.emit({ type: "TASK_ACTIVE", task: snapshot() });
  assert.deepEqual(states.at(-1), { state: "working", message: "写代码 · 1:05" });

  bus.emit({
    type: "TASK_ACTIVE",
    task: snapshot({ taskId: "task-2", occurrenceId: "occurrence-2", title: "整理资料" })
  });
  bus.emit({
    type: "TASK_COMPLETED",
    task: snapshot({ occurrenceStatus: "completed", active: false })
  });
  assert.deepEqual(states.at(-1), { state: "done", message: "已完成：写代码" });
  assert.equal(scheduler.delayMs, 2_500);

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
  scheduler.fire();
  assert.deepEqual(states.at(-1), { state: "working", message: "整理资料 · 1:10" });

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
  scheduler.fire();
  assert.deepEqual(states.at(-1), { state: "idle", message: "" });
  machine.dispose();
});
