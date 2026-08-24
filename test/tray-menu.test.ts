import test from "node:test";
import assert from "node:assert/strict";
import type { MenuItemConstructorOptions } from "electron";
import { createTrayMenuTemplate } from "../src/main/windows/tray-menu";

function click(item: MenuItemConstructorOptions): void {
  assert.equal(typeof item.click, "function");
  (item.click as unknown as () => void)();
}

test("Tray menu keeps the final P4 order and dispatches shared actions", () => {
  const actions: string[] = [];
  const template = createTrayMenuTemplate({
    monitorPaused: false,
    autoStart: false,
    autoStartSupported: true
  }, {
    openPanel: () => actions.push("panel"),
    quickAddTask: () => actions.push("quick-add"),
    togglePet: () => actions.push("toggle-pet"),
    recallPet: () => actions.push("recall"),
    setMonitoringPaused: (paused) => actions.push(`monitor:${String(paused)}`),
    setAutoStart: (enabled) => actions.push(`autostart:${String(enabled)}`),
    openSettings: () => actions.push("settings"),
    quit: () => actions.push("quit")
  }, [{ label: "小锦", type: "radio", checked: true }]);

  assert.deepEqual(template.map((item) => item.type === "separator" ? "---" : item.label), [
    "打开任务面板",
    "快速添加任务",
    "---",
    "显示 / 隐藏桌宠",
    "召回桌宠",
    "---",
    "暂停任务监控",
    "---",
    "开机自动启动",
    "设置",
    "---",
    "宠物",
    "---",
    "退出 TaskPet"
  ]);
  assert.equal(template[8]?.type, "checkbox");
  assert.equal(template[8]?.checked, false);
  assert.equal(template[8]?.enabled, true);

  for (const index of [0, 1, 3, 4, 6, 8, 9, 13]) click(template[index]!);
  assert.deepEqual(actions, [
    "panel",
    "quick-add",
    "toggle-pet",
    "recall",
    "monitor:true",
    "autostart:true",
    "settings",
    "quit"
  ]);
});

test("Tray reflects paused monitoring and disabled development auto start", () => {
  const template = createTrayMenuTemplate({
    monitorPaused: true,
    autoStart: false,
    autoStartSupported: false
  }, {
    openPanel: () => undefined,
    quickAddTask: () => undefined,
    togglePet: () => undefined,
    recallPet: () => undefined,
    setMonitoringPaused: () => undefined,
    setAutoStart: () => undefined,
    openSettings: () => undefined,
    quit: () => undefined
  }, []);

  assert.equal(template[6]?.label, "恢复任务监控");
  assert.equal(template[8]?.enabled, false);
});

