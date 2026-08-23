import path from "node:path";
import type { ProcessInfo, TaskProcessRule } from "../../shared/process-types";

export function normalizeWindowsExecutablePath(value: string): string {
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
  const matches = new Map<number, ProcessInfo>();
  for (const processInfo of processes) {
    if (rules.some((rule) => processMatchesRule(processInfo, rule))) {
      matches.set(processInfo.pid, processInfo);
    }
  }
  return [...matches.values()];
}
