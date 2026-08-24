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
  assert.match(html, /data-view="settings"/);
  assert.match(html, /开机自动启动/);
  assert.match(html, /data-pet-size="large"[^>]*>大 <small>125%/);
  assert.match(html, /data-pet-size="normal"[^>]*>正常 <small>100%/);
  assert.match(html, /data-pet-size="small"[^>]*>小 <small>50%/);
  assert.match(html, /打开数据目录/);
  assert.match(html, /导出备份/);
  assert.match(html, /第三方许可证/);
  assert.doesNotMatch(html, /启动后自动开始监控|显示状态气泡|扫描间隔/);
  assert.match(html, /选择正在运行/);
  assert.match(html, /选择 exe 文件/);
  assert.doesNotMatch(renderer, /better-sqlite3|node:fs|child_process/);
  assert.doesNotMatch(preload, /better-sqlite3|node:fs|child_process/);
  assert.match(preload, /contextBridge\.exposeInMainWorld/);
  assert.match(preload, /taskpet:processes:list-running/);
  assert.match(preload, /taskpet:runtime:changed/);
  assert.match(preload, /taskpet:settings:get/);
  assert.match(preload, /taskpet:panel:command/);
  assert.match(renderer, /openTaskDialog\(\)/);
  assert.doesNotMatch(renderer, /setInterval\s*\(/);
});
