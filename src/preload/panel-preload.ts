/**
 * 任务面板的 sandboxed preload bridge。
 * 把 tasks/processes/runtime 三组最小 API 暴露给 Renderer，实际 SQLite 和系统调用仍留在 Main。
 */
import { contextBridge, ipcRenderer } from "electron";
import type {
  CreateTaskInput,
  HistoryQuery,
  UpdateTaskPatch
} from "../shared/task-schemas";
import type {
  HistoryDay,
  OccurrenceMutationResult,
  Task,
  TaskApiResult,
  TaskListItem
} from "../shared/task-types";
import type {
  RunningProgram,
  RuntimeTaskSnapshot,
  TaskProcessRule
} from "../shared/process-types";
import type { SetProcessRuleInput } from "../shared/task-schemas";
import type {
  AppSettingsSnapshot,
  DataActionResult,
  PanelCommand,
  UpdateAppSettingsInput
} from "../shared/app-settings";

// Sandboxed preloads can load Electron but cannot require arbitrary local modules.
// Keep this closed channel list in sync with main/ipc/task-channels.ts.
const TASK_CHANNELS = Object.freeze({
  listToday: "taskpet:tasks:list-today",
  history: "taskpet:tasks:history",
  create: "taskpet:tasks:create",
  update: "taskpet:tasks:update",
  archive: "taskpet:tasks:archive",
  complete: "taskpet:tasks:complete",
  reopen: "taskpet:tasks:reopen",
  changed: "taskpet:tasks:changed",
  rendererReady: "taskpet:tasks:renderer-ready"
});

const PROCESS_CHANNELS = Object.freeze({
  listRules: "taskpet:process-rules:list",
  setRule: "taskpet:process-rules:set",
  removeRules: "taskpet:process-rules:remove",
  listRunning: "taskpet:processes:list-running",
  pickExecutable: "taskpet:processes:pick-executable",
  runtimeSnapshot: "taskpet:runtime:snapshot",
  runtimeChanged: "taskpet:runtime:changed"
});

const SETTINGS_CHANNELS = Object.freeze({
  get: "taskpet:settings:get",
  update: "taskpet:settings:update",
  openDataDirectory: "taskpet:data:open-directory",
  exportBackup: "taskpet:data:export-backup",
  openGitHub: "taskpet:about:open-github",
  openLicenses: "taskpet:about:open-licenses",
  changed: "taskpet:settings:changed",
  panelCommand: "taskpet:panel:command"
});

function subscribe(callback: () => void): () => void {
  if (typeof callback !== "function") return () => {};
  const listener = (): void => callback();
  ipcRenderer.on(TASK_CHANNELS.changed, listener);
  return () => ipcRenderer.removeListener(TASK_CHANNELS.changed, listener);
}

function subscribeRuntime(
  callback: (snapshots: RuntimeTaskSnapshot[]) => void
): () => void {
  if (typeof callback !== "function") return () => {};
  const listener = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
    if (Array.isArray(payload)) callback(payload as RuntimeTaskSnapshot[]);
  };
  ipcRenderer.on(PROCESS_CHANNELS.runtimeChanged, listener);
  return () => ipcRenderer.removeListener(PROCESS_CHANNELS.runtimeChanged, listener);
}

function subscribeSettings(
  callback: (snapshot: AppSettingsSnapshot) => void
): () => void {
  if (typeof callback !== "function") return () => {};
  const listener = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
    if (payload && typeof payload === "object") callback(payload as AppSettingsSnapshot);
  };
  ipcRenderer.on(SETTINGS_CHANNELS.changed, listener);
  return () => ipcRenderer.removeListener(SETTINGS_CHANNELS.changed, listener);
}

function subscribePanelCommand(callback: (command: PanelCommand) => void): () => void {
  if (typeof callback !== "function") return () => {};
  const listener = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
    if (payload === "open-add-task" || payload === "open-settings") callback(payload);
  };
  ipcRenderer.on(SETTINGS_CHANNELS.panelCommand, listener);
  return () => ipcRenderer.removeListener(SETTINGS_CHANNELS.panelCommand, listener);
}

