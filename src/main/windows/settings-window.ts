/** 独立设置窗口的安全 BrowserWindow 配置。 */
import type { BrowserWindowConstructorOptions, NativeImage } from "electron";

export interface SettingsWindowOptions {
  preloadPath: string;
  icon?: NativeImage;
}

export function createSettingsWindowOptions(
  options: SettingsWindowOptions
): BrowserWindowConstructorOptions {
  if (!options.preloadPath) throw new TypeError("preloadPath is required");

  const windowOptions: BrowserWindowConstructorOptions = {
    title: "TaskPet 设置",
    width: 1080,
    height: 720,
    minWidth: 820,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#f8f8fb",
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
