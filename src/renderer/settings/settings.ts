/** 独立设置页 Renderer；只渲染固定设置并调用 preload 白名单。 */
(() => {
type PetSize = "large" | "normal" | "small";
interface RadialItem { id: string; enabled: boolean; name?: string; path?: string }
interface RadialSettings {
  enabled: boolean;
  opacity: number;
  scale: number;
  showHints: boolean;
  animations: boolean;
  items: RadialItem[];
}
type PetMouseAction =
  | "open-panel"
  | "quick-add"
  | "open-settings"
  | "toggle-radial-menu"
  | "toggle-monitoring"
  | "recall-pet"
  | "quit"
  | "none";

interface PetMouseBindings {
  leftClick: PetMouseAction;
  doubleClick: PetMouseAction;
  rightClick: PetMouseAction;
}

interface KeyboardMappingEntry {
  key: string;
  label: string;
  enabled: boolean;
}

interface KeyboardMappingSettings {
  enabled: boolean;
  mappings: KeyboardMappingEntry[];
}

interface AppSettingsSnapshot {
  autoStart: {
    supported: boolean;
    registered: boolean;
    willLaunch: boolean | null;
    blockedByWindows: boolean;
  };
  petSize: PetSize;
  petScale: number;
  radialMenu: RadialSettings;
  petOpacity: number;
  ignoreMouseEvents: boolean;
  alwaysOnTop: boolean;
  mouseBindings: PetMouseBindings;
  keyboardMapping: KeyboardMappingSettings;
  keyboardInputSupported: boolean;
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
  radialAppIcon(id: string): Promise<string | null>;
  get(): Promise<ApiResult<AppSettingsSnapshot>>;
  update(input: {
    autoStart?: boolean;
    petSize?: PetSize;
    petScale?: number;
    radialMenu?: RadialSettings;
    petOpacity?: number;
    ignoreMouseEvents?: boolean;
    alwaysOnTop?: boolean;
    mouseBindings?: PetMouseBindings;
    keyboardMapping?: KeyboardMappingSettings;
    activePetKey?: string;
  }): Promise<ApiResult<AppSettingsSnapshot>>;
  importPetZip(): Promise<ApiResult<ImportPetResult>>;
  chooseRadialApp(): Promise<ApiResult<{ path: string; name: string } | null>>;
  testRadialApp(id: string): Promise<ApiResult<boolean>>;
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
  setKeyboardCaptureActive(active: boolean): Promise<ApiResult<void>>;
  rendererReady(ok: boolean): void;
  onChanged(callback: (snapshot: AppSettingsSnapshot) => void): () => void;
  onNavigate(callback: (sectionId: string) => void): () => void;
}

interface SettingsWindow extends Window {
  taskPetSettings: SettingsBridge;
}

const ACTION_OPTIONS: ReadonlyArray<{ value: PetMouseAction; label: string }> = [
  { value: "open-panel", label: "打开 / 关闭任务面板" },
  { value: "quick-add", label: "快速添加任务" },
  { value: "open-settings", label: "打开 / 关闭设置" },
  { value: "toggle-radial-menu", label: "打开/关闭轮盘菜单" },
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
const petOpacityRange = elementById<HTMLInputElement>("petOpacityRange");
const petScaleRange = elementById<HTMLInputElement>("petScaleRange");
const ignoreMouseEventsToggle = elementById<HTMLInputElement>("ignoreMouseEventsToggle");
const keyboardMappingToggle = elementById<HTMLInputElement>("keyboardMappingToggle");
const keyboardMappingHint = elementById<HTMLElement>("keyboardMappingHint");
const keyboardMappingList = elementById<HTMLElement>("keyboardMappingList");
const emptyKeyboardMappings = elementById<HTMLElement>("emptyKeyboardMappings");
const addKeyboardMappingButton = elementById<HTMLButtonElement>("addKeyboardMappingButton");
const clearKeyboardMappingsButton = elementById<HTMLButtonElement>("clearKeyboardMappingsButton");
const keyboardCaptureHint = elementById<HTMLElement>("keyboardCaptureHint");
const dataDirectoryPath = elementById<HTMLElement>("dataDirectoryPath");
const aboutAppName = elementById<HTMLElement>("aboutAppName");
const aboutVersion = elementById<HTMLElement>("aboutVersion");
const STATUS_VISIBLE_MS = 5_000;
const MAX_PET_ZIP_BYTES = 50 * 1024 * 1024;
let currentSettings: AppSettingsSnapshot | null = null;
let statusTimer: number | null = null;
let petImportBusy = false;
let keyboardCaptureActive = false;
let settingsWrites: Promise<unknown> = Promise.resolve();
const activeRanges = new Set<HTMLInputElement>();

function setStatus(message = "", tone: "error" | "success" = "error"): void {
  if (statusTimer !== null) window.clearTimeout(statusTimer);
  statusTimer = null;
  status.textContent = message;
  status.hidden = message.length === 0;
  status.classList.toggle("error", message.length > 0 && tone === "error");
  status.classList.toggle("success", message.length > 0 && tone === "success");
  status.setAttribute("role", tone === "error" ? "alert" : "status");
  if (message.length > 0 && tone === "success") {
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

const NAMED_KEY_LABELS: Readonly<Record<string, string>> = Object.freeze({
  Space: "Space",
  Enter: "Enter",
  Tab: "Tab",
  Backspace: "退格",
  Delete: "删除",
  Insert: "插入",
  Home: "Home",
  End: "End",
  PageUp: "PgUp",
  PageDown: "PgDn",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Shift: "Shift",
  Control: "Ctrl",
  Alt: "Alt",
  CapsLock: "Caps",
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/"
});

function normalizeCapturedCode(code: string): string | null {
  if (/^(?:Shift|Control|Alt)(?:Left|Right)$/.test(code)) {
    return code.replace(/(?:Left|Right)$/, "");
  }
  if (/^(?:Key[A-Z]|Digit[0-9]|F(?:[1-9]|1[0-2]))$/.test(code)) return code;
  return Object.hasOwn(NAMED_KEY_LABELS, code) ? code : null;
}

function defaultLabelForCode(code: string): string {
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  return NAMED_KEY_LABELS[code] ?? code.slice(0, 8);
}

function nextKeyboardSettings(
  mappings: KeyboardMappingEntry[],
  enabled = currentSettings?.keyboardMapping.enabled ?? true
): KeyboardMappingSettings {
  return {
    enabled,
    mappings: mappings.map((mapping) => ({ ...mapping }))
  };
}

function renderKeyboardMappings(snapshot: AppSettingsSnapshot): void {
  const supported = snapshot.keyboardInputSupported;
  keyboardMappingToggle.checked = snapshot.keyboardMapping.enabled;
  keyboardMappingToggle.disabled = !supported;
  addKeyboardMappingButton.disabled = !supported || keyboardCaptureActive;
  clearKeyboardMappingsButton.disabled = !supported || snapshot.keyboardMapping.mappings.length === 0;
  keyboardMappingHint.textContent = supported
    ? "仅监听你添加的按键，按下时在桌宠上方短暂显示标签；不保存按键历史。"
    : "全局键盘映射目前只支持 Windows；其他功能不受影响。";
  emptyKeyboardMappings.hidden = snapshot.keyboardMapping.mappings.length > 0;
  keyboardMappingList.replaceChildren();

  snapshot.keyboardMapping.mappings.forEach((mapping, index) => {
    const row = document.createElement("div");
    row.className = "keyboard-mapping-row";

    const code = document.createElement("span");
    code.className = "keyboard-code";
    code.textContent = defaultLabelForCode(mapping.key);
    code.title = mapping.key;

    const label = document.createElement("input");
    label.className = "keyboard-label-input";
    label.type = "text";
    label.maxLength = 8;
    label.value = mapping.label;
    label.disabled = !supported;
    label.setAttribute("aria-label", `${mapping.key} 显示文字`);
    label.addEventListener("change", () => {
      const value = [...label.value.trim()].slice(0, 8).join("");
      if (!value) {
        setStatus("显示文字不能为空");
        render(snapshot);
        return;
      }
      const mappings = snapshot.keyboardMapping.mappings.map((item, itemIndex) => (
        itemIndex === index ? { ...item, label: value } : item
      ));
      void updateSetting({ keyboardMapping: nextKeyboardSettings(mappings) });
    });

    const enabledLabel = document.createElement("label");
    enabledLabel.className = "mapping-enabled";
    const enabled = document.createElement("input");
    enabled.type = "checkbox";
    enabled.checked = mapping.enabled;
    enabled.disabled = !supported;
    enabled.addEventListener("change", () => {
      const mappings = snapshot.keyboardMapping.mappings.map((item, itemIndex) => (
        itemIndex === index ? { ...item, enabled: enabled.checked } : item
      ));
      void updateSetting({ keyboardMapping: nextKeyboardSettings(mappings) });
    });
    enabledLabel.append(enabled, document.createTextNode("启用"));

    const remove = document.createElement("button");
    remove.className = "delete-mapping";
    remove.type = "button";
    remove.textContent = "删除";
    remove.disabled = !supported;
    remove.addEventListener("click", () => {
      const mappings = snapshot.keyboardMapping.mappings.filter((_item, itemIndex) => (
        itemIndex !== index
      ));
      void updateSetting({ keyboardMapping: nextKeyboardSettings(mappings) });
    });

    row.append(code, label, enabledLabel, remove);
    keyboardMappingList.append(row);
  });
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
  renderRange(petOpacityRange, snapshot.petOpacity);
  renderRange(petScaleRange, snapshot.petScale ?? 100);
  renderRadial(snapshot.radialMenu ?? defaultRadialSettings());
  ignoreMouseEventsToggle.checked = snapshot.ignoreMouseEvents;

  petSelect.replaceChildren(...snapshot.pets.map((pet) => {
    const option = document.createElement("option");
    option.value = pet.key;
    option.textContent = pet.displayName;
    return option;
  }));
  petSelect.disabled = snapshot.pets.length === 0;
  if (snapshot.activePetKey) petSelect.value = snapshot.activePetKey;
  renderCurrentPetPreview(snapshot);

  leftClickAction.value = snapshot.mouseBindings.leftClick;
  doubleClickAction.value = snapshot.mouseBindings.doubleClick;
  rightClickAction.value = snapshot.mouseBindings.rightClick;
  renderKeyboardMappings(snapshot);
  dataDirectoryPath.textContent = snapshot.dataDirectory;
  dataDirectoryPath.title = snapshot.dataDirectory;
  aboutAppName.textContent = snapshot.appName;
  // snapshot.version 来自主进程 app.getVersion()，其唯一维护入口是根目录 package.json。
  aboutVersion.textContent = `v${snapshot.version}`;
  elementById<HTMLButtonElement>("openGitHubButton").title = snapshot.githubUrl;
}

type SettingsUpdate = Parameters<SettingsBridge["update"]>[0];
function updateSetting(input: SettingsUpdate | (() => SettingsUpdate)): Promise<boolean> {
  const write = settingsWrites.then(async () => {
    try {
      setStatus();
      render(unwrap(await settingsApi.update(typeof input === "function" ? input() : input)));
      return true;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "无法更新设置");
      if (currentSettings) render(currentSettings);
      return false;
    }
  });
  settingsWrites = write;
  return write;
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
bindRange(petOpacityRange, (value) => updateSetting({ petOpacity: value }));
bindRange(petScaleRange, (value) => updateSetting({ petScale: value }));
ignoreMouseEventsToggle.addEventListener("change", () => {
  void updateSetting({ ignoreMouseEvents: ignoreMouseEventsToggle.checked });
});
keyboardMappingToggle.addEventListener("change", () => {
  if (!currentSettings) return;
  void updateSetting({
    keyboardMapping: nextKeyboardSettings(
      currentSettings.keyboardMapping.mappings,
      keyboardMappingToggle.checked
    )
  });
});
clearKeyboardMappingsButton.addEventListener("click", () => {
  if (!currentSettings) return;
  void updateSetting({
    keyboardMapping: nextKeyboardSettings([], currentSettings.keyboardMapping.enabled)
  });
});
petSelect.addEventListener("change", () => {
  if (petSelect.value) void updateSetting({ activePetKey: petSelect.value });
});

async function setKeyboardCapture(active: boolean): Promise<void> {
  try {
    unwrap(await settingsApi.setKeyboardCaptureActive(active));
    keyboardCaptureActive = active;
    keyboardCaptureHint.hidden = !active;
    addKeyboardMappingButton.textContent = active ? "等待按键…" : "＋ 添加按键";
    addKeyboardMappingButton.disabled = active || currentSettings?.keyboardInputSupported !== true;
  } catch (error) {
    keyboardCaptureActive = false;
    keyboardCaptureHint.hidden = true;
    addKeyboardMappingButton.textContent = "＋ 添加按键";
    setStatus(error instanceof Error ? error.message : "无法切换按键捕获模式");
  }
}

addKeyboardMappingButton.addEventListener("click", () => {
  if (!currentSettings?.keyboardInputSupported || keyboardCaptureActive) return;
  if (currentSettings.keyboardMapping.mappings.length >= 32) {
    setStatus("最多添加 32 个按键");
    return;
  }
  void setKeyboardCapture(true);
});

document.addEventListener("keydown", (event) => {
  if (!keyboardCaptureActive) return;
  event.preventDefault();
  event.stopPropagation();
  if (event.repeat) return;
  if (event.key === "Escape") {
    void setKeyboardCapture(false);
    return;
  }
  const code = normalizeCapturedCode(event.code);
  if (!code) {
    setStatus("该按键暂不支持，请按字母、数字、功能键或常用控制键");
    return;
  }
  const snapshot = currentSettings;
  if (!snapshot) return;
  if (snapshot.keyboardMapping.mappings.some((mapping) => mapping.key === code)) {
    setStatus("这个按键已经添加过了");
    void setKeyboardCapture(false);
    return;
  }
  const mappings = [
    ...snapshot.keyboardMapping.mappings,
    { key: code, label: defaultLabelForCode(code), enabled: true }
  ];
  void (async () => {
    await setKeyboardCapture(false);
    await updateSetting({
      keyboardMapping: nextKeyboardSettings(mappings, snapshot.keyboardMapping.enabled)
    });
  })();
}, true);
window.addEventListener("blur", () => {
  if (keyboardCaptureActive) void setKeyboardCapture(false);
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

function navigateToSection(targetId: string): void {
  const section = document.getElementById(targetId);
  if (!section) return;
  section.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  for (const item of document.querySelectorAll<HTMLElement>(".nav-item")) {
    item.classList.toggle("active", item.dataset.target === targetId);
    if (item.dataset.target === targetId) item.setAttribute("aria-current", "location");
    else item.removeAttribute("aria-current");
  }
}

for (const button of document.querySelectorAll<HTMLButtonElement>(".nav-item")) {
  button.addEventListener("click", () => {
    if (button.dataset.target) navigateToSection(button.dataset.target);
  });
}

// Browser script: keep this presentation catalogue in sync with shared radial defaults.
// No CommonJS runtime import is allowed in this sandboxed renderer.
const RADIAL_BUILTINS: ReadonlyArray<readonly [string, string, string, string]> = [
  ["open-panel", "任务面板", "▤", "内置动作"],
  ["quick-add", "快速添加任务", "＋", "内置动作"],
  ["open-settings", "设置", "⚙", "内置动作"],
  ["toggle-monitoring", "暂停 / 恢复监控", "Ⅱ", "内置动作"],
  ["toggle-pet", "显示 / 隐藏桌宠", "◇", "内置动作"],
  ["toggle-ignore-mouse", "忽略鼠标事件", "↖", "内置动作"],
  ["toggle-always-on-top", "始终置顶", "⌃", "内置动作"],
  ["pet-opacity", "桌宠透明度", "◐", "调节项"],
  ["pet-scale", "桌宠大小", "↔", "调节项"],
  ["radial-opacity", "轮盘透明度", "◑", "调节项"],
  ["radial-scale", "轮盘大小", "⤢", "调节项"],
  ["music", "QQ 音乐", "♪", "音乐控制"],
  ["quit", "退出 TaskPet", "⏻", "内置动作"]
];
function defaultRadialSettings(): RadialSettings {
  const visible = new Set(["open-panel", "open-settings", "toggle-monitoring", "pet-opacity", "pet-scale", "music", "toggle-always-on-top"]);
  return { enabled: true, opacity: 92, scale: 90, showHints: true, animations: true,
    items: RADIAL_BUILTINS.map(([id]) => ({ id, enabled: visible.has(id) })) };
}
function radialSettings(): RadialSettings {
  return currentSettings?.radialMenu ?? defaultRadialSettings();
}
function updateRadial(change: (settings: RadialSettings) => RadialSettings): Promise<boolean> {
  return updateSetting(() => ({ radialMenu: change(radialSettings()) }));
}
function renderRange(range: HTMLInputElement, value: number): void {
  if (!activeRanges.has(range)) range.value = String(value);
  range.style.setProperty("--range-progress", `${(Number(range.value) - Number(range.min)) / (Number(range.max) - Number(range.min)) * 100}%`);
}
function bindRange(range: HTMLInputElement, save: (value: number) => Promise<boolean>): void {
  let pending: number | null = null;
  let writing = false;
  async function flush(): Promise<void> {
    if (writing) return;
    writing = true;
    activeRanges.add(range);
    try {
      while (pending !== null) {
        const value = pending;
        pending = null;
        await save(value);
      }
    } finally {
      writing = false;
      activeRanges.delete(range);
      if (currentSettings) render(currentSettings);
    }
  }
  range.addEventListener("input", () => {
    pending = Number(range.value);
    activeRanges.add(range);
    renderRange(range, pending);
    void flush();
  });
}

const radialList = elementById<HTMLOListElement>("radialItemList");
const radialFeedback = elementById<HTMLParagraphElement>("radialFeedback");
const radialAppDialog = elementById<HTMLDialogElement>("radialAppDialog");
const radialAppName = elementById<HTMLInputElement>("radialAppName");
const radialAppPath = elementById<HTMLInputElement>("radialAppPath");
const radialAppError = elementById<HTMLParagraphElement>("radialAppError");
const radialAppSave = elementById<HTMLButtonElement>("saveRadialAppButton");
let editingAppId: string | null = null;
let radialListSignature = "";
let draggingRadialId: string | null = null;
let choosingApp = false;
function radialMessage(message: string, error = false): void {
  radialFeedback.textContent = message;
  radialFeedback.hidden = !message;
  radialFeedback.classList.toggle("error", error);
  radialFeedback.setAttribute("role", error ? "alert" : "status");
}
function focusRadial(id: string, action: string): void {
  const row = Array.from(radialList.children).find((node) => (node as HTMLElement).dataset.id === id);
  const button = row?.querySelector<HTMLElement>(`[data-action="${action}"]:not(:disabled)`)
    ?? row?.querySelector<HTMLElement>('[data-action="enabled"]');
  button?.focus();
}
async function moveRadial(id: string, offset: number, targetId?: string): Promise<void> {
  const saved = await updateRadial((settings) => {
    const items = [...settings.items];
    const from = items.findIndex((item) => item.id === id);
    const to = targetId ? items.findIndex((item) => item.id === targetId) : from + offset;
    if (from < 0 || to < 0 || to >= items.length) return settings;
    const [item] = items.splice(from, 1);
    items.splice(to, 0, item!);
    return { ...settings, items };
  });
  if (saved) radialMessage("菜单顺序已保存");
  focusRadial(id, offset < 0 ? "up" : "down");
}
function renderRadial(settings: RadialSettings): void {
  for (const [id, key] of [["radialEnabledToggle", "enabled"], ["radialAnimationsToggle", "animations"]] as const) {
    elementById<HTMLInputElement>(id).checked = settings[key];
  }
  renderRange(elementById<HTMLInputElement>("radialOpacityRange"), settings.opacity);
  renderRange(elementById<HTMLInputElement>("radialScaleRange"), settings.scale);
  const signature = JSON.stringify(settings.items);
  if (signature === radialListSignature) return;
  radialListSignature = signature;
  const focused = document.activeElement as HTMLElement | null;
  const focusedId = focused?.closest<HTMLElement>("[data-id]")?.dataset.id;
  const focusedAction = focused?.dataset.action;
  radialList.replaceChildren();
  settings.items.forEach((item, index) => {
    const builtin = RADIAL_BUILTINS.find(([id]) => id === item.id);
    const name = builtin?.[1] ?? item.name ?? "未命名应用";
    const row = document.createElement("li");
    row.className = "radial-item";
    row.dataset.id = item.id;
    row.draggable = true;
    row.classList.toggle("item-hidden", !item.enabled);
    const icon = document.createElement("span");
    icon.className = "radial-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = builtin?.[2] ?? "▣";
    if (!builtin) void settingsApi.radialAppIcon(item.id).then(data => {
      if (!data || !icon.isConnected) return;
      const image = document.createElement("img"); image.src = data; image.alt = ""; image.width = 24; image.height = 24;
      icon.replaceChildren(image);
    }).catch(() => {});
    const copy = document.createElement("div");
    copy.className = "row-copy";
    const title = document.createElement("strong");
    title.textContent = name;
    const detail = document.createElement("small");
    detail.textContent = `${index + 1} · ${builtin?.[3] ?? "应用入口"}${item.enabled ? "" : " · 已隐藏"}`;
    copy.append(title, detail);
    if (!builtin) {
      const path = document.createElement("small");
      path.className = "radial-path";
      path.textContent = item.path || "未设置路径，请编辑修复";
      path.title = item.path ?? "";
      copy.append(path);
    }
    const controls = document.createElement("div");
    controls.className = "radial-item-actions";
    const enabledLabel = document.createElement("label");
    const enabled = document.createElement("input");
    enabled.type = "checkbox";
    enabled.checked = item.enabled;
    enabled.dataset.action = "enabled";
    enabled.setAttribute("aria-label", `在轮盘中显示${name}`);
    enabled.addEventListener("change", () => {
      const checked = enabled.checked;
      void updateRadial((latest) => ({ ...latest, items: latest.items.map((entry) => entry.id === item.id ? { ...entry, enabled: checked } : entry) }));
    });
    enabledLabel.append(enabled, document.createTextNode("启用"));
    controls.append(enabledLabel);
    function action(label: string, key: string, run: () => void, disabled = false): void {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.dataset.action = key;
      button.setAttribute("aria-label", `${label}：${name}`);
      button.disabled = disabled;
      button.addEventListener("click", run);
      controls.append(button);
    }
    action("上移", "up", () => { void moveRadial(item.id, -1); }, index === 0);
    action("下移", "down", () => { void moveRadial(item.id, 1); }, index === settings.items.length - 1);
    if (!builtin) {
      action("编辑", "edit", () => openAppEditor(item));
      action("测试启动", "test", () => { void testApp(item.id, name); });
      action("删除", "delete", () => {
        if (!window.confirm(`删除应用入口“${name}”？不会删除程序文件。`)) return;
        void updateRadial((latest) => ({ ...latest, items: latest.items.filter((entry) => entry.id !== item.id) })).then((saved) => {
          if (saved) { radialMessage(`已删除应用入口“${name}”`); elementById("addRadialAppButton").focus(); }
        });
      });
    }
    row.addEventListener("dragstart", (event) => {
      if ((event.target as HTMLElement).closest("button, input, label")) { event.preventDefault(); return; }
      draggingRadialId = item.id;
      event.dataTransfer?.setData("text/plain", item.id);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
      row.classList.add("dragging");
    });
    row.addEventListener("dragover", (event) => {
      if (!draggingRadialId) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      row.classList.add("drop-target");
    });
    row.addEventListener("dragleave", () => row.classList.remove("drop-target"));
    row.addEventListener("dragend", () => {
      draggingRadialId = null;
      radialList.querySelectorAll(".dragging, .drop-target").forEach((node) => node.classList.remove("dragging", "drop-target"));
    });
    row.addEventListener("drop", (event) => {
      event.preventDefault();
      row.classList.remove("drop-target");
      const id = draggingRadialId;
      draggingRadialId = null;
      if (id && id !== item.id) void moveRadial(id, 0, item.id);
    });
    row.append(icon, copy, controls);
    radialList.append(row);
  });
  if (focusedId && focusedAction) focusRadial(focusedId, focusedAction);
}
for (const [id, key] of [["radialEnabledToggle", "enabled"], ["radialAnimationsToggle", "animations"]] as const) {
  const toggle = elementById<HTMLInputElement>(id);
  toggle.addEventListener("change", () => {
    const checked = toggle.checked;
    void updateRadial((latest) => ({ ...latest, [key]: checked }));
  });
}
bindRange(elementById<HTMLInputElement>("radialOpacityRange"), (opacity) => updateRadial((latest) => ({ ...latest, opacity })));
bindRange(elementById<HTMLInputElement>("radialScaleRange"), (scale) => updateRadial((latest) => ({ ...latest, scale })));
elementById("restoreRadialOrderButton").addEventListener("click", () => {
  void updateRadial((latest) => {
    const builtins = RADIAL_BUILTINS.flatMap(([id]) => latest.items.filter((item) => item.id === id));
    return { ...latest, items: [...builtins, ...latest.items.filter((item) => !RADIAL_BUILTINS.some(([id]) => id === item.id))] };
  }).then((saved) => { if (saved) radialMessage("已恢复内置项顺序；应用入口及显示状态保持不变"); });
});
elementById("restoreRadialDefaultsButton").addEventListener("click", () => {
  if (!window.confirm("恢复轮盘默认设置？将移除所有自定义应用入口，并恢复内置项、顺序、透明度、大小和显示行为。其他设置不受影响。")) return;
  void updateRadial(defaultRadialSettings).then((saved) => { if (saved) radialMessage("已恢复轮盘默认设置"); });
});
function openAppEditor(item?: RadialItem): void {
  editingAppId = item?.id ?? null;
  radialAppName.value = item?.name ?? "";
  radialAppPath.value = item?.path ?? "";
  radialAppError.hidden = true;
  elementById("radialAppDialogTitle").textContent = item ? "编辑应用" : "添加应用";
  radialAppDialog.showModal();
  radialAppName.focus();
}
async function chooseApp(): Promise<void> {
  if (choosingApp) return;
  choosingApp = true;
  const choose = elementById<HTMLButtonElement>("chooseRadialAppButton");
  choose.disabled = true;
  radialAppSave.disabled = true;
  try {
    if (typeof settingsApi.chooseRadialApp !== "function") throw new Error("当前版本尚未提供应用选择功能，请更新后重试。");
    const selected = unwrap(await settingsApi.chooseRadialApp());
    if (!selected) return;
    if (!radialAppDialog.open) openAppEditor();
    radialAppPath.value = selected.path;
    if (!radialAppName.value.trim()) radialAppName.value = selected.name;
    radialAppError.hidden = true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "无法选择应用";
    if (radialAppDialog.open) { radialAppError.textContent = message; radialAppError.hidden = false; }
    else radialMessage(message, true);
  } finally {
    choosingApp = false;
    choose.disabled = false;
    radialAppSave.disabled = false;
  }
}
elementById("addRadialAppButton").addEventListener("click", () => {
  if (radialSettings().items.length >= 45) { radialMessage("菜单项目已达上限，请删除不需要的应用入口后再添加。", true); return; }
  void chooseApp();
});
elementById("chooseRadialAppButton").addEventListener("click", () => { void chooseApp(); });
elementById("cancelRadialAppButton").addEventListener("click", () => radialAppDialog.close());
elementById<HTMLFormElement>("radialAppForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const name = radialAppName.value.trim();
  const path = radialAppPath.value;
  if (!name || name.length > 40 || !path) { radialAppError.textContent = "请填写不超过 40 个字符的名称并选择启动目标。"; radialAppError.hidden = false; return; }
  const id = editingAppId ?? `app-${crypto.randomUUID()}`;
  const editing = editingAppId !== null;
  radialAppSave.disabled = true;
  void updateRadial((latest) => {
    if (editing && !latest.items.some((item) => item.id === id)) throw new Error("该入口已被移除，请关闭后重新添加。");
    const items = editing ? latest.items.map((item) => item.id === id ? { ...item, name, path } : item)
      : [...latest.items, { id, name, path, enabled: true }];
    return { ...latest, items };
  }).then((saved) => {
    radialAppSave.disabled = false;
    if (saved) { radialAppDialog.close(); radialMessage(`已保存应用“${name}”`); focusRadial(id, "edit"); }
    else { radialAppError.textContent = status.textContent || "无法保存应用，请重试。"; radialAppError.hidden = false; }
  });
});
const testingApps = new Set<string>();
async function testApp(id: string, name: string): Promise<void> {
  if (testingApps.has(id)) return;
  testingApps.add(id);
  radialMessage(`正在启动“${name}”…`);
  try {
    await settingsWrites;
    if (typeof settingsApi.testRadialApp !== "function") throw new Error("当前版本尚未提供测试启动功能，请更新后重试。");
    if (!unwrap(await settingsApi.testRadialApp(id))) throw new Error("应用未能启动，请编辑入口并重新选择路径。");
    radialMessage(`已请求启动“${name}”`);
  } catch (error) {
    radialMessage(`${error instanceof Error ? error.message : "启动失败"} 可通过“编辑”重新选择路径。`, true);
  } finally { testingApps.delete(id); }
}

const unsubscribe = settingsApi.onChanged(render);
const unsubscribeNavigation = settingsApi.onNavigate(navigateToSection);
window.addEventListener("beforeunload", () => {
  unsubscribe();
  unsubscribeNavigation();
  if (statusTimer !== null) window.clearTimeout(statusTimer);
  if (keyboardCaptureActive) void settingsApi.setKeyboardCaptureActive(false);
});
void settingsApi.get().then(unwrap).then((snapshot) => {
  render(snapshot);
  settingsApi.rendererReady(true);
}).catch((error: unknown) => {
  setStatus(error instanceof Error ? error.message : "设置页初始化失败");
  settingsApi.rendererReady(false);
});
})();
