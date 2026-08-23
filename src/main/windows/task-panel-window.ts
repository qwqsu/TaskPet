/**
 * 任务面板 BrowserWindow 的集中安全配置。
 * 面板是普通不透明窗口，与透明桌宠窗口分离，便于输入和获得焦点。
 */
import type { BrowserWindowConstructorOptions, NativeImage, Rectangle } from "electron";

export const TASK_PANEL_WIDTH = 420;
export const TASK_PANEL_HEIGHT = 680;

export interface TaskPanelWindowOptions {
  preloadPath: string;
  icon?: NativeImage;
  savedBounds?: Partial<Rectangle>;
}

function finiteCoordinate(value: number | undefined): number | undefined {
  return Number.isFinite(value) ? Math.round(value as number) : undefined;
}

export function createTaskPanelWindowOptions(
  options: TaskPanelWindowOptions
): BrowserWindowConstructorOptions {
  if (!options.preloadPath) throw new TypeError("preloadPath is required");

  const windowOptions: BrowserWindowConstructorOptions = {
    title: "TaskPet 任务",
    width: TASK_PANEL_WIDTH,
    height: TASK_PANEL_HEIGHT,
    minWidth: 360,
    minHeight: 520,
    x: finiteCoordinate(options.savedBounds?.x),
    y: finiteCoordinate(options.savedBounds?.y),
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#f5f2ea",
    webPreferences: {
      preload: options.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  };

  if (options.icon) windowOptions.icon = options.icon;
  return windowOptions;
}
