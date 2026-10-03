/**
 * Tray 菜单的纯模板构造器，顺序和动作可脱离 Electron 窗口做回归测试。
 */
import type { MenuItemConstructorOptions } from "electron";

export interface TrayMenuState {
  ignoreMouseEvents: boolean;
}

export interface TrayMenuActions {
  quickAddTask(): void;
  togglePet(): void;
  recallPet(): void;
  setIgnoreMouseEvents(enabled: boolean): void;
  openSettings(): void;
  quit(): void;
}

export function createTrayMenuTemplate(
  state: TrayMenuState,
  actions: TrayMenuActions,
  petItems: MenuItemConstructorOptions[]
): MenuItemConstructorOptions[] {
  return [
    { label: "显示 / 隐藏桌宠", click: actions.togglePet },
    { label: "快速添加任务", click: actions.quickAddTask },
    { label: "设置", click: actions.openSettings },
    { label: "宠物", submenu: petItems },
    { label: "召回桌宠", click: actions.recallPet },
    {
      label: "忽略鼠标事件",
      type: "checkbox",
      checked: state.ignoreMouseEvents,
      click: () => actions.setIgnoreMouseEvents(!state.ignoreMouseEvents)
    },
    { type: "separator" },
    { label: "退出 TaskPet", click: actions.quit }
  ];
}

