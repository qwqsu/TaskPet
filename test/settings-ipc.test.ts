import test from "node:test";
import assert from "node:assert/strict";
import type { IpcMain } from "electron";
import { registerSettingsIpc } from "../src/main/ipc/register-settings-ipc";
import { SETTINGS_CHANNELS } from "../src/main/ipc/settings-channels";
import type { AppSettingsSnapshot } from "../src/shared/app-settings";

type Handler = (event: { sender: object }, input?: unknown) => Promise<unknown>;

class FakeIpcMain {
  readonly handlers = new Map<string, Handler>();

  handle(channel: string, handler: Handler): void {
    this.handlers.set(channel, handler);
  }

  removeHandler(channel: string): void {
    this.handlers.delete(channel);
  }
}

const snapshot: AppSettingsSnapshot = {
  autoStart: false,
  autoStartSupported: true,
  petSize: "normal",
  alwaysOnTop: true,
  activePetKey: "builtin:xiao-jin",
  pets: [{ key: "builtin:xiao-jin", displayName: "小锦", sourceLabel: "内置" }],
  dataDirectory: "C:\\Users\\Test\\AppData\\Roaming\\TaskPet",
  appName: "TaskPet",
  version: "0.4.0",
  githubUrl: "https://github.com/qwqsu/TaskPet"
};

test("settings IPC validates sender/input and exposes only fixed data/about actions", async () => {
  const ipc = new FakeIpcMain();
  const trustedSender = {};
  let githubOpens = 0;
  const dispose = registerSettingsIpc({
    ipcMain: ipc as unknown as IpcMain,
    isTrustedSender: (event) => event.sender === trustedSender,
    getSettings: () => snapshot,
    updateSettings: (input) => ({ ...snapshot, ...input }),
    openDataDirectory: async () => ({ canceled: false, filePath: snapshot.dataDirectory }),
    exportBackup: async () => ({ canceled: true, filePath: null }),
    openGitHub: async () => { githubOpens += 1; },
    openLicenses: async () => undefined
  });

  const get = ipc.handlers.get(SETTINGS_CHANNELS.get)!;
  const update = ipc.handlers.get(SETTINGS_CHANNELS.update)!;
  const openGitHub = ipc.handlers.get(SETTINGS_CHANNELS.openGitHub)!;

  assert.deepEqual(await get({ sender: trustedSender }), { ok: true, data: snapshot });
  assert.deepEqual(await update({ sender: trustedSender }, { petSize: "small" }), {
    ok: true,
    data: { ...snapshot, petSize: "small" }
  });

  const internalParameter = await update(
    { sender: trustedSender },
    { processScanIntervalMs: 1_000 }
  ) as { ok: boolean };
  assert.equal(internalParameter.ok, false);
  const untrusted = await get({ sender: {} }) as { ok: boolean };
  assert.equal(untrusted.ok, false);

  const arbitraryPayload = await openGitHub(
    { sender: trustedSender },
    { url: "https://example.invalid" }
  ) as { ok: boolean };
  assert.equal(arbitraryPayload.ok, false);
  assert.equal(githubOpens, 0);
  assert.deepEqual(await openGitHub({ sender: trustedSender }), { ok: true, data: undefined });
  assert.equal(githubOpens, 1);

  dispose();
  assert.equal(ipc.handlers.size, 0);
});
