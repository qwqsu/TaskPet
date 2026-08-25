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
  const taskSystem = fs.readFileSync(
    path.join(root, "src", "main", "task-system.ts"),
    "utf8"
  );
  const main = fs.readFileSync(path.join(root, "src", "main.js"), "utf8");
  for (const label of ["常规", "桌宠", "数据", "关于", "打开数据目录", "导出备份", "第三方许可证"]) {
    assert.ok(html.includes(label));
  }
  assert.match(html, /大<\/strong><small>110% · 105 × 115/);
  assert.match(html, /正常<\/strong><small>100% · 96 × 104/);
  assert.match(html, /小<\/strong><small>50% · 48 × 52/);
  assert.match(html, /id="settingsStatus"[^>]*hidden/);
  assert.match(html, /id="leftClickAction"/);
  assert.match(html, /id="doubleClickAction"/);
  assert.match(html, /id="rightClickAction"/);
  assert.match(html, /id="openCustomPetDialogButton"/);
  assert.match(html, /id="customPetDialog"/);
  assert.match(html, /id="petZipDropZone"/);
  assert.match(html, /拖拽 pet\.zip 到这里/);
  assert.match(html, /id="selectPetZipButton"/);
  assert.match(html, /id="selectPetFolderButton"/);
  assert.match(html, /id="openPetDexButton"/);
  assert.match(html, /id="openPetDexCreateButton"/);
  assert.match(html, /Hatch Pet/);
  assert.doesNotMatch(html, /生图提示词|customPetPrompt|copyCustomPetPromptButton/);
  assert.match(html, /img-src 'self' data: file:/);
  assert.doesNotMatch(html, /显示状态气泡|扫描间隔|启动后自动开始监控/);
  assert.match(renderer, /进入 Windows 桌面后自动启动 TaskPet/);
  assert.match(
    renderer,
    /TaskPet 已添加到 Windows 启动项，但 Windows 当前可能禁用了该启动项。/
  );
  assert.match(renderer, /autoStartToggle\.checked = snapshot\.autoStart\.registered/);
  assert.match(renderer, /openStartupAppsButton\.hidden = !snapshot\.autoStart\.blockedByWindows/);
  assert.match(html, /id="openStartupAppsButton"[^>]*hidden/);
  assert.match(html, /打开 Windows 启动应用设置/);
  assert.match(renderer, /STATUS_VISIBLE_MS = 5_000/);
  assert.match(renderer, /window\.setTimeout\(\(\) => setStatus\(\), STATUS_VISIBLE_MS\)/);
  const styles = fs.readFileSync(
    path.join(root, "src", "renderer", "settings", "settings.css"),
    "utf8"
  );
  assert.match(styles, /\.settings-status\s*\{[^}]*position:\s*fixed/s);
  assert.match(styles, /\.settings-status\[hidden\]\s*\{[^}]*display:\s*none/s);
  assert.match(preload, /contextBridge\.exposeInMainWorld\("taskPetSettings"/);
  assert.match(preload, /taskpet:settings:open-startup-apps/);
  assert.match(preload, /taskpet:settings:import-pet-zip/);
  assert.match(preload, /taskpet:settings:import-dropped-pet-zip/);
  assert.match(preload, /taskpet:settings:import-pet-folder/);
  assert.match(preload, /taskpet:settings:open-petdex-create/);
  assert.match(renderer, /打开 \/ 关闭设置/);
  assert.match(renderer, /file\.arrayBuffer\(\)/);
  assert.match(renderer, /new Uint8Array/);
  assert.match(renderer, /MAX_PET_ZIP_BYTES = 50 \* 1024 \* 1024/);
  assert.match(renderer, /settingsApi\.importPetFolder\(\)/);
  assert.match(main, /https:\/\/petdex\.dev\/zh\/create/);
  assert.match(taskSystem, /toggleSettings\(\): void/);
  assert.match(taskSystem, /settingsWindow\.close\(\)/);
  assert.match(main, /case "open-settings":\s*taskSystem\?\.toggleSettings\(\)/s);
  assert.doesNotMatch(renderer, /better-sqlite3|node:fs|child_process/);
  assert.doesNotMatch(preload, /better-sqlite3|node:fs|child_process/);
});
