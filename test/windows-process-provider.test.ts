import test from "node:test";
import assert from "node:assert/strict";
import { WindowsProcessProvider } from "../src/main/process/windows-process-provider";

test("Windows provider reads the current process through native APIs", {
  skip: process.platform !== "win32"
}, () => {
  const processes = new WindowsProcessProvider().listProcesses();
  const current = processes.find((processInfo) => processInfo.pid === process.pid);
  assert.ok(current);
  assert.ok(current.executableName.toLocaleLowerCase("en-US").endsWith(".exe"));
  assert.ok(current.executablePath);
});
