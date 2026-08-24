/**
 * Electron 官方登录启动 API 的小型适配层。
 * 开启与查询必须使用完全相同的 path/args，避免 Tray 与设置页状态漂移。
 */
export interface LoginItemSettingsSnapshot {
  openAtLogin: boolean;
  executableWillLaunchAtLogin?: boolean;
}

export interface LoginItemSettingsOptions {
  path?: string;
  args?: string[];
}

export interface LoginItemSettingsUpdate extends LoginItemSettingsOptions {
  openAtLogin: boolean;
  enabled?: boolean;
  name?: string;
}

export interface LoginItemAppAdapter {
  isPackaged: boolean;
  getLoginItemSettings(options?: LoginItemSettingsOptions): LoginItemSettingsSnapshot;
  setLoginItemSettings(settings: LoginItemSettingsUpdate): void;
}

export interface LoginItemServiceOptions {
  platform?: NodeJS.Platform;
  executablePath?: string;
  appName?: string;
}

export class LoginItemService {
  private readonly platform: NodeJS.Platform;
  private readonly executablePath: string;
  private readonly appName: string;

  constructor(
    private readonly app: LoginItemAppAdapter,
    options: LoginItemServiceOptions = {}
  ) {
    this.platform = options.platform ?? process.platform;
    this.executablePath = options.executablePath ?? process.execPath;
    this.appName = options.appName ?? "TaskPet";
  }

  get supported(): boolean {
    // 开发态不注册 electron.exe；Windows/macOS 安装版使用 Electron 官方能力。
    return this.app.isPackaged
      && (this.platform === "win32" || this.platform === "darwin");
  }

  get enabled(): boolean {
    if (!this.supported) return false;
    const settings = this.app.getLoginItemSettings(this.comparisonOptions());
    if (
      this.platform === "win32"
      && typeof settings.executableWillLaunchAtLogin === "boolean"
    ) {
      return settings.openAtLogin && settings.executableWillLaunchAtLogin;
    }
    return settings.openAtLogin;
  }

  setEnabled(enabled: boolean): boolean {
    if (!this.supported) return false;
    const comparison = this.comparisonOptions();
    this.app.setLoginItemSettings({
      ...comparison,
      openAtLogin: enabled,
      ...(this.platform === "win32" ? { enabled, name: this.appName } : {})
    });
    return this.enabled;
  }

  private comparisonOptions(): LoginItemSettingsOptions {
    return this.platform === "win32"
      ? { path: this.executablePath, args: [] }
      : {};
  }
}
