import test from "node:test";
import assert from "node:assert/strict";
import { ProcessRuleService } from "../src/main/services/process-rule-service";
import { createTaskHarness } from "./task-test-helpers";

test("process rules replace one task binding without exposing an executable action", () => {
  const harness = createTaskHarness();
  try {
    const task = harness.service.createTask({
      title: "写代码",
      taskType: "daily",
      completionMode: "duration",
      targetDurationSec: 1_500
    });
    let counter = 0;
    const service = new ProcessRuleService(harness.database, {
      clock: harness.clock,
      platform: "win32",
      idFactory: () => {
        counter += 1;
        return `10000000-0000-4000-8000-${counter.toString(16).padStart(12, "0")}`;
      }
    });

    const exactRule = service.replaceRule({
      taskId: task.id,
      matchMode: "exact_path",
      executableName: "ignored.exe",
      executablePath: "c:/Apps/Codex/Codex.exe"
    });
    assert.equal(exactRule.executableName, "Codex.exe");
    assert.equal(exactRule.executablePath, "c:\\Apps\\Codex\\Codex.exe");
    assert.equal(exactRule.matchMode, "exact_path");

    const nameRule = service.replaceRule({
      taskId: task.id,
      matchMode: "process_name",
      executableName: "CODEX.EXE",
      executablePath: null
    });
    assert.equal(nameRule.matchMode, "process_name");
    assert.equal(service.listRulesForTask(task.id).length, 1);
    assert.equal(service.removeRules(task.id), true);
    assert.deepEqual(service.listRulesForTask(task.id), []);
  } finally {
    harness.close();
  }
});
