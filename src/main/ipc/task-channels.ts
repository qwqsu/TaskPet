/**
 * 任务 CRUD/历史的 IPC 频道名。
 * preload 只能调用这里列出的固定能力，不能向 Renderer 暴露任意命令执行。
 */
export const TASK_CHANNELS = Object.freeze({
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
