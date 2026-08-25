const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createFileLogger } = require("../src/app-logger");

test("file logger writes lifecycle lines without multiline injection", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "taskpet-log-test-"));
  try {
    const logger = createFileLogger({
      logsDirectory: root,
      now: () => new Date("2026-08-24T01:02:03.000Z")
    });
    logger.info("Application\nstart");
    logger.warn("Process monitor failed", new Error("native error"));

    const lines = fs.readFileSync(logger.logPath, "utf8").trim().split(/\r?\n/);
    assert.equal(lines.length, 2);
    assert.match(lines[0], /\[INFO\] Application start$/);
    assert.match(lines[1], /\[WARN\] Process monitor failed \| Error: native error/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
