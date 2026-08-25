/**
 * Electron 官方登录启动 API 的小型适配层。
 * 开启与查询必须使用完全相同的 path/args，避免 Tray 与设置页状态漂移。
 */
import type { AutoStartStatus } from "../../shared/app-settings";

export interface LoginItemSettingsSnapshot {
  openAtLogin: boolean;
  executableWillLaunchAtLogin?: boolean;
  launchItems?: Array<{
    name: string;
    path: string;
    args: string[];
    scope: "user" | "machine";
    enabled: boolean;
  }>;
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
  verificationDelayMs?: number;
  wait?: (delayMs: number) => Promise<void>;
}

export class LoginItemService {
  private readonly platform: NodeJS.Platform;
  private readonly executablePath: string;
  private readonly appName: string;
  private readonly verificationDelayMs: number;
  private readonly wait: (delayMs: number) => Promise<void>;

  constructor(
    private readonly app: LoginItemAppAdapter,
    options: LoginItemServiceOptions = {}
  ) {
    this.platform = options.platform ?? process.platform;
    this.executablePath = options.executablePath ?? process.execPath;
    this.appName = options.appName ?? "TaskPet";
    this.verificationDelayMs = Math.max(0, options.verificationDelayMs ?? 200);
    this.wait = options.wait ?? ((delayMs) => new Promise((resolve) => {
      setTimeout(resolve, delayMs);
    }));
  }

  get supported(): boolean {
    // 开发态不注册 electron.exe；Windows/macOS 安装版使用 Electron 官方能力。
    return this.app.isPackaged
      && (this.platform === "win32" || this.platform === "darwin");
  }

  get status(): AutoStartStatus {
    if (!this.supported) {
      return {
        supported: false,
        registered: false,
        willLaunch: null,
        blockedByWindows: false
      };
    }

    const snapshot = this.app.getLoginItemSettings(this.comparisonOptions());
    const matchingLaunchItem = snapshot.launchItems?.find((item) => (
      this.sameWindowsPath(item.path, this.executablePath)
      && this.sameArgs(item.args, [])
    ));
    // Electron 28 在显式 name 与 AppUserModelId 不同时可能让顶层
    // openAtLogin=false，但同一原生快照的 launchItems 已包含精确条目。
    const registered = snapshot.openAtLogin === true || Boolean(matchingLaunchItem);
    const willLaunch = this.platform === "win32"
      && typeof snapshot.executableWillLaunchAtLogin === "boolean"
      ? snapshot.executableWillLaunchAtLogin
      : typeof matchingLaunchItem?.enabled === "boolean"
        ? matchingLaunchItem.enabled
        : null;
    return {
      supported: true,
      registered,
      willLaunch,
      blockedByWindows: registered && willLaunch === false
    };
  }

  async setEnabled(enabled: boolean): Promise<AutoStartStatus> {
    if (!this.supported) return this.status;
    const comparison = this.comparisonOptions();
    this.app.setLoginItemSettings({
      ...comparison,
      openAtLogin: enabled,
      ...(this.platform === "win32" ? { enabled, name: this.appName } : {})
    });
    if (this.verificationDelayMs > 0) await this.wait(this.verificationDelayMs);

    const status = this.status;
    if (status.registered !== enabled) {
      throw new Error(enabled
        ? "Windows 未能注册 TaskPet 启动项"
        : "Windows 未能移除 TaskPet 启动项");
    }
    // willLaunch=false 仅表示 Windows Startup Apps 可能禁用了该条目，
    // openAtLogin=true 已足以证明注册成功，不能把它误报为写入失败。
    return status;
  }

  private comparisonOptions(): LoginItemSettingsOptions {
    return this.platform === "win32"
      ? { path: this.executablePath, args: [] }
      : {};
  }

  private sameWindowsPath(left: string, right: string): boolean {
    return left.replaceAll("/", "\\").toLocaleLowerCase("en-US")
      === right.replaceAll("/", "\\").toLocaleLowerCase("en-US");
  }

  private sameArgs(left: string[], right: string[]): boolean {
    return left.length === right.length
      && left.every((argument, index) => argument === right[index]);
  }
}
