import test from "node:test";
import assert from "node:assert/strict";
import type { IpcMain } from "electron";
import { registerTaskIpc } from "../src/main/ipc/register-task-ipc";
import { TASK_CHANNELS } from "../src/main/ipc/task-channels";
import { RuntimeTracker } from "../src/main/runtime/runtime-tracker";
import { TaskEventBus } from "../src/main/runtime/task-event-bus";
import { createTaskHarness } from "./task-test-helpers";

test("task delete/restore IPC rejects unknown senders and extra fields before touching active data", () => {
  const h = createTaskHarness();
  const sender = {};
  const handlers = new Map<string, (event: {sender: object}, input?: unknown) => any>();
  const ipcMain = {handle: (channel: string, handler: any) => handlers.set(channel, handler), removeHandler: (channel: string) => handlers.delete(channel)} as unknown as IpcMain;
  const runtime = new RuntimeTracker(h.database, new TaskEventBus(), {clock: h.clock, scheduler: {setInterval: () => ({}), clearInterval: () => {}}});
  let stops = 0;
  let changes = 0;
  const dispose = registerTaskIpc({
    ipcMain, service: h.service, isTrustedSender: event => event.sender === sender,
    beforeTaskUpdate: id => runtime.stopTask(id), beforeTaskArchive: id => runtime.stopTask(id),
    beforeTaskDelete: id => { stops++; runtime.stopTask(id); },
    beforeOccurrenceComplete: id => runtime.stopOccurrence(id),
    onCompleted: () => {}, onReopened: () => {}, onChanged: () => { changes++; },
    getTimeStats: () => { throw new Error("not used"); }
  });
  try {
    const task = h.service.createTask({title: "正在运行", taskType: "one_time", completionMode: "manual", targetDurationSec: 0});
    runtime.startTask(task.id, {pid: 1, executableName: "Study.exe", executablePath: "C:\\Study.exe"});
    const remove = handlers.get(TASK_CHANNELS.delete)!;
    assert.equal(remove({sender: {}}, {id: task.id}).ok, false);
    assert.equal(remove({sender}, {id: task.id, force: true}).ok, false);
    assert.equal(remove({sender}, {id: "not-a-task-id"}).ok, false);
    assert.equal(stops, 0);
    assert.equal(runtime.activeTaskCount, 1);
    assert.deepEqual(remove({sender}, {id: task.id}), {ok: true, data: true});
    assert.equal(runtime.activeTaskCount, 0);
    assert.equal(runtime.isTicking, false);
    assert.equal(h.service.countOccurrencesForTask(task.id), 0);
    assert.deepEqual(h.database.prepare("SELECT * FROM process_sessions").all(), []);
    assert.equal(changes, 1);
    assert.deepEqual(remove({sender}, {id: task.id}), {ok: true, data: false});
    assert.equal(changes, 1);
    assert.equal(handlers.get(TASK_CHANNELS.restore)!({sender}, {id: task.id}).error.code, "NOT_FOUND");
    assert.equal(handlers.get(TASK_CHANNELS.archived)!({sender: {}}).ok, false);
  } finally { dispose(); h.close(); }
  assert.equal(handlers.size, 0);
});
