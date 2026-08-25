import test from "node:test";
import assert from "node:assert/strict";
import {
  LazyProcessProvider,
  type ProcessProvider
} from "../src/main/process/process-provider";

test("lazy process provider does not load its native delegate until the first scan", async () => {
  let createCount = 0;
  let scanCount = 0;
  const delegate: ProcessProvider = {
    listProcesses: () => {
      scanCount += 1;
      return [{ pid: 7, executableName: "TaskPet.exe", executablePath: null }];
    }
  };
  const provider = new LazyProcessProvider(() => {
    createCount += 1;
    return delegate;
  });

  assert.equal(createCount, 0);
  assert.deepEqual(await provider.listProcesses(), [
    { pid: 7, executableName: "TaskPet.exe", executablePath: null }
  ]);
  assert.equal(createCount, 1);
  await provider.listProcesses();
  assert.equal(createCount, 1);
  assert.equal(scanCount, 2);
});
