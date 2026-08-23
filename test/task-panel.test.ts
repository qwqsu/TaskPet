import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createTaskPanelWindowOptions } from "../src/main/windows/task-panel-window";

const root = path.join(__dirname, "..", "..");

test("task panel keeps SQLite behind an isolated preload", () => {
  const options = createTaskPanelWindowOptions({ preloadPath: "C:\\TaskPet\\panel-preload.js" });
  assert.equal(options.webPreferences?.contextIsolation, true);
  assert.equal(options.webPreferences?.nodeIntegration, false);
  assert.equal(options.webPreferences?.sandbox, true);
  assert.equal(options.webPreferences?.preload, "C:\\TaskPet\\panel-preload.js");

  const html = fs.readFileSync(path.join(root, "src", "renderer", "panel", "index.html"), "utf8");
  const renderer = fs.readFileSync(path.join(root, "src", "renderer", "panel", "panel.ts"), "utf8");
  const preload = fs.readFileSync(path.join(root, "src", "preload", "panel-preload.ts"), "utf8");
  assert.match(html, /今日任务/);
  assert.match(html, /历史/);
  assert.match(html, /选择正在运行/);
  assert.match(html, /选择 exe 文件/);
  assert.doesNotMatch(renderer, /better-sqlite3|node:fs|child_process/);
  assert.doesNotMatch(preload, /better-sqlite3|node:fs|child_process/);
  assert.match(preload, /contextBridge\.exposeInMainWorld/);
  assert.match(preload, /taskpet:processes:list-running/);
  assert.match(preload, /taskpet:runtime:changed/);
  assert.doesNotMatch(renderer, /setInterval\s*\(/);
});
