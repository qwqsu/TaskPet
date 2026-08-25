import test from "node:test";
import assert from "node:assert/strict";
import {
  matchProcessesForRules,
  processMatchesRule
} from "../src/main/process/process-matcher";
import type { ProcessInfo, TaskProcessRule } from "../src/shared/process-types";

function rule(overrides: Partial<TaskProcessRule> = {}): TaskProcessRule {
  return {
    id: "rule-1",
    taskId: "task-1",
    platform: "win32",
    executableName: "Codex.exe",
    executablePath: "C:\\Apps\\Codex\\Codex.exe",
    bundleId: null,
    matchMode: "exact_path",
    createdAt: "2026-08-23T00:00:00.000Z",
    ...overrides
  };
}

const processInfo: ProcessInfo = {
  pid: 101,
  executableName: "CODEX.EXE",
  executablePath: "c:/apps/codex/CODEX.exe"
};

test("exact_path matching normalizes Windows case and separators", () => {
  assert.equal(processMatchesRule(processInfo, rule()), true);
  assert.equal(processMatchesRule(
    { ...processInfo, executablePath: "C:\\Other\\Codex.exe" },
    rule()
  ), false);
});

test("exact_path never falls back to a matching process name", () => {
  assert.equal(processMatchesRule(
    { ...processInfo, executablePath: null },
    rule()
  ), false);
});

test("process_name matching is case-insensitive and path-independent", () => {
  const nameRule = rule({ matchMode: "process_name", executablePath: null });
  assert.equal(processMatchesRule(processInfo, nameRule), true);
  assert.equal(processMatchesRule(
    { ...processInfo, executableName: "other.exe" },
    nameRule
  ), false);
});

test("matching returns multiple PIDs without converting them into multiple clocks", () => {
  const processes = [
    processInfo,
    { ...processInfo, pid: 102 },
    { pid: 103, executableName: "other.exe", executablePath: "C:\\Other\\other.exe" }
  ];
  assert.deepEqual(
    matchProcessesForRules(processes, [rule()]).map((item) => item.pid),
    [101, 102]
  );
});
