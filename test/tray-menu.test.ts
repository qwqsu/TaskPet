import test from "node:test";
import assert from "node:assert/strict";
import { createTrayMenuTemplate } from "../src/main/windows/tray-menu";

test("compact tray retains requested actions and reflects ignore-click state", () => {
  for (const ignoreMouseEvents of [false, true]) {
    const calls: unknown[] = [];
    const menu = createTrayMenuTemplate({ignoreMouseEvents}, {
      togglePet: () => calls.push("pet"), quickAddTask: () => calls.push("add"),
      openSettings: () => calls.push("settings"), recallPet: () => calls.push("recall"),
      setIgnoreMouseEvents: value => calls.push(value), quit: () => calls.push("quit")
    }, [{label:"小锦", type:"radio", checked:true}]);
    assert.deepEqual(menu.filter(item=>item.type!=="separator").map(item=>item.label),
      ["显示 / 隐藏桌宠", "快速添加任务", "设置", "宠物", "召回桌宠", "忽略鼠标事件", "退出 TaskPet"]);
    assert.equal(menu[5]!.checked, ignoreMouseEvents);
    for (const i of [0,1,2,4,5,7]) (menu[i]!.click as unknown as ()=>void)();
    assert.deepEqual(calls, ["pet","add","settings","recall",!ignoreMouseEvents,"quit"]);
  }
});
