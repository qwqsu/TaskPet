import test from "node:test";
import assert from "node:assert/strict";
import type { IpcMain } from "electron";
import { PROCESS_CHANNELS } from "../src/main/ipc/process-channels";
import { registerProcessIpc } from "../src/main/ipc/register-process-ipc";
import type { ProcessProvider } from "../src/main/process/process-provider";
import type { ProcessRuleService } from "../src/main/services/process-rule-service";

type Handler = (event: { sender: object }, input?: unknown) => Promise<unknown>;

class FakeIpcMain {
  readonly handlers = new Map<string, Handler>();
  handle(channel: string, handler: Handler): void { this.handlers.set(channel, handler); }
  removeHandler(channel: string): void { this.handlers.delete(channel); }
}

test("launch IPC accepts only a trusted task id and never a Renderer path", async () => {
  const ipc = new FakeIpcMain();
  const trustedSender = {};
  const launched: string[] = [];
  const ruleService = {
    listRules: () => [],
    replaceRule: () => { throw new Error("not used"); },
    removeRules: () => false
  } as unknown as ProcessRuleService;
  const processProvider = {
    listProcesses: async () => []
  } satisfies ProcessProvider;
  const dispose = registerProcessIpc({
    ipcMain: ipc as unknown as IpcMain,
    ruleService,
    processProvider,
    isTrustedSender: (event) => event.sender === trustedSender,
    pickExecutable: async () => null,
    launchTask: async (taskId) => {
      launched.push(taskId);
      return true;
    },
    runtimeSnapshots: () => [],
    beforeRuleChange: () => undefined,
    onChanged: () => undefined
  });

  const launch = ipc.handlers.get(PROCESS_CHANNELS.launchBound)!;
  const id = "00000000-0000-4000-8000-000000000001";
  assert.deepEqual(await launch({ sender: trustedSender }, { id }), {
    ok: true,
    data: true
  });
  assert.deepEqual(launched, [id]);

  assert.equal((await launch({ sender: trustedSender }, {
    id,
    executablePath: "C:\\Unsafe.exe"
  }) as { ok: boolean }).ok, false);
  assert.equal((await launch({ sender: {} }, { id }) as { ok: boolean }).ok, false);
  assert.deepEqual(launched, [id]);

  dispose();
  assert.equal(ipc.handlers.size, 0);
});
