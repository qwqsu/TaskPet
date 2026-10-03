/** Isolated bridge; main must independently validate sender, action IDs and ranges. */
import { contextBridge, ipcRenderer } from "electron";

export interface RadialMenuItem { id: string; enabled: boolean; name?: string; path?: string }
export interface RadialMenuSettings {
  enabled: boolean; opacity: number; scale: number; showHints: boolean; animations: boolean;
  items: RadialMenuItem[];
}
export interface RadialMenuState {
  petVisible: boolean; ignoreMouseEvents: boolean; petOpacity: number; petScale: number;
  alwaysOnTop: boolean; monitoringPaused: boolean; radialMenu: RadialMenuSettings;
}
export interface RadialMenuUpdate {
  petOpacity?: number; petScale?: number; radialMenu?: { opacity?: number; scale?: number };
}
export interface RadialMenuResult { ok: boolean; error?: string }
export type RadialMenuAction = string;
export type RadialMusicCommand = "status" | "previous" | "toggle" | "next";
export interface RadialMusicState { available: boolean; playing?: boolean; error?: string }
export interface RadialMenuBridge {
  appIcon(id: string): Promise<string | null>;
  getState(): Promise<RadialMenuState | null>;
  action(action: string): Promise<RadialMenuResult>;
  update(input: RadialMenuUpdate): Promise<RadialMenuState>;
  music(command: RadialMusicCommand): Promise<RadialMusicState>;
  close(): void;
  onChanged(callback: (state: RadialMenuState) => void): () => void;
}
const channels = Object.freeze({
  getState: "taskpet:radial-menu:get-state", action: "taskpet:radial-menu:action",
  update: "taskpet:radial-menu:update", music: "taskpet:radial-menu:music",
  close: "taskpet:radial-menu:close", changed: "taskpet:radial-menu:changed"
});
const actions = new Set([
  "open-panel", "quick-add", "open-settings", "toggle-monitoring", "toggle-pet",
  "toggle-ignore-mouse", "toggle-always-on-top", "quit"
]);
function bounded(value: unknown, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new TypeError("调节值超出支持范围");
  }
  return value;
}
const bridge: RadialMenuBridge = {
  appIcon: (id) => ipcRenderer.invoke("taskpet:radial-menu:icon", id),
  getState: () => ipcRenderer.invoke(channels.getState),
  action: async (action) => {
    if (typeof action !== "string" || (!actions.has(action) && !/^app-[\w-]{1,128}$/.test(action))) {
      return { ok: false, error: "不支持的菜单操作" };
    }
    try {
      const result = await ipcRenderer.invoke(channels.action, action);
      return result && typeof result.ok === "boolean" ? result : { ok: false, error: "操作未返回有效结果" };
    } catch { return { ok: false, error: "操作失败，请重试" }; }
  },
  update: async (input) => {
    const safe: RadialMenuUpdate = {};
    if (input.petOpacity !== undefined) safe.petOpacity = bounded(input.petOpacity, 20, 100);
    if (input.petScale !== undefined) safe.petScale = bounded(input.petScale, 60, 180);
    if (input.radialMenu) {
      safe.radialMenu = {};
      if (input.radialMenu.opacity !== undefined) safe.radialMenu.opacity = bounded(input.radialMenu.opacity, 40, 100);
      if (input.radialMenu.scale !== undefined) safe.radialMenu.scale = bounded(input.radialMenu.scale, 50, 130);
    }
    return ipcRenderer.invoke(channels.update, safe);
  },
  music: async (command) => {
    if (!["status", "previous", "toggle", "next"].includes(command)) return { available: false, error: "不支持的音乐操作" };
    try {
      const result = await ipcRenderer.invoke(channels.music, command);
      return result && typeof result.available === "boolean" ? result : { available: false, error: "QQ 音乐暂不可用" };
    } catch { return { available: false, error: "无法连接 QQ 音乐，请确认播放器已运行" }; }
  },
  close: () => ipcRenderer.send(channels.close),
  onChanged: (callback) => {
    if (typeof callback !== "function") return () => {};
    const listener = (_event: Electron.IpcRendererEvent, state: RadialMenuState): void => callback(state);
    ipcRenderer.on(channels.changed, listener);
    return () => ipcRenderer.removeListener(channels.changed, listener);
  }
};
contextBridge.exposeInMainWorld("taskPetRadialMenu", Object.freeze(bridge));
