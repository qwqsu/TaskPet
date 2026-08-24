/** 独立设置窗口的最小安全 bridge。 */
import { contextBridge, ipcRenderer } from "electron";
import type {
  AppSettingsSnapshot,
  DataActionResult,
  UpdateAppSettingsInput
} from "../shared/app-settings";
import type { TaskApiResult } from "../shared/task-types";

const SETTINGS_CHANNELS = Object.freeze({
  get: "taskpet:settings:get",
  update: "taskpet:settings:update",
  openDataDirectory: "taskpet:data:open-directory",
  exportBackup: "taskpet:data:export-backup",
  openStartupApps: "taskpet:settings:open-startup-apps",
  openGitHub: "taskpet:about:open-github",
  openLicenses: "taskpet:about:open-licenses",
  changed: "taskpet:settings:changed",
  rendererReady: "taskpet:settings:renderer-ready"
});

function subscribeSettings(
  callback: (snapshot: AppSettingsSnapshot) => void
): () => void {
  if (typeof callback !== "function") return () => {};
  const listener = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
    if (payload && typeof payload === "object") {
      callback(payload as AppSettingsSnapshot);
    }
  };
  ipcRenderer.on(SETTINGS_CHANNELS.changed, listener);
  return () => ipcRenderer.removeListener(SETTINGS_CHANNELS.changed, listener);
}

contextBridge.exposeInMainWorld("taskPetSettings", Object.freeze({
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
  openStartupApps: (): Promise<TaskApiResult<void>> => (
    ipcRenderer.invoke(SETTINGS_CHANNELS.openStartupApps)
  ),
  openGitHub: (): Promise<TaskApiResult<void>> => (
    ipcRenderer.invoke(SETTINGS_CHANNELS.openGitHub)
  ),
  openLicenses: (): Promise<TaskApiResult<void>> => (
    ipcRenderer.invoke(SETTINGS_CHANNELS.openLicenses)
  ),
  rendererReady: (ok: boolean): void => {
    ipcRenderer.send(SETTINGS_CHANNELS.rendererReady, { ok: ok === true });
  },
  onChanged: subscribeSettings
}));
