/**
 * 纯进程匹配函数，不扫描系统、不修改任务状态。
 * exact_path 与 process_name 分开处理，方便独立测试并避免隐式降级。
 */
import path from "node:path";
import type { ProcessInfo, TaskProcessRule } from "../../shared/process-types";

export function normalizeWindowsExecutablePath(value: string): string {
  // Windows 路径匹配忽略大小写和斜杠差异，但保留完整目录以防同名程序误匹配。
  return path.win32.normalize(value.trim().replaceAll("/", "\\"))
    .replace(/\\+$/, "")
    .toLocaleLowerCase("en-US");
}

export function normalizeProcessName(value: string): string {
  return path.win32.basename(value.trim()).toLocaleLowerCase("en-US");
}

export function processMatchesRule(
  processInfo: ProcessInfo,
  rule: TaskProcessRule
): boolean {
  if (rule.platform !== "win32") return false;

  if (rule.matchMode === "exact_path") {
    return Boolean(
      processInfo.executablePath
      && rule.executablePath
      && normalizeWindowsExecutablePath(processInfo.executablePath)
        === normalizeWindowsExecutablePath(rule.executablePath)
    );
  }

  return Boolean(
    rule.executableName
    && normalizeProcessName(processInfo.executableName)
      === normalizeProcessName(rule.executableName)
  );
}

export function matchProcessesForRules(
  processes: readonly ProcessInfo[],
  rules: readonly TaskProcessRule[]
): ProcessInfo[] {
  // PID Map 只负责去重；RuntimeTracker 最终按 task 计算 wall-clock，不按 PID 叠加。
  const matches = new Map<number, ProcessInfo>();
  for (const processInfo of processes) {
    if (rules.some((rule) => processMatchesRule(processInfo, rule))) {
      matches.set(processInfo.pid, processInfo);
    }
  }
  return [...matches.values()];
}
