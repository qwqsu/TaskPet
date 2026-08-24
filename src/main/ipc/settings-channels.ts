/** P4 设置、数据动作和 Main → Panel 固定命令频道。 */
export const SETTINGS_CHANNELS = Object.freeze({
  get: "taskpet:settings:get",
  update: "taskpet:settings:update",
  openDataDirectory: "taskpet:data:open-directory",
  exportBackup: "taskpet:data:export-backup",
  openGitHub: "taskpet:about:open-github",
  openLicenses: "taskpet:about:open-licenses",
  changed: "taskpet:settings:changed",
  panelCommand: "taskpet:panel:command"
});

