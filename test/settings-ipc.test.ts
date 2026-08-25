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
  autoStart: {
    supported: true,
    registered: false,
    willLaunch: false,
    blockedByWindows: false
  },
  petSize: "normal",
  alwaysOnTop: true,
  mouseBindings: {
    leftClick: "open-panel",
    doubleClick: "toggle-monitoring",
    rightClick: "open-settings"
  },
  activePetKey: "builtin:xiao-jin",
  pets: [{
    key: "builtin:xiao-jin",
    displayName: "小锦",
    description: "内置桌宠",
    sourceLabel: "内置",
    spritesheetUrl: "file:///TaskPet/xiao-jin/spritesheet.webp",
    frame: { width: 192, height: 208, columns: 8, rows: 9 }
  }],
  dataDirectory: "C:\\Users\\Test\\AppData\\Roaming\\TaskPet",
  appName: "TaskPet",
  version: "1.0.0",
  githubUrl: "https://github.com/qwqsu/TaskPet"
};

test("settings IPC validates sender/input and exposes only fixed data/about actions", async () => {
  const ipc = new FakeIpcMain();
  const trustedSender = {};
  let githubOpens = 0;
  let startupSettingsOpens = 0;
  let petDexOpens = 0;
  let petDexCreateOpens = 0;
  let pickedZipImports = 0;
  let droppedZipImports = 0;
  let folderImports = 0;
  const dispose = registerSettingsIpc({
    ipcMain: ipc as unknown as IpcMain,
    isTrustedSender: (event) => event.sender === trustedSender,
    getSettings: () => snapshot,
    updateSettings: (input) => ({
      ...snapshot,
      petSize: input.petSize ?? snapshot.petSize,
      alwaysOnTop: input.alwaysOnTop ?? snapshot.alwaysOnTop,
      mouseBindings: input.mouseBindings ?? snapshot.mouseBindings,
      activePetKey: input.activePetKey ?? snapshot.activePetKey,
      autoStart: input.autoStart === undefined
        ? snapshot.autoStart
        : { ...snapshot.autoStart, registered: input.autoStart }
    }),
    importPetZip: async () => {
      pickedZipImports += 1;
      return {
        canceled: false,
        petKey: "pets:zip-picker",
        settings: snapshot
      };
    },
    importDroppedPetZip: async () => {
      droppedZipImports += 1;
      return {
        canceled: false,
        petKey: "pets:dropped-zip",
        settings: snapshot
      };
    },
    importPetFolder: async () => {
      folderImports += 1;
      return {
        canceled: false,
        petKey: "pets:folder-picker",
        settings: snapshot
      };
    },
    openPetDex: async () => { petDexOpens += 1; },
    openPetDexCreate: async () => { petDexCreateOpens += 1; },
    openDataDirectory: async () => ({ canceled: false, filePath: snapshot.dataDirectory }),
    exportBackup: async () => ({ canceled: true, filePath: null }),
    openStartupApps: async () => { startupSettingsOpens += 1; },
    openGitHub: async () => { githubOpens += 1; },
    openLicenses: async () => undefined
  });

  const get = ipc.handlers.get(SETTINGS_CHANNELS.get)!;
  const update = ipc.handlers.get(SETTINGS_CHANNELS.update)!;
  const importPetZip = ipc.handlers.get(SETTINGS_CHANNELS.importPetZip)!;
  const importDroppedPetZip = ipc.handlers.get(SETTINGS_CHANNELS.importDroppedPetZip)!;
  const importPetFolder = ipc.handlers.get(SETTINGS_CHANNELS.importPetFolder)!;
  const openPetDex = ipc.handlers.get(SETTINGS_CHANNELS.openPetDex)!;
  const openPetDexCreate = ipc.handlers.get(SETTINGS_CHANNELS.openPetDexCreate)!;
  const openStartupApps = ipc.handlers.get(SETTINGS_CHANNELS.openStartupApps)!;
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

  const unsafePet = await importDroppedPetZip({ sender: trustedSender }, {
    fileName: "miku.webp",
    bytes: new Uint8Array([1])
  }) as { ok: boolean };
  assert.equal(unsafePet.ok, false);
  assert.equal(droppedZipImports, 0);
  assert.deepEqual(await importDroppedPetZip({ sender: trustedSender }, {
    fileName: "miku.zip",
    bytes: new Uint8Array([0x50, 0x4b])
  }), {
    ok: true,
    data: {
      canceled: false,
      petKey: "pets:dropped-zip",
      settings: snapshot
    }
  });
  assert.equal(droppedZipImports, 1);
  assert.deepEqual(await importPetZip({ sender: trustedSender }), {
    ok: true,
    data: { canceled: false, petKey: "pets:zip-picker", settings: snapshot }
  });
  assert.deepEqual(await importPetFolder({ sender: trustedSender }), {
    ok: true,
    data: { canceled: false, petKey: "pets:folder-picker", settings: snapshot }
  });
  assert.equal(pickedZipImports, 1);
  assert.equal(folderImports, 1);

  const arbitraryPetDexUrl = await openPetDex(
    { sender: trustedSender },
    { url: "https://example.invalid" }
  ) as { ok: boolean };
  assert.equal(arbitraryPetDexUrl.ok, false);
  assert.equal(petDexOpens, 0);
  assert.deepEqual(await openPetDex({ sender: trustedSender }), { ok: true, data: undefined });
  assert.deepEqual(await openPetDexCreate({ sender: trustedSender }), {
    ok: true,
    data: undefined
  });
  assert.equal(petDexOpens, 1);
  assert.equal(petDexCreateOpens, 1);

  const arbitraryPayload = await openGitHub(
    { sender: trustedSender },
    { url: "https://example.invalid" }
  ) as { ok: boolean };
  assert.equal(arbitraryPayload.ok, false);
  assert.equal(githubOpens, 0);
  assert.deepEqual(await openGitHub({ sender: trustedSender }), { ok: true, data: undefined });
  assert.equal(githubOpens, 1);

  const startupArbitraryPayload = await openStartupApps(
    { sender: trustedSender },
    { url: "ms-settings:privacy" }
  ) as { ok: boolean };
  assert.equal(startupArbitraryPayload.ok, false);
  assert.equal(startupSettingsOpens, 0);
  assert.deepEqual(await openStartupApps({ sender: trustedSender }), {
    ok: true,
    data: undefined
  });
  assert.equal(startupSettingsOpens, 1);

  dispose();
  assert.equal(ipc.handlers.size, 0);
});
