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
  assert.match(html, /data-view="stats"/);
  assert.match(html, /今日计时/);
  assert.match(html, /周计时/);
  assert.doesNotMatch(html, /data-view="settings"|开机自动启动|打开数据目录/);
  assert.match(html, /选择正在运行/);
  assert.match(html, /选择 exe 文件/);
  assert.match(html, /value="process_start">启动即完成/);
  assert.match(html, /id="runningProgramSearch"[^>]*placeholder="搜索 exe 或路径"/);
  assert.doesNotMatch(renderer, /better-sqlite3|node:fs|child_process/);
  assert.doesNotMatch(preload, /better-sqlite3|node:fs|child_process/);
  assert.match(preload, /contextBridge\.exposeInMainWorld/);
  assert.match(preload, /taskpet:processes:list-running/);
  assert.match(preload, /taskpet:runtime:changed/);
  assert.match(preload, /taskpet:tasks:time-stats/);
  assert.match(preload, /taskpet:processes:launch-bound/);
  assert.doesNotMatch(preload, /taskpet:settings:get/);
  assert.match(preload, /taskpet:panel:command/);
  assert.match(renderer, /openTaskDialog\(\)/);
  assert.match(renderer, /await taskApi\.rendererReady\(true\)/);
  assert.match(renderer, /if \(initialCommand\) await handlePanelCommand\(initialCommand\)/);
  assert.match(renderer, /processApi\.launchBound/);
  assert.match(renderer, /runningProgramSearch\.addEventListener\("input"/);
  assert.match(renderer, /formatStatsBoundary\(from\).*至.*formatStatsBoundary\(to\)/);
  assert.match(renderer, /value\.getMonth\(\) \+ 1}\/\$\{value\.getDate\(\)}/);
  assert.doesNotMatch(renderer, /setInterval\s*\(/);
});
