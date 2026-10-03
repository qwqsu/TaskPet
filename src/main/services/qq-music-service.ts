import { spawn, type ChildProcess } from "node:child_process";
import { win32 } from "node:path";
import { createQqMusicHelperScript } from "./qq-music-helper";

export type QqMusicCommand = "status" | "previous" | "toggle" | "next";
export interface QqMusicResult {
  available: boolean;
  playing?: boolean;
  error?: string;
}

export interface QqMusicServiceOptions {
  platform?: NodeJS.Platform;
  timeoutMs?: number;
  /** Dependency injection for tests; production uses the system PowerShell. */
  spawnHelper?: typeof spawn;
}

/** One targeted GSMTC request per call. No global keys, queues, or retries.
 * An error after dispatch can mean an unknown outcome: callers must not retry
 * automatically. Concurrent status calls share the pending snapshot. Concurrent
 * commands are NOT sent; their busy result preserves the observed availability.
 */
export class QqMusicService {
  private readonly platform: NodeJS.Platform;
  private readonly timeoutMs: number;
  private readonly spawnHelper: typeof spawn;
  private disposed = false;
  private pending?: { cancel: () => void; result: Promise<QqMusicResult> };

  constructor(options: QqMusicServiceOptions = {}) {
    this.platform = options.platform ?? process.platform;
    const timeout = options.timeoutMs ?? 7000;
    this.timeoutMs = Number.isFinite(timeout) ? Math.min(15000, Math.max(1, timeout)) : 7000;
    this.spawnHelper = options.spawnHelper ?? spawn;
  }

  async execute(command: QqMusicCommand): Promise<QqMusicResult> {
    if (this.disposed) return { available: false, error: "QQ 音乐控制服务已关闭。" };
    if (!["status", "previous", "toggle", "next"].includes(command)) {
      return { available: false, error: "不支持此 QQ 音乐操作。" };
    }
    if (this.platform !== "win32") return { available: false };
    if (this.pending) {
      // Wait only for the existing bounded operation, never enqueue a command.
      // In particular, busy must not look like an absent player to the UI.
      const result = await this.pending.result;
      if (command === "status" || this.disposed) return result;
      return { ...result, error: "QQ 音乐正在处理其他请求，本次操作未发送，请稍后再试。" };
    }

    return new Promise((resolve) => {
      let child: ChildProcess | undefined;
      let settled = false;
      let output = "";
      let outputBytes = 0;
      const finish = (result: QqMusicResult, kill = false) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (kill && child) {
          // The helper launches no descendants. On Windows kill terminates it.
          try { child.kill(); } catch { /* Still settle callers if termination fails. */ }
        }
        if (this.pending === pending) this.pending = undefined;
        completePending(result);
        resolve(result);
      };
      let completePending!: (result: QqMusicResult) => void;
      const pending = {
        result: new Promise<QqMusicResult>((complete) => { completePending = complete; }),
        cancel: () => finish({ available: false, error: "QQ 音乐控制服务已关闭，尚未完成的操作结果无法确认。" }, true)
      };
      const timer = setTimeout(() => finish({
        available: false, error: "QQ 音乐响应超时，操作结果无法确认。"
      }, true), this.timeoutMs);
      this.pending = pending;

      try {
        const executable = win32.join(process.env.SystemRoot ?? "C:\\Windows",
          "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
        child = this.spawnHelper(executable, [
          "-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand",
          Buffer.from(createQqMusicHelperScript(command), "utf16le").toString("base64")
        ], { windowsHide: true, shell: false, stdio: ["ignore", "pipe", "pipe"] });
        child.stdout?.setEncoding("utf8");
        child.stdout?.on("data", (chunk: string) => {
          if (settled) return;
          outputBytes += Buffer.byteLength(chunk);
          if (outputBytes > 16384) {
            finish({ available: false, error: "QQ 音乐返回的数据过多，已停止读取。" }, true);
          } else {
            output += chunk;
          }
        });
        // Drain stderr but never expose unbounded shell diagnostics to the UI.
        child.stderr?.on("data", () => {});
        child.stdout?.on("error", () => finish({ available: false, error: "无法读取 QQ 音乐的响应。" }, true));
        child.stderr?.on("error", () => finish({ available: false, error: "无法读取 QQ 音乐的响应。" }, true));
        child.on("error", () => finish({ available: false, error: "无法运行 QQ 音乐控制程序。" }, true));
        child.on("close", (code) => {
          if (settled) return;
          if (code !== 0) {
            finish({ available: false, error: "QQ 音乐控制程序异常退出，操作结果无法确认。" });
            return;
          }
          try {
            const value: unknown = JSON.parse(output.trim());
            if (!value || typeof value !== "object" || !("available" in value)
              || typeof value.available !== "boolean") throw new Error("Invalid result");
            const result = value as Record<string, unknown>;
            if ((result.playing !== undefined && typeof result.playing !== "boolean")
              || (result.error !== undefined && (typeof result.error !== "string" || !result.error.trim()))) {
              throw new Error("Invalid result");
            }
            if (result.available && command !== "status" && result.acknowledged !== true && !result.error) {
              finish({ available: true, error: "Windows 未确认 QQ 音乐操作成功。" });
              return;
            }
            finish({
              available: result.available as boolean,
              ...(result.available && typeof result.playing === "boolean" ? { playing: result.playing } : {}),
              ...(typeof result.error === "string" ? { error: result.error.slice(0, 500) } : {})
            });
          } catch {
            finish({ available: false, error: "QQ 音乐返回的数据格式异常。" });
          }
        });
      } catch {
        finish({ available: false, error: "无法启动 QQ 音乐控制程序。" }, true);
      }
    });
  }

  dispose(): void {
    this.disposed = true;
    this.pending?.cancel();
  }
}
