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
  readonly reads: LoginItemSettingsOptions[] = [];
  readonly writes: LoginItemSettingsUpdate[] = [];

  getLoginItemSettings(options: LoginItemSettingsOptions = {}): {
    openAtLogin: boolean;
    executableWillLaunchAtLogin: boolean;
  } {
    this.reads.push(options);
    return {
      openAtLogin: this.openAtLogin,
      executableWillLaunchAtLogin: this.executableWillLaunchAtLogin
    };
  }

  setLoginItemSettings(settings: LoginItemSettingsUpdate): void {
    this.writes.push(settings);
    this.openAtLogin = settings.openAtLogin;
    this.executableWillLaunchAtLogin = settings.enabled ?? settings.openAtLogin;
  }
}

test("Windows login item reads and writes the same executable identity", () => {
  const app = new FakeLoginItemApp();
  const service = new LoginItemService(app, {
    platform: "win32",
    executablePath: "C:\\Program Files\\TaskPet\\TaskPet.exe",
    appName: "TaskPet"
  });

  assert.equal(service.supported, true);
  assert.equal(service.enabled, false);
  assert.equal(service.setEnabled(true), true);
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

test("Windows auto start reports a disabled StartupApproved entry as off", () => {
  const app = new FakeLoginItemApp();
  app.openAtLogin = true;
  app.executableWillLaunchAtLogin = false;
  const service = new LoginItemService(app, { platform: "win32" });

  assert.equal(service.enabled, false);
});

test("development Electron never registers itself as a login item", () => {
  const app = new FakeLoginItemApp();
  app.isPackaged = false;
  const service = new LoginItemService(app, { platform: "win32" });

  assert.equal(service.supported, false);
  assert.equal(service.enabled, false);
  assert.equal(service.setEnabled(true), false);
  assert.deepEqual(app.reads, []);
  assert.deepEqual(app.writes, []);
});
