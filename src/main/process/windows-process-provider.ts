/**
 * Windows 进程枚举适配器。
 * 直接通过 koffi 调用 kernel32，避免每 2~3 秒启动 PowerShell/tasklist 子进程。
 */
import path from "node:path";
import koffi, { type KoffiFunc, type TypeObject } from "koffi";
import type { ProcessInfo } from "../../shared/process-types";
import type { ProcessProvider } from "./process-provider";

const TH32CS_SNAPPROCESS = 0x00000002;
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
const MAX_EXE_NAME = 260;
const MAX_EXECUTABLE_PATH = 32_768;

interface ProcessEntry {
  dwSize: number;
  cntUsage?: number;
  th32ProcessID: number;
  th32DefaultHeapID?: bigint;
  th32ModuleID?: number;
  cntThreads?: number;
  th32ParentProcessID?: number;
  pcPriClassBase?: number;
  dwFlags?: number;
  szExeFile: string;
}

export class WindowsProcessProvider implements ProcessProvider {
  private readonly processEntryType: TypeObject;
  private readonly createSnapshot: KoffiFunc<(flags: number, processId: number) => unknown>;
  private readonly processFirst: KoffiFunc<(snapshot: unknown, entry: ProcessEntry) => boolean>;
  private readonly processNext: KoffiFunc<(snapshot: unknown, entry: ProcessEntry) => boolean>;
  private readonly openProcess: KoffiFunc<(access: number, inherit: boolean, processId: number) => unknown>;
  private readonly queryImageName: KoffiFunc<(
    processHandle: unknown,
    flags: number,
    output: Buffer,
    size: Uint32Array
  ) => boolean>;
  private readonly closeHandle: KoffiFunc<(handle: unknown) => boolean>;

  constructor() {
    if (process.platform !== "win32") {
      throw new Error("WindowsProcessProvider is available only on Windows");
    }

    // PROCESSENTRY32W 的字段布局必须与 Win32 结构一致。
    this.processEntryType = koffi.struct("TASKPET_PROCESSENTRY32W", {
      dwSize: "uint32_t",
      cntUsage: "uint32_t",
      th32ProcessID: "uint32_t",
      th32DefaultHeapID: "uintptr_t",
      th32ModuleID: "uint32_t",
      cntThreads: "uint32_t",
      th32ParentProcessID: "uint32_t",
      pcPriClassBase: "int32_t",
      dwFlags: "uint32_t",
      szExeFile: koffi.array("char16_t", MAX_EXE_NAME, "String")
    });

    // 这里只解析一次函数地址；后续扫描复用这些 native function。
    const kernel32 = koffi.load("kernel32.dll");
    this.createSnapshot = kernel32.func(
      "CreateToolhelp32Snapshot",
      "void *",
      ["uint32_t", "uint32_t"]
    ) as typeof this.createSnapshot;
    this.processFirst = kernel32.func(
      "Process32FirstW",
      "bool",
      ["void *", koffi.inout(koffi.pointer(this.processEntryType))]
    ) as typeof this.processFirst;
    this.processNext = kernel32.func(
      "Process32NextW",
      "bool",
      ["void *", koffi.inout(koffi.pointer(this.processEntryType))]
    ) as typeof this.processNext;
    this.openProcess = kernel32.func(
      "OpenProcess",
      "void *",
      ["uint32_t", "bool", "uint32_t"]
    ) as typeof this.openProcess;
    this.queryImageName = kernel32.func(
      "QueryFullProcessImageNameW",
      "bool",
      ["void *", "uint32_t", "uint16_t *", "uint32_t *"]
    ) as typeof this.queryImageName;
    this.closeHandle = kernel32.func(
      "CloseHandle",
      "bool",
      ["void *"]
    ) as typeof this.closeHandle;
  }

  listProcesses(): ProcessInfo[] {
    // Toolhelp 快照只在内存中遍历，返回后由 ProcessMonitor 立即做目标匹配。
    const snapshot = this.createSnapshot(TH32CS_SNAPPROCESS, 0);
    if (!snapshot || this.isInvalidHandle(snapshot)) {
      throw new Error("CreateToolhelp32Snapshot failed");
    }

    const processes: ProcessInfo[] = [];
    const entry: ProcessEntry = {
      dwSize: koffi.sizeof(this.processEntryType),
      th32ProcessID: 0,
      szExeFile: ""
    };

    try {
      let hasEntry = this.processFirst(snapshot, entry);
      while (hasEntry) {
        const executablePath = this.readExecutablePath(entry.th32ProcessID);
        const executableName = executablePath
          ? path.win32.basename(executablePath)
          : entry.szExeFile;
        if (executableName) {
          processes.push({
            pid: entry.th32ProcessID,
            executableName,
            executablePath
          });
        }
        hasEntry = this.processNext(snapshot, entry);
      }
    } finally {
      this.closeHandle(snapshot);
    }

    return processes;
  }

  private readExecutablePath(processId: number): string | null {
    // 系统进程可能拒绝查询路径；此时仍返回进程名，并允许 process_name 匹配。
    const handle = this.openProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, processId);
    if (!handle) return null;

    try {
      const output = Buffer.alloc(MAX_EXECUTABLE_PATH * 2);
      const size = new Uint32Array([MAX_EXECUTABLE_PATH]);
      if (!this.queryImageName(handle, 0, output, size)) return null;
      return output.toString("utf16le", 0, (size[0] ?? 0) * 2);
    } catch {
      return null;
    } finally {
      this.closeHandle(handle);
    }
  }

  private isInvalidHandle(handle: unknown): boolean {
    try {
      return BigInt.asUintN(64, koffi.address(handle)) === 0xffffffffffffffffn;
    } catch {
      return true;
    }
  }
}
