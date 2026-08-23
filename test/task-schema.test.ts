import test from "node:test";
import assert from "node:assert/strict";
import {
  CreateTaskInputSchema,
  HistoryQuerySchema,
  OccurrenceIdInputSchema,
  SetProcessRuleInputSchema,
  UpdateTaskInputSchema
} from "../src/shared/task-schemas";

test("task IPC schemas reject malformed and over-broad input", () => {
  assert.equal(CreateTaskInputSchema.safeParse({
    title: "合法任务",
    taskType: "daily",
    completionMode: "duration",
    targetDurationSec: 1200,
    shellCommand: "powershell"
  }).success, false);

  assert.equal(CreateTaskInputSchema.safeParse({
    title: "",
    taskType: "weekly",
    completionMode: "duration",
    targetDurationSec: 0
  }).success, false);

  assert.equal(OccurrenceIdInputSchema.safeParse({ occurrenceId: "not-a-uuid" }).success, false);
  assert.equal(UpdateTaskInputSchema.safeParse({
    id: "00000000-0000-4000-8000-000000000001",
    patch: {}
  }).success, false);
  assert.equal(HistoryQuerySchema.safeParse({
    fromDate: "2026-08-31",
    toDate: "2026-08-01"
  }).success, false);

  assert.equal(SetProcessRuleInputSchema.safeParse({
    taskId: "00000000-0000-4000-8000-000000000001",
    matchMode: "exact_path",
    executableName: "Codex.exe",
    executablePath: null
  }).success, false);
  assert.equal(SetProcessRuleInputSchema.safeParse({
    taskId: "00000000-0000-4000-8000-000000000001",
    matchMode: "exact_path",
    executableName: "Codex.exe",
    executablePath: "C:\\Apps\\Codex\\Codex.exe",
    command: "--unsafe"
  }).success, false);
  assert.equal(SetProcessRuleInputSchema.safeParse({
    taskId: "00000000-0000-4000-8000-000000000001",
    matchMode: "process_name",
    executableName: "Codex.exe",
    executablePath: null
  }).success, true);
});
