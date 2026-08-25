/**
 * 系统进程来源的跨平台接口。
 * 当前 Windows 有原生实现，其他平台返回空列表以保证应用仍能启动。
 */
import type { ProcessInfo, RunningProgram } from "../../shared/process-types";

export interface ProcessProvider {
  listProcesses(): ProcessInfo[] | Promise<ProcessInfo[]>;
}

export class EmptyProcessProvider implements ProcessProvider {
  listProcesses(): ProcessInfo[] {
    return [];
  }
}

export class LazyProcessProvider implements ProcessProvider {
  private provider: ProcessProvider | null = null;

  constructor(private readonly createProvider: () => ProcessProvider) {}

  listProcesses(): ProcessInfo[] | Promise<ProcessInfo[]> {
    // 没有监控目标时 ProcessMonitor 不会调用这里，因此也不会加载 Koffi/native addon。
    this.provider ??= this.createProvider();
    return this.provider.listProcesses();
  }
}

export function createPlatformProcessProvider(): ProcessProvider {
  if (process.platform !== "win32") return new EmptyProcessProvider();
  // Windows 也延迟到第一次真实扫描，空闲启动不解析 Koffi 和 kernel32 函数地址。
  return new LazyProcessProvider(() => {
    const {
      WindowsProcessProvider
    } = require("./windows-process-provider") as typeof import("./windows-process-provider");
    return new WindowsProcessProvider();
  });
}

export function toRunningPrograms(processes: readonly ProcessInfo[]): RunningProgram[] {
  // 同一路径/名称的多个 PID 合并成一个选择项，但保留 pidCount 给用户解释。
  const groups = new Map<string, RunningProgram>();

  for (const processInfo of processes) {
    const pathKey = processInfo.executablePath?.replaceAll("/", "\\").toLocaleLowerCase("en-US") ?? "";
    const nameKey = processInfo.executableName.toLocaleLowerCase("en-US");
    const key = `${pathKey}\u0000${nameKey}`;
    const existing = groups.get(key);
    if (existing) {
      existing.pidCount += 1;
      continue;
    }

    groups.set(key, {
      executableName: processInfo.executableName,
      executablePath: processInfo.executablePath,
      pidCount: 1
    });
  }

  return [...groups.values()].sort((left, right) => {
    const byName = left.executableName.localeCompare(right.executableName, "en-US", {
      sensitivity: "base"
    });
    if (byName !== 0) return byName;
    return (left.executablePath ?? "").localeCompare(right.executablePath ?? "", "en-US", {
      sensitivity: "base"
    });
  });
}
