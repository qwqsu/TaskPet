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

contextBridge.exposeInMainWorld("taskPet", Object.freeze({
  tasks: taskApi,
  processes: processApi,
  runtime: runtimeApi
}));
