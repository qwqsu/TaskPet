/** v1.2：真实 Electron / preload / IPC / SQLite 回归；仅操作 smoke 隔离数据。 */
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

module.exports = async function v12Smoke(ctx) {
  const { app, BrowserWindow, taskSystem, applyAppSettings, showRadialMenu, radialMenuWindow } = ctx;
  const windows = BrowserWindow.getAllWindows();
  const panel = windows.find(win => win.webContents.getURL().includes("/panel/index.html"));
  const settings = windows.find(win => win.webContents.getURL().includes("/settings/index.html"));
  const read = code => panel.webContents.executeJavaScript(code).catch(error => { console.error("Panel smoke expression failed:", code); throw error; });
  const readSettings = code => settings.webContents.executeJavaScript(code).catch(error => { console.error("Settings smoke expression failed:", code); throw error; });
  const waitFor = async (win, expression) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await win.webContents.executeJavaScript(expression)) return;
      await sleep(50);
    }
    throw new Error(`UI did not become ready: ${expression}`);
  };
  const output = path.join(app.getAppPath(), "dist", "qa-v1.2");
  await fs.mkdir(output, {recursive: true});
  const errors = [];
  for (const win of windows) win.webContents.on("console-message", (_event, level, text) => { if (level >= 3) { errors.push(text); console.error("Renderer error:", text); } });
  await applyAppSettings({radialMenu: require("../build/shared/radial-settings").defaultRadialSettings()});
  panel.show(); settings.show(); panel.focus();
  await sleep(80);
  assert.equal(await readSettings("document.querySelector('.sidebar-pet')"), null);
  assert.equal(await readSettings("document.querySelector('.music-settings-card')"), null);
  const petIds = ctx.appSettingsSnapshot().pets.map(pet => pet.key);
  assert.ok(petIds.includes("pets:deepseek") && petIds.includes("pets:round-maodie"));
  assert.ok(!petIds.includes("pets:yinienie"));
  // 真实设置页编辑 / preload / IPC / 轮盘左键；仅替换操作系统启动出口，不启动用户程序。
  const {shell, dialog} = require("electron");
  const originalOpen = shell.openPath;
  const originalChooser = dialog.showOpenDialog;
  const musicDirectory = await fs.mkdtemp(path.join(require("node:os").tmpdir(), "TaskPet-music-click-"));
  const executable = path.join(musicDirectory, "Test Player.exe");
  const shortcut = path.join(musicDirectory, "Test Player.lnk");
  const opened = [];
  await fs.writeFile(executable, "smoke placeholder; never executed");
  try {
    shell.openPath = async target => {opened.push(target); return "";};
    dialog.showOpenDialog = async () => ({canceled: false, filePaths: [executable]});
    await readSettings("document.querySelector('[data-target=radialSection]').click(); document.querySelector('[data-id=music] [data-action=edit]').click()");
    assert.equal(await readSettings("document.getElementById('radialAppDialog').open"), true);
    await readSettings("document.getElementById('chooseRadialAppButton').click()");
    await sleep(100);
    assert.equal(await readSettings("document.getElementById('radialAppPath').value"), executable);
    await readSettings("document.getElementById('radialAppForm').requestSubmit()");
    await sleep(150);
    assert.equal(await readSettings("document.getElementById('radialAppDialog').open"), false);
    assert.equal(ctx.appSettingsSnapshot().musicBinding.executablePath, executable);
    const tested = await readSettings("window.taskPetSettings.testRadialApp('music')");
    assert.equal(tested.ok, true);
    assert.deepEqual(opened, [executable]);
    for (const target of [executable, shortcut]) {
      if (target === shortcut) {
        assert.equal(shell.writeShortcutLink(shortcut, {target: executable}), true);
        dialog.showOpenDialog = async () => ({canceled: false, filePaths: [shortcut]});
        await readSettings("document.querySelector('[data-id=music] [data-action=edit]').click(); document.getElementById('chooseRadialAppButton').click()");
        await sleep(100);
        await readSettings("document.getElementById('radialAppForm').requestSubmit()");
        await sleep(150);
        assert.equal(ctx.appSettingsSnapshot().musicBinding.path, shortcut);
      }
      showRadialMenu();
      await waitFor(radialMenuWindow, "Boolean(document.querySelector('[data-action=music]'))");
      await radialMenuWindow.webContents.executeJavaScript("document.querySelector('[data-action=music]').click()");
      await sleep(100);
      assert.equal(opened.at(-1), target);
    }
    assert.equal(opened.length, 3, "test button and each left click launch exactly once, without any media-session requirement");
    await readSettings("document.querySelector('[data-id=music] [data-action=edit]').click()");
    assert.equal(await readSettings("document.getElementById('radialAppPath').value"), shortcut);
    await readSettings("document.getElementById('cancelRadialAppButton').click()");
  } finally {
    shell.openPath = originalOpen;
    dialog.showOpenDialog = originalChooser;
    await applyAppSettings({radialMenu: require("../build/shared/radial-settings").defaultRadialSettings()});
    await fs.rm(musicDirectory, {recursive: true, force: true});
  }
  const task = taskSystem.service.createTask({title: "完成后仍在专注", taskType: "one_time", completionMode: "manual", targetDurationSec: 0, continueTimingAfterCompletion: true});
  const item = taskSystem.service.getTodayTasks().find(item => item.task.id === task.id);
  const start = new Date(Date.now() - 120000);
  taskSystem.runtime.startTask(task.id, {pid: process.pid, executableName: "Smoke.exe", executablePath: "C:\\Smoke.exe"}, start);
  await read("refreshToday()");
  await read(`document.querySelector('.task-check').click()`);
  await sleep(150);
  assert.equal(taskSystem.service.getOccurrence(item.occurrence.id).occurrence.status, "completed");
  assert.equal(taskSystem.runtime.activeTaskCount, 1);
  assert.equal(await read("document.querySelector('.task-meta').textContent.includes('已完成 · 计时中')"), true);
  await read(`document.querySelector('.task-card').dispatchEvent(new MouseEvent('contextmenu', {bubbles:true,cancelable:true,clientX:innerWidth-1,clientY:innerHeight-1}))`);
  const bounds = await read(`(()=>{const b=document.getElementById('taskContextMenu').getBoundingClientRect();return {right:b.right,bottom:b.bottom,width:innerWidth,height:innerHeight,items:document.querySelectorAll('[role="menuitem"]').length}})()`);
  assert.ok(bounds.right <= bounds.width && bounds.bottom <= bounds.height);
  assert.equal(bounds.items, 4);
  await sleep(80);
  assert.equal(await read("document.getElementById('taskContextMenu').hidden"), false);
  await fs.writeFile(path.join(output, "task-menu.png"), (await panel.webContents.capturePage()).toPNG());
  await read(`document.querySelector('.danger-menu-item').click()`);
  assert.equal(await read("document.activeElement.id"), "cancelConfirmButton");
  await read(`document.getElementById('cancelConfirmButton').click()`);
  assert.equal(taskSystem.service.countOccurrencesForTask(task.id), 1);
  await read("switchView('history')");
  assert.match(await read("document.querySelector('.history-day-total').textContent"), /0h2min/);
  const totals = await read("window.taskPet.tasks.timeStats('today')");
  assert.ok(totals.data.totalSec >= 120);
  const capture = async (win, name) => {
    await sleep(80);
    await fs.writeFile(path.join(output, name + ".png"), (await win.webContents.capturePage()).toPNG());
  };
  const contrastPairs = [];
  for (const themeId of ["classic-warm", "midnight-blue", "cream", "forest", "sakura"]) {
    await applyAppSettings({appearance: {themeMode: "manual", themeId}});
    await sleep(80);
    for (const win of windows) assert.equal(await win.webContents.executeJavaScript("document.documentElement.dataset.theme"), themeId);
    const colors = await read(`(()=>{const style=getComputedStyle(document.documentElement);return Object.fromEntries(${JSON.stringify(["text", "text-muted", "bg", "surface", "sunken", "primary", "primary-soft", "on-primary", "danger", "danger-soft", "success", "success-soft", "warning", "warning-soft", "inverse", "on-inverse", "highlight"])}.map(key=>[key,style.getPropertyValue('--color-'+key).trim()]))})()`);
    for (const [fg, bg] of [["text", "bg"], ["text", "surface"], ["text-muted", "bg"], ["text-muted", "sunken"], ["primary", "primary-soft"], ["on-primary", "primary"], ["danger", "danger-soft"], ["success", "success-soft"], ["warning", "warning-soft"], ["on-inverse", "inverse"], ["highlight", "inverse"]]) {
      contrastPairs.push({name: `${themeId}/${fg}/${bg}`, fg: colors[fg], bg: colors[bg]});
    }
    // 用实际主题选项同步页面，其 IPC 返回保存后的状态。
    await readSettings(`document.querySelector('[data-skin="${themeId}"]').click()`);
    await sleep(100);
    settings.setContentSize(1280, 800);
    await sleep(80);
    await readSettings("document.querySelector('[data-target=appearanceSection]').click();document.getElementById('appearanceSection').scrollIntoView({behavior:'instant',block:'start'})");
    await capture(settings, "settings-" + themeId + "-1280");
    panel.setContentSize(375, 700);
    await capture(panel, "history-" + themeId + "-375");
    if (themeId === "midnight-blue") {
      await read("openTaskDialog()");
      const options = await read(`Array.from(document.querySelectorAll('#completionMode option')).map(option => {const s=getComputedStyle(option); return [s.color,s.backgroundColor];})`);
      for (const [foreground, background] of options) {
        assert.equal(foreground, "rgb(246, 251, 253)");
        assert.equal(background, "rgb(34, 36, 53)");
      }
      await capture(panel, "task-editor-midnight-blue-375");
      await read("document.getElementById('taskDialog').close()");
    }
  }
  settings.setMinimumSize(320, 480);
  settings.setContentSize(375, 800);
  await sleep(80);
  await readSettings("document.querySelector('[data-target=appearanceSection]').click();document.getElementById('appearanceSection').scrollIntoView({behavior:'instant',block:'start'})");
  await capture(settings, "settings-sakura-375");
  assert.equal(await readSettings("document.documentElement.scrollWidth <= innerWidth"), true);
  showRadialMenu();
  await sleep(100);
  assert.equal(await radialMenuWindow.webContents.executeJavaScript("document.querySelector('[data-action=music]').getAttribute('aria-label')"), "音乐");
  await capture(radialMenuWindow, "radial-sakura");
  await read("switchView('today')");
  await read(`void archiveTask(todayItems.get('${task.id}').task);`);
  // 不 await 等待确认的 Promise；后续真实按钮决定写入。
  await read("document.getElementById('acceptConfirmButton').click()");
  await sleep(150);
  assert.equal(taskSystem.runtime.activeTaskCount, 0);
  await read("switchView('archived')");
  assert.equal(await read("document.querySelectorAll('#archivedList article').length"), 1);
  await read(`window.taskPet.tasks.restore('${task.id}')`);
  assert.equal(taskSystem.service.getTodayTasks()[0].occurrence.status, "completed");
  taskSystem.runtime.startTask(task.id, {pid: process.pid, executableName: "Smoke.exe", executablePath: "C:\\Smoke.exe"});
  await read("switchView('today')");
  panel.focus();
  await sleep(80);
  await read("document.querySelector('.task-more').click(); document.querySelector('.danger-menu-item').click()");
  assert.equal(await read("document.getElementById('confirmTaskDialog').open"), true);
  await read("document.getElementById('acceptConfirmButton').click()");
  await sleep(100);
  assert.equal(taskSystem.service.countOccurrencesForTask(task.id), 0);
  assert.equal(taskSystem.runtime.activeTaskCount, 0);
  const rejected = await read(`window.taskPet.tasks.delete('invalid-id')`);
  assert.equal(rejected.ok, false);
  await applyAppSettings({appearance: {themeMode: "system", themeId: "forest"}});
  const {nativeTheme} = require("electron");
  nativeTheme.themeSource = "dark";
  await sleep(80);
  assert.equal(await read("document.documentElement.dataset.theme"), "midnight-blue");
  nativeTheme.themeSource = "light";
  await sleep(80);
  assert.equal(await read("document.documentElement.dataset.theme"), "classic-warm");
  const stored = JSON.parse(await fs.readFile(path.join(app.getPath("userData"), "settings.json"), "utf8"));
  assert.equal(stored.appearance.themeMode, "system");
  assert.equal(stored.appearance.themeId, "forest");
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(output, "theme-contrast.json"), JSON.stringify({pairs: contrastPairs}, null, 2));
  console.log("TaskPet v1.2 smoke passed: continued completion, menu edge/cancel, history, archive/restore/delete, five synchronized themes, Windows appearance, saved settings and screenshots");
};
