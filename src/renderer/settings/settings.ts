/** 独立设置页 Renderer；只渲染固定设置并调用 preload 白名单。 */
(() => {
type PetSize = "large" | "normal" | "small";
type PetMouseAction =
  | "open-panel"
  | "quick-add"
  | "open-settings"
  | "toggle-monitoring"
  | "recall-pet"
  | "quit"
  | "none";

interface PetMouseBindings {
  leftClick: PetMouseAction;
  doubleClick: PetMouseAction;
  rightClick: PetMouseAction;
}

interface AppSettingsSnapshot {
  autoStart: {
    supported: boolean;
    registered: boolean;
    willLaunch: boolean | null;
    blockedByWindows: boolean;
  };
  petSize: PetSize;
  alwaysOnTop: boolean;
  mouseBindings: PetMouseBindings;
  activePetKey: string | null;
  pets: Array<{
    key: string;
    displayName: string;
    description: string;
    spritesheetUrl: string;
    frame: { width: number; height: number; columns: number; rows: number };
  }>;
  dataDirectory: string;
  appName: string;
  version: string;
  githubUrl: string;
}

interface DataActionResult {
  canceled: boolean;
  filePath: string | null;
}

interface ImportPetResult {
  canceled: boolean;
  petKey: string | null;
  settings: AppSettingsSnapshot;
}

type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

interface SettingsBridge {
  get(): Promise<ApiResult<AppSettingsSnapshot>>;
  update(input: {
    autoStart?: boolean;
    petSize?: PetSize;
    alwaysOnTop?: boolean;
    mouseBindings?: PetMouseBindings;
    activePetKey?: string;
  }): Promise<ApiResult<AppSettingsSnapshot>>;
  importPetZip(): Promise<ApiResult<ImportPetResult>>;
  importDroppedPetZip(input: {
    fileName: string;
    bytes: Uint8Array;
  }): Promise<ApiResult<ImportPetResult>>;
  importPetFolder(): Promise<ApiResult<ImportPetResult>>;
  openPetDex(): Promise<ApiResult<void>>;
  openPetDexCreate(): Promise<ApiResult<void>>;
  openDataDirectory(): Promise<ApiResult<DataActionResult>>;
  exportBackup(): Promise<ApiResult<DataActionResult>>;
  openStartupApps(): Promise<ApiResult<void>>;
  openGitHub(): Promise<ApiResult<void>>;
  openLicenses(): Promise<ApiResult<void>>;
  rendererReady(ok: boolean): void;
  onChanged(callback: (snapshot: AppSettingsSnapshot) => void): () => void;
}

interface SettingsWindow extends Window {
  taskPetSettings: SettingsBridge;
}

const ACTION_OPTIONS: ReadonlyArray<{ value: PetMouseAction; label: string }> = [
  { value: "open-panel", label: "打开 / 关闭任务面板" },
  { value: "quick-add", label: "快速添加任务" },
  { value: "open-settings", label: "打开 / 关闭设置" },
  { value: "toggle-monitoring", label: "暂停 / 恢复任务监控" },
  { value: "recall-pet", label: "召回桌宠" },
  { value: "quit", label: "退出 TaskPet" },
  { value: "none", label: "无操作" }
];

function elementById<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing settings element: ${id}`);
  return element as T;
}

function unwrap<T>(result: ApiResult<T>): T {
  if (result.ok) return result.data;
  throw new Error(result.error.message);
}

const settingsApi = (window as unknown as SettingsWindow).taskPetSettings;
const status = elementById<HTMLParagraphElement>("settingsStatus");
const autoStartToggle = elementById<HTMLInputElement>("autoStartToggle");
const autoStartHint = elementById<HTMLElement>("autoStartHint");
const openStartupAppsButton = elementById<HTMLButtonElement>("openStartupAppsButton");
const petSelect = elementById<HTMLSelectElement>("petSelect");
const currentPetPreview = elementById<HTMLElement>("currentPetPreview");
const currentPetSpriteViewport = elementById<HTMLElement>("currentPetSpriteViewport");
const currentPetSprite = elementById<HTMLImageElement>("currentPetSprite");
const currentPetName = elementById<HTMLElement>("currentPetName");
const currentPetDescription = elementById<HTMLElement>("currentPetDescription");
const customPetDialog = elementById<HTMLDialogElement>("customPetDialog");
const petZipDropZone = elementById<HTMLElement>("petZipDropZone");
const selectPetZipButton = elementById<HTMLButtonElement>("selectPetZipButton");
const selectPetFolderButton = elementById<HTMLButtonElement>("selectPetFolderButton");
const alwaysOnTopToggle = elementById<HTMLInputElement>("alwaysOnTopToggle");
const leftClickAction = elementById<HTMLSelectElement>("leftClickAction");
const doubleClickAction = elementById<HTMLSelectElement>("doubleClickAction");
const rightClickAction = elementById<HTMLSelectElement>("rightClickAction");
const dataDirectoryPath = elementById<HTMLElement>("dataDirectoryPath");
const aboutAppName = elementById<HTMLElement>("aboutAppName");
const aboutVersion = elementById<HTMLElement>("aboutVersion");
const STATUS_VISIBLE_MS = 5_000;
const MAX_PET_ZIP_BYTES = 50 * 1024 * 1024;
let currentSettings: AppSettingsSnapshot | null = null;
let statusTimer: number | null = null;
let petImportBusy = false;

function setStatus(message = "", tone: "error" | "success" = "error"): void {
  if (statusTimer !== null) window.clearTimeout(statusTimer);
  statusTimer = null;
  status.textContent = message;
  status.hidden = message.length === 0;
  status.classList.toggle("error", message.length > 0 && tone === "error");
  status.classList.toggle("success", message.length > 0 && tone === "success");
  status.setAttribute("role", tone === "error" ? "alert" : "status");
  if (message.length > 0) {
    statusTimer = window.setTimeout(() => setStatus(), STATUS_VISIBLE_MS);
  }
}

function fillActionSelect(select: HTMLSelectElement): void {
  select.replaceChildren(...ACTION_OPTIONS.map(({ value, label }) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    return option;
  }));
}

function renderCurrentPetPreview(snapshot: AppSettingsSnapshot): void {
  const pet = snapshot.pets.find((candidate) => candidate.key === snapshot.activePetKey)
    ?? snapshot.pets[0];
  currentPetPreview.hidden = !pet;
  if (!pet) return;

  currentPetName.textContent = pet.displayName;
  currentPetDescription.textContent = pet.description || "暂无描述";
  currentPetSprite.src = pet.spritesheetUrl;
  const previewHeight = 86;
  const scale = previewHeight / pet.frame.height;
  currentPetSpriteViewport.style.width = `${Math.round(pet.frame.width * scale)}px`;
  currentPetSpriteViewport.style.height = `${previewHeight}px`;
  currentPetSprite.style.width = `${Math.round(
    pet.frame.width * pet.frame.columns * scale
  )}px`;
  currentPetSprite.style.height = `${Math.round(
    pet.frame.height * pet.frame.rows * scale
  )}px`;
}

function render(snapshot: AppSettingsSnapshot): void {
  currentSettings = snapshot;
  autoStartToggle.checked = snapshot.autoStart.registered;
  autoStartToggle.disabled = !snapshot.autoStart.supported;
  autoStartHint.classList.toggle("warning", snapshot.autoStart.blockedByWindows);
  autoStartHint.textContent = !snapshot.autoStart.supported
    ? "开机自动启动仅在 TaskPet Windows 安装版中可用"
    : snapshot.autoStart.blockedByWindows
      ? "TaskPet 已添加到 Windows 启动项，但 Windows 当前可能禁用了该启动项。"
      : "进入 Windows 桌面后自动启动 TaskPet";
  openStartupAppsButton.hidden = !snapshot.autoStart.blockedByWindows;
  alwaysOnTopToggle.checked = snapshot.alwaysOnTop;

  petSelect.replaceChildren(...snapshot.pets.map((pet) => {
    const option = document.createElement("option");
    option.value = pet.key;
    option.textContent = pet.displayName;
    return option;
  }));
  petSelect.disabled = snapshot.pets.length === 0;
  if (snapshot.activePetKey) petSelect.value = snapshot.activePetKey;
  renderCurrentPetPreview(snapshot);

  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-pet-size]")) {
    const active = button.dataset.petSize === snapshot.petSize;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }

  leftClickAction.value = snapshot.mouseBindings.leftClick;
  doubleClickAction.value = snapshot.mouseBindings.doubleClick;
  rightClickAction.value = snapshot.mouseBindings.rightClick;
  dataDirectoryPath.textContent = snapshot.dataDirectory;
  dataDirectoryPath.title = snapshot.dataDirectory;
  aboutAppName.textContent = snapshot.appName;
  // snapshot.version 来自主进程 app.getVersion()，其唯一维护入口是根目录 package.json。
  aboutVersion.textContent = `v${snapshot.version}`;
  elementById<HTMLButtonElement>("openGitHubButton").title = snapshot.githubUrl;
}

async function updateSetting(
  input: Parameters<SettingsBridge["update"]>[0]
): Promise<void> {
  try {
    setStatus();
    render(unwrap(await settingsApi.update(input)));
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "无法更新设置");
    if (currentSettings) render(currentSettings);
  }
}

function currentBindings(): PetMouseBindings {
  return {
    leftClick: leftClickAction.value as PetMouseAction,
    doubleClick: doubleClickAction.value as PetMouseAction,
    rightClick: rightClickAction.value as PetMouseAction
  };
}

for (const select of [leftClickAction, doubleClickAction, rightClickAction]) {
  fillActionSelect(select);
  select.addEventListener("change", () => {
    void updateSetting({ mouseBindings: currentBindings() });
  });
}

autoStartToggle.addEventListener("change", () => {
  void updateSetting({ autoStart: autoStartToggle.checked });
});
openStartupAppsButton.addEventListener("click", () => {
  void settingsApi.openStartupApps().then(unwrap).catch((error: unknown) => {
    setStatus(error instanceof Error ? error.message : "无法打开 Windows 启动应用设置");
  });
});
alwaysOnTopToggle.addEventListener("change", () => {
  void updateSetting({ alwaysOnTop: alwaysOnTopToggle.checked });
});
petSelect.addEventListener("change", () => {
  if (petSelect.value) void updateSetting({ activePetKey: petSelect.value });
});

function closeCustomPetDialog(): void {
  if (customPetDialog.open) customPetDialog.close();
}

elementById<HTMLButtonElement>("openCustomPetDialogButton").addEventListener("click", () => {
  if (!customPetDialog.open) customPetDialog.showModal();
  petZipDropZone.focus();
});
elementById<HTMLButtonElement>("closeCustomPetDialogButton").addEventListener(
  "click",
  closeCustomPetDialog
);
elementById<HTMLButtonElement>("cancelCustomPetButton").addEventListener(
  "click",
  closeCustomPetDialog
);

function setPetImportBusy(busy: boolean): void {
  petImportBusy = busy;
  petZipDropZone.classList.toggle("importing", busy);
  petZipDropZone.setAttribute("aria-busy", String(busy));
  selectPetZipButton.disabled = busy;
  selectPetFolderButton.disabled = busy;
}

function finishPetImport(result: ImportPetResult): void {
  if (result.canceled) return;
  render(result.settings);
  closeCustomPetDialog();
  const importedPet = result.settings.pets.find((pet) => pet.key === result.petKey);
  setStatus(`桌宠“${importedPet?.displayName ?? "自定义桌宠"}”已导入并启用`, "success");
}

async function runPetImport(
  operation: () => Promise<ApiResult<ImportPetResult>>,
  fallbackMessage: string
): Promise<void> {
  if (petImportBusy) return;
  setPetImportBusy(true);
  try {
    setStatus();
    finishPetImport(unwrap(await operation()));
  } catch (error) {
    setStatus(error instanceof Error ? error.message : fallbackMessage);
  } finally {
    setPetImportBusy(false);
  }
}

async function importDroppedZip(file: File): Promise<void> {
  if (!file.name.toLocaleLowerCase("en-US").endsWith(".zip")) {
    setStatus("请拖入 .zip 宠物包");
    return;
  }
  if (file.size === 0 || file.size > MAX_PET_ZIP_BYTES) {
    setStatus("宠物 ZIP 为空或超过 50 MB");
    return;
  }
  await runPetImport(async () => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    return settingsApi.importDroppedPetZip({ fileName: file.name, bytes });
  }, "无法导入拖拽的宠物 ZIP");
}

selectPetZipButton.addEventListener("click", () => {
  void runPetImport(() => settingsApi.importPetZip(), "无法导入宠物 ZIP");
});
selectPetFolderButton.addEventListener("click", () => {
  void runPetImport(() => settingsApi.importPetFolder(), "无法导入宠物文件夹");
});
petZipDropZone.addEventListener("click", () => selectPetZipButton.click());
petZipDropZone.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    selectPetZipButton.click();
  }
});
for (const eventName of ["dragenter", "dragover"] as const) {
  petZipDropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    if (!petImportBusy) petZipDropZone.classList.add("drag-active");
  });
}
petZipDropZone.addEventListener("dragleave", (event) => {
  if (!(event.relatedTarget instanceof Node) || !petZipDropZone.contains(event.relatedTarget)) {
    petZipDropZone.classList.remove("drag-active");
  }
});
petZipDropZone.addEventListener("drop", (event) => {
  event.preventDefault();
  event.stopPropagation();
  petZipDropZone.classList.remove("drag-active");
  const files = event.dataTransfer?.files;
  if (!files || files.length !== 1) {
    setStatus("请一次只拖入一个 pet.zip");
    return;
  }
  void importDroppedZip(files[0]!);
});
window.addEventListener("dragover", (event) => event.preventDefault());
window.addEventListener("drop", (event) => {
  event.preventDefault();
  petZipDropZone.classList.remove("drag-active");
});

elementById<HTMLButtonElement>("openPetDexButton").addEventListener("click", () => {
  void settingsApi.openPetDex().then(unwrap).catch((error: unknown) => {
    setStatus(error instanceof Error ? error.message : "无法打开 PetDex");
  });
});
elementById<HTMLButtonElement>("openPetDexCreateButton").addEventListener("click", () => {
  void settingsApi.openPetDexCreate().then(unwrap).catch((error: unknown) => {
    setStatus(error instanceof Error ? error.message : "无法打开 Hatch Pet 创建页");
  });
});
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-pet-size]")) {
  button.addEventListener("click", () => {
    const size = button.dataset.petSize;
    if (size === "large" || size === "normal" || size === "small") {
      void updateSetting({ petSize: size });
    }
  });
}

elementById<HTMLButtonElement>("openDataDirectoryButton").addEventListener("click", () => {
  void settingsApi.openDataDirectory().then(unwrap).then(() => setStatus()).catch((error: unknown) => {
    setStatus(error instanceof Error ? error.message : "无法打开数据目录");
  });
});
elementById<HTMLButtonElement>("exportBackupButton").addEventListener("click", () => {
  void settingsApi.exportBackup().then(unwrap).then((result) => {
    setStatus(
      result.canceled || !result.filePath ? "" : `备份已导出：${result.filePath}`,
      "success"
    );
  }).catch((error: unknown) => {
    setStatus(error instanceof Error ? error.message : "无法导出备份");
  });
});
elementById<HTMLButtonElement>("openGitHubButton").addEventListener("click", () => {
  void settingsApi.openGitHub().then(unwrap).catch((error: unknown) => {
    setStatus(error instanceof Error ? error.message : "无法打开 GitHub");
  });
});
elementById<HTMLButtonElement>("openLicensesButton").addEventListener("click", () => {
  void settingsApi.openLicenses().then(unwrap).catch((error: unknown) => {
    setStatus(error instanceof Error ? error.message : "无法打开第三方许可证");
  });
});

for (const button of document.querySelectorAll<HTMLButtonElement>(".nav-item")) {
  button.addEventListener("click", () => {
    const targetId = button.dataset.target;
    if (!targetId) return;
    document.getElementById(targetId)?.scrollIntoView({ behavior: "smooth", block: "start" });
    for (const item of document.querySelectorAll(".nav-item")) item.classList.remove("active");
    button.classList.add("active");
  });
}

const unsubscribe = settingsApi.onChanged(render);
window.addEventListener("beforeunload", () => {
  unsubscribe();
  if (statusTimer !== null) window.clearTimeout(statusTimer);
});
void settingsApi.get().then(unwrap).then((snapshot) => {
  render(snapshot);
  settingsApi.rendererReady(true);
}).catch((error: unknown) => {
  setStatus(error instanceof Error ? error.message : "设置页初始化失败");
  settingsApi.rendererReady(false);
});
})();
