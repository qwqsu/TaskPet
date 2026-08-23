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

function subscribe(callback: () => void): () => void {
  if (typeof callback !== "function") return () => {};
  const listener = (): void => callback();
  ipcRenderer.on(TASK_CHANNELS.changed, listener);
  return () => ipcRenderer.removeListener(TASK_CHANNELS.changed, listener);
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

contextBridge.exposeInMainWorld("taskPet", Object.freeze({ tasks: taskApi }));