const taskApi = Object.freeze({
  listToday: (): Promise<TaskApiResult<TaskListItem[]>> => (
    ipcRenderer.invoke(TASK_CHANNELS.listToday)
  ),
  history: (query: HistoryQuery): Promise<TaskApiResult<HistoryDay[]>> => (
    ipcRenderer.invoke(TASK_CHANNELS.history, query)
  ),
  create: (input: CreateTaskInput): Promise<TaskApiResult<Task>> => (
    ipcRenderer.invoke(TASK_CHANNELS.create, input)
  ),
  update: (id: string, patch: UpdateTaskPatch): Promise<TaskApiResult<Task>> => (
    ipcRenderer.invoke(TASK_CHANNELS.update, { id, patch })
  ),
  archive: (id: string): Promise<TaskApiResult<Task>> => (
    ipcRenderer.invoke(TASK_CHANNELS.archive, { id })
  ),
  complete: (occurrenceId: string): Promise<TaskApiResult<OccurrenceMutationResult>> => (
    ipcRenderer.invoke(TASK_CHANNELS.complete, { occurrenceId })
  ),
  reopen: (occurrenceId: string): Promise<TaskApiResult<OccurrenceMutationResult>> => (
    ipcRenderer.invoke(TASK_CHANNELS.reopen, { occurrenceId })
  ),
  rendererReady: (ok: boolean): void => {
    ipcRenderer.send(TASK_CHANNELS.rendererReady, { ok: ok === true });
  },
  onChanged: subscribe
});

const processApi = Object.freeze({
  listRules: (): Promise<TaskApiResult<TaskProcessRule[]>> => (
    ipcRenderer.invoke(PROCESS_CHANNELS.listRules)
  ),
  setRule: (input: SetProcessRuleInput): Promise<TaskApiResult<TaskProcessRule>> => (
    ipcRenderer.invoke(PROCESS_CHANNELS.setRule, input)
  ),
  removeRules: (taskId: string): Promise<TaskApiResult<boolean>> => (
    ipcRenderer.invoke(PROCESS_CHANNELS.removeRules, { id: taskId })
  ),
  listRunning: (): Promise<TaskApiResult<RunningProgram[]>> => (
    ipcRenderer.invoke(PROCESS_CHANNELS.listRunning)
  ),
  pickExecutable: (): Promise<TaskApiResult<RunningProgram | null>> => (
    ipcRenderer.invoke(PROCESS_CHANNELS.pickExecutable)
  )
});

const runtimeApi = Object.freeze({
  // snapshot 用于首次渲染；onChanged 接收后续每秒内存快照。
  snapshot: (): Promise<TaskApiResult<RuntimeTaskSnapshot[]>> => (
    ipcRenderer.invoke(PROCESS_CHANNELS.runtimeSnapshot)
  ),
  onChanged: subscribeRuntime
});

const settingsApi = Object.freeze({
  get: (): Promise<TaskApiResult<AppSettingsSnapshot>> => (
    ipcRenderer.invoke(SETTINGS_CHANNELS.get)
  ),
  update: (input: UpdateAppSettingsInput): Promise<TaskApiResult<AppSettingsSnapshot>> => (
    ipcRenderer.invoke(SETTINGS_CHANNELS.update, input)
  ),
  openDataDirectory: (): Promise<TaskApiResult<DataActionResult>> => (
    ipcRenderer.invoke(SETTINGS_CHANNELS.openDataDirectory)
  ),
  exportBackup: (): Promise<TaskApiResult<DataActionResult>> => (
    ipcRenderer.invoke(SETTINGS_CHANNELS.exportBackup)
  ),
  openGitHub: (): Promise<TaskApiResult<void>> => (
    ipcRenderer.invoke(SETTINGS_CHANNELS.openGitHub)
  ),
  openLicenses: (): Promise<TaskApiResult<void>> => (
    ipcRenderer.invoke(SETTINGS_CHANNELS.openLicenses)
  ),
  onChanged: subscribeSettings
});

const uiApi = Object.freeze({
  onCommand: subscribePanelCommand
});

contextBridge.exposeInMainWorld("taskPet", Object.freeze({
  tasks: taskApi,
  processes: processApi,
  runtime: runtimeApi,
  settings: settingsApi,
  ui: uiApi
}));
