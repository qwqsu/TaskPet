import test from "node:test";
import assert from "node:assert/strict";
import {
  LoginItemService,
  type LoginItemAppAdapter,
  type LoginItemSettingsOptions,
  type LoginItemSettingsUpdate
} from "../src/main/services/login-item-service";

class FakeLoginItemApp implements LoginItemAppAdapter {
  isPackaged = true;
  openAtLogin = false;
  executableWillLaunchAtLogin = false;
  applyRegistrationWrites = true;
  approvalUpdatesOnWrite = true;
  reportRegistrationThroughLaunchItems = false;
  readonly reads: LoginItemSettingsOptions[] = [];
  readonly writes: LoginItemSettingsUpdate[] = [];

  getLoginItemSettings(options: LoginItemSettingsOptions = {}): {
    openAtLogin: boolean;
    executableWillLaunchAtLogin: boolean;
    launchItems?: Array<{
      name: string;
      path: string;
      args: string[];
      scope: "user";
      enabled: boolean;
    }>;
  } {
    this.reads.push(options);
    return {
      openAtLogin: this.reportRegistrationThroughLaunchItems ? false : this.openAtLogin,
      executableWillLaunchAtLogin: this.executableWillLaunchAtLogin,
      ...(this.reportRegistrationThroughLaunchItems && this.openAtLogin ? {
        launchItems: [{
          name: "TaskPet",
          path: "c:/program files/taskpet/TASKPET.exe",
          args: [],
          scope: "user" as const,
          enabled: this.executableWillLaunchAtLogin
        }]
      } : {})
    };
  }

  setLoginItemSettings(settings: LoginItemSettingsUpdate): void {
    this.writes.push(settings);
    if (this.applyRegistrationWrites) this.openAtLogin = settings.openAtLogin;
    if (this.approvalUpdatesOnWrite) {
      this.executableWillLaunchAtLogin = settings.enabled ?? settings.openAtLogin;
    }
  }
}

function createWindowsService(
  app: FakeLoginItemApp,
  waited: number[] = []
): LoginItemService {
  return new LoginItemService(app, {
    platform: "win32",
    executablePath: "C:\\Program Files\\TaskPet\\TaskPet.exe",
    appName: "TaskPet",
    verificationDelayMs: 25,
    wait: async (delayMs) => { waited.push(delayMs); }
  });
}

test("openAtLogin=true and executableWillLaunchAtLogin=true is enabled", () => {
  const app = new FakeLoginItemApp();
  app.openAtLogin = true;
  app.executableWillLaunchAtLogin = true;

  assert.deepEqual(createWindowsService(app).status, {
    supported: true,
    registered: true,
    willLaunch: true,
    blockedByWindows: false
  });
});

test("a registered Windows-disabled login item stays enabled without throwing", async () => {
  const app = new FakeLoginItemApp();
  app.approvalUpdatesOnWrite = false;
  app.executableWillLaunchAtLogin = false;

  await assert.doesNotReject(async () => {
    assert.deepEqual(await createWindowsService(app).setEnabled(true), {
      supported: true,
      registered: true,
      willLaunch: false,
      blockedByWindows: true
    });
  });
});

test("openAtLogin=false is not enabled", () => {
  const app = new FakeLoginItemApp();
  app.openAtLogin = false;
  app.executableWillLaunchAtLogin = true;

  assert.deepEqual(createWindowsService(app).status, {
    supported: true,
    registered: false,
    willLaunch: true,
    blockedByWindows: false
  });
});

test("setEnabled(true) succeeds when openAtLogin becomes true after verification", async () => {
  const app = new FakeLoginItemApp();
  const waited: number[] = [];
  const service = createWindowsService(app, waited);

  const status = await service.setEnabled(true);

  assert.equal(status.registered, true);
  assert.deepEqual(waited, [25]);
  assert.deepEqual(app.writes, [{
    path: "C:\\Program Files\\TaskPet\\TaskPet.exe",
    args: [],
    openAtLogin: true,
    enabled: true,
    name: "TaskPet"
  }]);
  assert.ok(app.reads.every((options) => (
    options.path === "C:\\Program Files\\TaskPet\\TaskPet.exe"
      && options.args?.length === 0
  )));
});

test("an exact launchItems entry repairs Electron 28's false openAtLogin result", async () => {
  const app = new FakeLoginItemApp();
  app.reportRegistrationThroughLaunchItems = true;

  const status = await createWindowsService(app).setEnabled(true);

  assert.deepEqual(status, {
    supported: true,
    registered: true,
    willLaunch: true,
    blockedByWindows: false
  });
});

test("setEnabled(true) fails only when openAtLogin remains false", async () => {
  const app = new FakeLoginItemApp();
  app.applyRegistrationWrites = false;

  await assert.rejects(
    createWindowsService(app).setEnabled(true),
    /Windows 未能注册 TaskPet 启动项/
  );
});

test("setEnabled(false) succeeds once openAtLogin is false", async () => {
  const app = new FakeLoginItemApp();
  app.openAtLogin = true;
  app.executableWillLaunchAtLogin = true;

  const status = await createWindowsService(app).setEnabled(false);

  assert.equal(status.registered, false);
  assert.equal(app.writes[0]?.openAtLogin, false);
  assert.equal(app.writes[0]?.enabled, false);
});

test("development Electron never registers itself as a login item", async () => {
  const app = new FakeLoginItemApp();
  app.isPackaged = false;
  const service = createWindowsService(app);

  assert.deepEqual(service.status, {
    supported: false,
    registered: false,
    willLaunch: null,
    blockedByWindows: false
  });
  assert.deepEqual(await service.setEnabled(true), service.status);
  assert.deepEqual(app.reads, []);
  assert.deepEqual(app.writes, []);
});
