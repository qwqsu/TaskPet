/** 通用播放器协调器。目标来自 Main 文件选择器，媒体命令只匹配该播放器的精确身份。 */
import { win32 } from "node:path";
import type { MusicBinding } from "../../shared/music-settings";
import { QqMusicService, type QqMusicCommand, type QqMusicResult } from "./qq-music-service";

export interface MusicResult extends QqMusicResult {
  launched?: boolean;
  needsBinding?: boolean;
  message?: string;
}
interface MediaTransport {
  execute(command: QqMusicCommand): Promise<QqMusicResult>;
  dispose(): void;
}
export interface MusicServiceOptions {
  binding: () => MusicBinding | null;
  openPath: (target: string) => Promise<string>;
  validatePath: (target: string) => Promise<string>;
  isRunning: (executablePath: string) => Promise<boolean>;
  createTransport?: (identityPattern?: string) => MediaTransport;
  wait?: () => Promise<void>;
}
function regexEscape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
export function musicIdentityPattern(executablePath: string): string {
  // Windows GSMTC 可能返回完整 DOS 路径或 EXE 名称；不接受子串、未知 AUMID。
  const full = win32.normalize(executablePath);
  return `\\A(?:${regexEscape(full)}|${regexEscape(win32.basename(full))})\\z`;
}

export class MusicService {
  private transport: MediaTransport | null = null;
  private targetKey: string | null = null;
  private busy = false;
  private disposed = false;
  constructor(private readonly options: MusicServiceOptions) {}

  private media(binding: MusicBinding | null): MediaTransport {
    const key = binding?.executablePath.toLowerCase() ?? "legacy-qq";
    if (!this.transport || key !== this.targetKey) {
      this.transport?.dispose();
      this.targetKey = key;
      this.transport = this.options.createTransport?.(binding ? musicIdentityPattern(binding.executablePath) : undefined)
        ?? new QqMusicService({ identityPattern: binding ? musicIdentityPattern(binding.executablePath) : undefined,
          executablePath: binding?.executablePath });
    }
    return this.transport;
  }

  async execute(command: QqMusicCommand | "launch-play"): Promise<MusicResult> {
    if (this.disposed) return {available: false, error: "音乐服务已关闭"};
    if (this.busy) return {available: false, error: "音乐操作正在进行，本次请求未发送"};
    this.busy = true;
    try {
      const binding = this.options.binding();
      if (command === "launch-play" && !binding) {
        return {available: false, needsBinding: true, error: "请先在设置 → 轮盘菜单的菜单项中编辑音乐入口"};
      }
      const transport = this.media(binding);
      const generic = (result: QqMusicResult): MusicResult => ({...result,
        ...(result.error ? {error: result.error.replace(/\s*QQ 音乐/g, "播放器")} : {})});
      if (command !== "launch-play") return generic(await transport.execute(command));
      const target = binding!;
      // 即使已有媒体会话，也先验证绑定仍然存在，避免悄悄使用失效路径。
      const path = await this.options.validatePath(target.path);
      const before = await transport.execute("status");
      if (before.error && /多个/.test(before.error)) return generic(before);
      if (before.playing === true) return {...before, message: "播放器正在播放"};
      let launched = false;
      if (!before.available && !await this.options.isRunning(target.executablePath)) {
        const error = await this.options.openPath(path);
        if (error) throw new Error("无法启动播放器，请重新绑定路径");
        launched = true;
        await (this.options.wait?.() ?? new Promise(resolve => setTimeout(resolve, 800)));
      }
      if (this.disposed) return {available: false, launched, error: "音乐服务已关闭"};
      if (before.error) return {...generic(before), launched,
        error: `播放器${launched ? "已启动" : "启动状态已检查"}，但无法读取系统媒体会话，请在播放器中手动播放`};
      // 使用 TryPlayAsync，状态未知时也不会切换成暂停；不自动重发已发送的媒体命令。
      const result = generic(await transport.execute("play"));
      if (!result.available) return {...result, launched, error: result.error ?? "播放器已启动，但无法通过系统开始播放，请在播放器中手动播放"};
      return {...result, launched, message: result.playing === true ? "播放器正在播放"
        : "系统已接受播放请求，尚未确认播放状态，请在播放器中确认"};
    } catch (error) {
      return {available: false, error: error instanceof Error ? error.message : "音乐操作失败"};
    } finally { this.busy = false; }
  }

  dispose(): void { this.disposed = true; this.transport?.dispose(); }
}
