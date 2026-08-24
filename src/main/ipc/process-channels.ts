/**
 * 程序绑定与运行快照的 IPC 频道名。
 * 修改频道时要同步 panel-preload.ts 中的沙箱白名单。
 */
export const PROCESS_CHANNELS = Object.freeze({
  listRules: "taskpet:process-rules:list",
  setRule: "taskpet:process-rules:set",
  removeRules: "taskpet:process-rules:remove",
  listRunning: "taskpet:processes:list-running",
  pickExecutable: "taskpet:processes:pick-executable",
  launchBound: "taskpet:processes:launch-bound",
  runtimeSnapshot: "taskpet:runtime:snapshot",
  runtimeChanged: "taskpet:runtime:changed"
});
