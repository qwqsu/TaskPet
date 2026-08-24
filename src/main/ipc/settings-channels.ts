/** 独立设置窗口的数据、备份和关于频道。 */
export const SETTINGS_CHANNELS = Object.freeze({
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
