/**
 * Tray 菜单的纯模板构造器，顺序和动作可脱离 Electron 窗口做回归测试。
 */
import type { MenuItemConstructorOptions } from "electron";

export interface TrayMenuState {
  monitorPaused: boolean;
  autoStart: boolean;
  autoStartSupported: boolean;
}

export interface TrayMenuActions {
  openPanel(): void;
  quickAddTask(): void;
  togglePet(): void;
  recallPet(): void;
  setMonitoringPaused(paused: boolean): void;
  setAutoStart(enabled: boolean): void;
  openSettings(): void;
  quit(): void;
}

export function createTrayMenuTemplate(
  state: TrayMenuState,
  actions: TrayMenuActions,
  petItems: MenuItemConstructorOptions[]
): MenuItemConstructorOptions[] {
  return [
    { label: "打开任务面板", click: actions.openPanel },
    { label: "快速添加任务", click: actions.quickAddTask },
    { type: "separator" },
    { label: "显示 / 隐藏桌宠", click: actions.togglePet },
    { label: "召回桌宠", click: actions.recallPet },
    { type: "separator" },
    {
      label: state.monitorPaused ? "恢复任务监控" : "暂停任务监控",
      click: () => actions.setMonitoringPaused(!state.monitorPaused)
    },
    { type: "separator" },
    {
      label: "开机自动启动",
      type: "checkbox",
      checked: state.autoStart,
      enabled: state.autoStartSupported,
      click: () => actions.setAutoStart(!state.autoStart)
    },
    { label: "设置", click: actions.openSettings },
    { type: "separator" },
    { label: "宠物", submenu: petItems },
    { type: "separator" },
    { label: "退出 TaskPet", click: actions.quit }
  ];
}

