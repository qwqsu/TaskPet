import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createSettingsWindowOptions } from "../src/main/windows/settings-window";

const root = path.join(__dirname, "..", "..");

test("settings is an independent isolated window with the requested simple sections", () => {
  const options = createSettingsWindowOptions({
    preloadPath: "C:\\TaskPet\\settings-preload.js"
  });
  assert.equal(options.title, "TaskPet 设置");
  assert.equal(options.webPreferences?.contextIsolation, true);
  assert.equal(options.webPreferences?.nodeIntegration, false);
  assert.equal(options.webPreferences?.sandbox, true);

  const html = fs.readFileSync(
    path.join(root, "src", "renderer", "settings", "index.html"),
    "utf8"
  );
  const renderer = fs.readFileSync(
    path.join(root, "src", "renderer", "settings", "settings.ts"),
    "utf8"
  );
  const preload = fs.readFileSync(
    path.join(root, "src", "preload", "settings-preload.ts"),
    "utf8"
  );
  for (const label of ["常规", "桌宠", "数据", "关于", "打开数据目录", "导出备份", "第三方许可证"]) {
    assert.ok(html.includes(label));
  }
  assert.match(html, /大<\/strong><small>105 × 114/);
  assert.match(html, /正常<\/strong><small>96 × 104/);
  assert.match(html, /小<\/strong><small>43 × 52/);
  assert.match(html, /id="settingsStatus"[^>]*hidden/);
  assert.match(html, /id="leftClickAction"/);
  assert.match(html, /id="doubleClickAction"/);
  assert.match(html, /id="rightClickAction"/);
  assert.doesNotMatch(html, /显示状态气泡|扫描间隔|启动后自动开始监控/);
  assert.match(renderer, /添加到 Windows 启动项，进入桌面后自动启动 TaskPet/);
  assert.match(renderer, /STATUS_VISIBLE_MS = 5_000/);
  assert.match(renderer, /window\.setTimeout\(\(\) => setStatus\(\), STATUS_VISIBLE_MS\)/);
  const styles = fs.readFileSync(
    path.join(root, "src", "renderer", "settings", "settings.css"),
    "utf8"
  );
  assert.match(styles, /\.settings-status\s*\{[^}]*position:\s*fixed/s);
  assert.match(styles, /\.settings-status\[hidden\]\s*\{[^}]*display:\s*none/s);
  assert.match(preload, /contextBridge\.exposeInMainWorld\("taskPetSettings"/);
  assert.doesNotMatch(renderer, /better-sqlite3|node:fs|child_process/);
  assert.doesNotMatch(preload, /better-sqlite3|node:fs|child_process/);
});
