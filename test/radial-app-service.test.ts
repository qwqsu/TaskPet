import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { launchRadialApp, validateRadialAppPath } from "../src/main/services/radial-app-service";
import { defaultRadialSettings } from "../src/shared/radial-settings";

async function fixture(t: {after(fn: () => Promise<void>): void}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "taskpet-radial-app-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const executable = path.join(directory, "Fake App.EXE");
  const shortcut = path.join(directory, "Fake Shortcut.LNK");
  // Deliberately not executable content. Only the injected stub receives these paths.
  await fs.writeFile(executable, "test placeholder, not a program");
  await fs.writeFile(shortcut, "test placeholder, not a shortcut");
  const settings = defaultRadialSettings();
  settings.items.push(
    { id: "app-first", name: "Fake app", path: executable, enabled: true },
    { id: "app-second", name: "Fake shortcut", path: shortcut, enabled: true }
  );
  const opened: string[] = [];
  const openPath = async (target: string) => { opened.push(target); return ""; };
  return { directory, executable, shortcut, settings, opened, openPath };
}

test("app path validation accepts existing exe and lnk files and normalizes the path", async (t) => {
  const f = await fixture(t);
  assert.equal(await validateRadialAppPath(f.executable), f.executable);
  assert.equal(await validateRadialAppPath(f.shortcut), f.shortcut);
  const unnormalized = `${f.directory}${path.sep}.${path.sep}Fake App.EXE`;
  assert.equal(await validateRadialAppPath(unnormalized), f.executable);
  assert.deepEqual(f.opened, [], "validation alone never opens a target");
});

test("relative paths, unsupported extensions, URLs, NULs and appended arguments are rejected", async (t) => {
  const f = await fixture(t);
  const textFile = path.join(f.directory, "existing.txt");
  await fs.writeFile(textFile, "exists but is not a supported application target");
  for (const invalid of [
    "", "relative.exe", path.join("relative", "program.exe"), textFile,
    "https://example.invalid/program.exe", `file://${f.executable}`,
    `${f.executable}\0.exe`, `${f.executable} --argument`, `"${f.executable}"`
  ]) {
    await assert.rejects(validateRadialAppPath(invalid), /请选择本地/);
    f.settings.items.find(item => item.id === "app-first")!.path = invalid;
    await assert.rejects(launchRadialApp("app-first", f.settings, f.openPath));
  }
  assert.deepEqual(f.opened, [], "invalid launch targets never reach openPath");
});

test("nonexistent paths and directories disguised as executables cannot launch", async (t) => {
  const f = await fixture(t);
  const directoryExe = path.join(f.directory, "directory.exe");
  await fs.mkdir(directoryExe);
  for (const invalid of [path.join(f.directory, "missing.exe"), directoryExe]) {
    await assert.rejects(validateRadialAppPath(invalid), /不存在或无法访问/);
    f.settings.items.find(item => item.id === "app-first")!.path = invalid;
    await assert.rejects(launchRadialApp("app-first", f.settings, f.openPath), /不存在或无法访问/);
  }
  assert.deepEqual(f.opened, []);
});

test("launch resolves the selected saved app ID and opens its normalized target exactly once", async (t) => {
  const f = await fixture(t);
  f.settings.items.find(item => item.id === "app-first")!.path =
    `${f.directory}${path.sep}.${path.sep}Fake App.EXE`;
  assert.equal(await launchRadialApp("app-second", f.settings, f.openPath), true);
  assert.deepEqual(f.opened, [f.shortcut]);
  assert.equal(await launchRadialApp("app-first", f.settings, f.openPath), true);
  assert.deepEqual(f.opened, [f.shortcut, f.executable]);
});

test("unknown IDs, builtin IDs and missing saved paths never reach openPath", async (t) => {
  const f = await fixture(t);
  // Even attaching a path to a builtin cannot turn it into an application entry.
  f.settings.items.find(item => item.id === "open-panel")!.path = f.executable;
  f.settings.items.push({ id: "app-no-path", enabled: true, name: "Missing" });
  for (const id of ["app-unknown", "open-panel", "app-no-path", f.executable, "app-first --argument"]) {
    await assert.rejects(launchRadialApp(id, f.settings, f.openPath), /应用入口不存在/);
  }
  assert.deepEqual(f.opened, []);
});

test("launch rechecks a previously valid target if the file has disappeared", async (t) => {
  const f = await fixture(t);
  await validateRadialAppPath(f.executable);
  await fs.unlink(f.executable);
  await assert.rejects(launchRadialApp("app-first", f.settings, f.openPath), /不存在或无法访问/);
  assert.deepEqual(f.opened, []);
});

test("openPath errors and rejected promises fail without retries or fallback launches", async (t) => {
  const f = await fixture(t);
  await assert.rejects(launchRadialApp("app-first", f.settings, async (target) => {
    f.opened.push(target);
    return "Access denied";
  }), /应用启动失败/);
  assert.deepEqual(f.opened, [f.executable]);
  const rejection = new Error("openPath rejected");
  await assert.rejects(launchRadialApp("app-second", f.settings, async (target) => {
    f.opened.push(target);
    throw rejection;
  }), (error: unknown) => error === rejection);
  assert.deepEqual(f.opened, [f.executable, f.shortcut]);
});
