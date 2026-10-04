/**
 * TaskPet 的 Electron Main Process 入口。
 * 负责桌宠窗口、托盘、宠物资源、桌宠 IPC 和 TaskSystem 生命周期；任务业务本身在 src/main/ 下。
 */
const { app, BrowserWindow, Menu, Tray, dialog, ipcMain, nativeImage, screen, shell, powerMonitor } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  discoverPets: discoverPetsInRoot,
  resolvePetStorageRoot,
  toPetPayload
} = require("./pet-library");
const { PET_ACTIONS, PetStateController } = require("./pet-state");
const { createPetDragSession, petBoundsForCursor } = require("./pet-window-drag");
const {
  createPetWindowOptions,
  getCenteredPetBounds,
  getPetWindowSize
} = require("./pet-window-options");
const { createFileLogger } = require("./app-logger");
const {
  DEFAULT_PET_OPACITY,
  DEFAULT_PET_MOUSE_BINDINGS,
  PET_SIZE_PRESETS,
  normalizeKeyboardMappingSettings,
  normalizePetOpacity,
  normalizePetMouseBindings,
  normalizePetSize,
  petMouseActionForGesture
} = require("../build/shared/app-settings");
const { LoginItemService } = require("../build/main/services/login-item-service");
const {
  inspectPetSpritesheetFile,
  installPetPackageFromDirectory,
  installPetPackageFromZip,
  installPetPackageFromZipFile
} = require("../build/main/services/custom-pet-service");
const { createTrayMenuTemplate } = require("../build/main/windows/tray-menu");
const {
  createRadialMenuWindowOptions,
  radialMenuShape,
  radialMenuBoundsForPoint
} = require("../build/main/windows/radial-menu-window");
const {
  createKeyBubbleWindowOptions,
  keyBubbleBoundsForPet
} = require("../build/main/windows/key-bubble-window");
const {
  KeyboardMappingMonitor,
  UnsupportedKeyboardInputSource
} = require("../build/main/input/keyboard-mapping-monitor");
const { WindowsRawKeyboardSource } = require("../build/main/input/windows-raw-keyboard-source");
const { TaskSystem } = require("../build/main/task-system");
const { normalizeRadialSettings, normalizePetScale, RadialSettingsSchema } = require("../build/shared/radial-settings");
const { UpdateAppSettingsInputSchema } = require("../build/shared/app-settings");
const { launchRadialApp, validateRadialAppPath } = require("../build/main/services/radial-app-service");
const { QqMusicService } = require("../build/main/services/qq-music-service");
const musicService = new QqMusicService();
let overlayTimer = null;
let doubleClickDelayMs = 500;

const APP_NAME = "TaskPet";
const APP_ID = "com.taskpet.shell";
const GITHUB_URL = "https://github.com/qwqsu/TaskPet";
const PETDEX_URL = "https://petdex.dev/zh";
const PETDEX_CREATE_URL = "https://petdex.dev/zh/create";
const APP_STARTED_AT_MS = Date.now();
const LOGO_PATH = path.join(__dirname, "assets", "logo.png");
// 开发态的默认宠物和用户导入宠物都放在仓库这个目录；打包后由
// resolvePetStorageRoot 映射到 asar 外的 resources/src/assets/pets。
const DEVELOPMENT_PETS_ROOT = path.join(__dirname, "assets", "pets");
const IS_P1_SMOKE = process.argv.includes("--smoke-test-p1");
const IS_FEATURE_SMOKE = process.argv.includes("--smoke-test-v2") || IS_P1_SMOKE;
const IS_SMOKE_TEST = process.argv.includes("--smoke-test") || IS_FEATURE_SMOKE;
const IS_LOGIN_ITEM_SMOKE_TEST = process.argv.includes("--smoke-test-login-item");
const IS_NATIVE_PROCESS_SMOKE_TEST = process.argv.includes("--smoke-test-native-process");
const IS_PERFORMANCE_SMOKE_TEST = process.argv.includes("--performance-smoke");
const IS_DEBUG_PET_BOUNDS = process.argv.includes("--debug-pet-bounds");
const IS_DEBUG_PET_WORKING = process.argv.includes("--debug-pet-working");
const DEBUG_PET_SIZE = process.argv
  .find((argument) => argument.startsWith("--debug-pet-size="))
  ?.slice("--debug-pet-size=".length);
const DEBUG_PET_BOUNDS_CAPTURE_PATH = process.argv
  .find((argument) => argument.startsWith("--debug-pet-bounds-capture="))
  ?.slice("--debug-pet-bounds-capture=".length);
const SMOKE_USER_DATA_PATH = path.join(os.tmpdir(), "TaskPet-smoke");
const PERFORMANCE_USER_DATA_PATH = path.join(
  os.tmpdir(),
  `TaskPet-performance-${process.pid}`
);
const PERFORMANCE_OUTPUT_PATH = process.argv
  .find((argument) => argument.startsWith("--performance-output="))
  ?.slice("--performance-output=".length);
const LOGIN_ITEM_SMOKE_NAME = "TaskPet Login Item Smoke Test";
const LOGIN_ITEM_SMOKE_ARGS = [];

// Main Process 持有原生对象；Renderer 只能通过 preload 请求有限操作。
let petWindow = null;
let radialMenuWindow = null;
let pendingRadialMenuBounds = null;
let keyBubbleWindow = null;
let keyBubbleReady = false;
let pendingKeyBubbleLabels = [];
let keyBubbleSequence = 0;
let keyboardMappingMonitor = null;
let tray = null;
let pets = [];
let activePet = null;
let settings = {};
let smokeTimeout = null;
let taskSystem = null;
let petDragSession = null;
let loginItemService = null;
let logger = null;
let appIcon = null;
let petBoundsCaptureStarted = false;
let performanceSmokeStarted = false;
const smokeReady = {
  pet: false,
  panel: false,
  settings: false,
  radialMenu: false,
  keyBubbles: false
};

const petState = new PetStateController({
  onChange: (state) => broadcastPetState(state)
});

// smoke test 必须等桌宠、面板和内存数据库都就绪后才判定启动成功。
function markSmokeReady(component, ready = true) {
  if (!IS_SMOKE_TEST) return;
  if (!ready) {
    console.error(`TaskPet smoke test failed while initializing ${component}`);
    app.exit(1);
    return;
  }

  smokeReady[component] = true;
  if (
    !smokeReady.pet
    || !smokeReady.panel
    || !smokeReady.settings
    || !smokeReady.radialMenu
    || !smokeReady.keyBubbles
  ) return;
  clearTimeout(smokeTimeout);
  smokeTimeout = null;
  console.log(
    "TaskPet smoke test ready (pet + task panel + settings + radial menu + key bubbles + SQLite)"
  );
  if (IS_FEATURE_SMOKE) {
    void require(IS_P1_SMOKE ? "../scripts/p1-smoke.cjs" : "../scripts/features-smoke.cjs")({
      app, BrowserWindow, applyAppSettings, appSettingsSnapshot, showRadialMenu, hideRadialMenu,
      radialMenuWindow, petWindow, taskSystem, refreshOverlayOrder
    }).then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1); });
    return;
  }
  setTimeout(() => app.quit(), 100);
}

function startPerformanceSmoke() {
  if (
    !IS_PERFORMANCE_SMOKE_TEST
    || performanceSmokeStarted
    || !petWindow
    || petWindow.isDestroyed()
  ) {
    return;
  }

  performanceSmokeStarted = true;
  const { runPerformanceSmoke } = require("./performance-smoke");
  const outputPath = path.resolve(
    PERFORMANCE_OUTPUT_PATH || path.join("dist", "performance", "latest.json")
  );
  void runPerformanceSmoke({
    app,
    petWebContents: petWindow.webContents,
    outputPath,
    userDataPath: PERFORMANCE_USER_DATA_PATH,
    startedAtMs: APP_STARTED_AT_MS
  }).then((report) => {
    process.exitCode = report.passed ? 0 : 1;
    app.quit();
  }).catch((error) => {
    console.error(`TaskPet performance smoke failed: ${error.stack || error.message}`);
    process.exitCode = 1;
    app.quit();
  });
}

function petWindowBounds() {
  return petWindow && !petWindow.isDestroyed() ? petWindow.getBounds() : null;
}

function currentPetSizePreset() {
  const ratio = normalizePetScale(settings.petScale, settings.petSize) / 100;
  return Object.fromEntries(Object.entries(PET_SIZE_PRESETS.normal).map(([key, value]) =>
    [key, key === "scale" ? value * ratio : Math.round(value * ratio)]));
}

function enforcePetWindowSize() {
  if (!petWindow || petWindow.isDestroyed()) return null;
  const contentBounds = petWindow.getContentBounds();
  const size = getPetWindowSize(currentPetSizePreset());
  if (contentBounds.width !== size.width || contentBounds.height !== size.height) {
    petWindow.setContentSize(size.width, size.height);
  }
  return petWindow.getBounds();
}

function startPetWindowDrag() {
  if (!petWindow || petWindow.isDestroyed()) return false;
  const cursorPoint = screen.getCursorScreenPoint();
  const bounds = enforcePetWindowSize() || petWindow.getBounds();
  petDragSession = createPetDragSession({
    windowBounds: bounds,
    cursorPoint,
    windowSize: { width: bounds.width, height: bounds.height }
  });
  petWindow.setBounds(petBoundsForCursor(petDragSession, cursorPoint));
  return true;
}

function movePetWindowForDrag() {
  if (!petWindow || petWindow.isDestroyed() || !petDragSession) return false;
  petWindow.setBounds(petBoundsForCursor(petDragSession, screen.getCursorScreenPoint()));
  positionKeyBubbleWindow();
  return true;
}

app.setName(APP_NAME);
if (IS_SMOKE_TEST) {
  // CI/隔离桌面环境可能没有可用 GPU；仅 smoke 模式关闭硬件加速。
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch("disable-gpu");
  app.commandLine.appendSwitch("disable-gpu-compositing");
  app.commandLine.appendSwitch("in-process-gpu");
  // 仅测试进程使用；正式应用仍保持 Chromium sandbox。
  app.commandLine.appendSwitch("no-sandbox");
  app.setPath("userData", SMOKE_USER_DATA_PATH);
} else if (IS_PERFORMANCE_SMOKE_TEST) {
  // 性能测试使用真实 GPU/SQLite，但数据完全隔离于用户的正式目录。
  app.setPath("userData", PERFORMANCE_USER_DATA_PATH);
}

// ---------- 本地设置 ----------

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function getSettingsPath() {
  return path.join(app.getPath("userData"), "settings.json");
}

function loadSettings() {
  const stored = readJson(getSettingsPath()) || readJson(`${getSettingsPath()}.bak`);
  const raw = stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
  const petSize = normalizePetSize(raw.petSize, raw.zoom);
  settings = {
    ...raw,
    petSize,
    petScale: normalizePetScale(raw.petScale, petSize),
    radialMenu: normalizeRadialSettings(raw.radialMenu),
    petOpacity: normalizePetOpacity(raw.petOpacity),
    ignoreMouseEvents: raw.ignoreMouseEvents === true,
    alwaysOnTop: raw.alwaysOnTop !== false,
    mouseBindings: normalizePetMouseBindings(raw.mouseBindings),
    keyboardMapping: normalizeKeyboardMappingSettings(raw.keyboardMapping)
  };
  // zoom 只作为旧设置迁移输入；三档尺寸从此只由 PET_SIZE_PRESETS 决定。
  delete settings.zoom;
  if (
    IS_DEBUG_PET_BOUNDS
    && (DEBUG_PET_SIZE === "small" || DEBUG_PET_SIZE === "normal" || DEBUG_PET_SIZE === "large")
  ) {
    settings.petSize = DEBUG_PET_SIZE;
    settings.petScale = normalizePetScale(undefined, DEBUG_PET_SIZE);
  }
}

function saveSettings() {
  try {
    fs.mkdirSync(path.dirname(getSettingsPath()), { recursive: true });
    const temporary = `${getSettingsPath()}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(settings, null, 2));
    if (readJson(getSettingsPath())) fs.copyFileSync(getSettingsPath(), `${getSettingsPath()}.bak`);
    fs.renameSync(temporary, getSettingsPath());
  } catch (error) {
    console.warn(`Failed to save TaskPet settings: ${error.message}`);
    logger?.warn("Failed to save settings", error);
  }
}

function createAppIcon() {
  if (appIcon && !appIcon.isEmpty()) return appIcon;
  try {
    const image = nativeImage.createFromPath(LOGO_PATH);
    if (!image.isEmpty()) {
      appIcon = image;
      return appIcon;
    }
  } catch (error) {
    console.warn(`Failed to load TaskPet icon: ${error.message}`);
  }

  appIcon = nativeImage.createFromDataURL(
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAMAAAAoLQ9TAAAAGFBMVEUAAAAYIi9i5v9y8qaZfP/90WYfKz2xyNj28m6BAAAAB3RSTlMA///f39+fn6uU/gAAAEFJREFUeNqVj0kOwCAIBQO//2XnplkYQYJGk0BHyDKJg1xmEAjJQWYNZUdGgTYosAkfiBPwYQnKN3qHf6Snw6gudTW2DdqgAhoBA3kwAAAAAElFTkSuQmCC"
  );
  return appIcon;
}

async function runPackagedLoginItemSmokeTest() {
  if (process.platform !== "win32" || !app.isPackaged) {
    throw new Error("Packaged login item smoke test requires a packaged Windows build");
  }

  const service = new LoginItemService(app, {
    platform: "win32",
    executablePath: process.execPath,
    appName: LOGIN_ITEM_SMOKE_NAME
  });
  try {
    const enabled = await service.setEnabled(true);
    if (!enabled.registered) throw new Error("Temporary login item was not registered");
    const disabled = await service.setEnabled(false);
    if (disabled.registered) throw new Error("Temporary login item was not removed");
    console.log(
      `TaskPet packaged login item smoke test ready registered=${String(enabled.registered)}`
      + ` willLaunch=${String(enabled.willLaunch)} removed=${String(!disabled.registered)}`
    );
  } catch (error) {
    console.error(
      `TaskPet packaged login item smoke snapshot=${JSON.stringify(app.getLoginItemSettings({
        path: process.execPath,
        args: LOGIN_ITEM_SMOKE_ARGS
      }))}`
    );
    throw error;
  } finally {
    // 即使验证中途失败，也用同一 path/args/name 清理临时 HKCU 启动项。
    app.setLoginItemSettings({
      path: process.execPath,
      args: LOGIN_ITEM_SMOKE_ARGS,
      name: LOGIN_ITEM_SMOKE_NAME,
      openAtLogin: false,
      enabled: false
    });
  }
}

async function runPackagedNativeProcessSmokeTest() {
  if (process.platform !== "win32" || !app.isPackaged) {
    throw new Error("Native process smoke test requires a packaged Windows build");
  }
  const {
    createPlatformProcessProvider
  } = require("../build/main/process/process-provider");
  const provider = createPlatformProcessProvider();
  const processes = await provider.listProcesses();
  if (!processes.some((processInfo) => processInfo.pid === process.pid)) {
    throw new Error("Packaged native process provider did not return the TaskPet process");
  }
  console.log(`TaskPet packaged native process smoke ready count=${processes.length}`);
}

// ---------- 宠物资源发现与状态广播 ----------

function getPetStorageInfo() {
  return {
    petsRoot: resolvePetStorageRoot({
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      developmentPetsRoot: DEVELOPMENT_PETS_ROOT
    })
  };
}

function discoverPets() {
  const storage = getPetStorageInfo();
  const preferred = process.env.TASKPET_PET_ID
    || process.env.PET_ID
    || settings.activePetKey
    || activePet?.key;

  pets = discoverPetsInRoot(storage.petsRoot, {
    onError: (message) => logger?.warn("Pet load error", message)
  });
  const preferredId = typeof preferred === "string"
    ? preferred.replace(/^(?:builtin|pets):/, "")
    : preferred;
  activePet = pets.find((pet) => (
    pet.id === preferred || pet.key === preferred || pet.id === preferredId
  ))
    || pets[0]
    || null;
}

function petStatePayload(state = petState.snapshot()) {
  // Renderer 一次拿到状态、动画行定义和当前宠物资源，避免自行读取文件系统。
  return {
    ...state,
    actions: PET_ACTIONS,
    activePet: toPetPayload(activePet)
  };
}

function sendToPetWindow(channel, payload) {
  if (!petWindow || petWindow.isDestroyed()) return;
  petWindow.webContents.send(channel, payload);
}

function isPetWindowSender(event) {
  return Boolean(
    petWindow
    && !petWindow.isDestroyed()
    && event?.sender === petWindow.webContents
  );
}

function broadcastPetState(state) {
  sendToPetWindow("taskpet:state-changed", petStatePayload(state));
}

function broadcastPet() {
  sendToPetWindow("taskpet:pet-changed", toPetPayload(activePet));
}

function broadcastPetSize() {
  sendToPetWindow("taskpet:pet-size-changed", {
    petSize: settings.petSize,
    preset: currentPetSizePreset(),
    bounds: petWindow && !petWindow.isDestroyed() ? petWindow.getBounds() : null
  });
}

function setActivePet(key) {
  const nextPet = pets.find((pet) => pet.key === key);
  if (!nextPet) return false;

  activePet = nextPet;
  settings.activePetKey = nextPet.key;
  broadcastPet();
  return true;
}

function selectPet(key) {
  if (!setActivePet(key)) return false;
  saveSettings();
  rebuildTrayMenu();
  taskSystem?.notifySettingsChanged();
  return true;
}

function reloadPets() {
  discoverPets();
  settings.activePetKey = activePet?.key ?? null;
  saveSettings();
  broadcastPet();
  rebuildTrayMenu();
  taskSystem?.notifySettingsChanged();
}

async function openPetsFolder() {
  const target = getPetStorageInfo().petsRoot;
  try {
    fs.mkdirSync(target, { recursive: true });
    const error = await shell.openPath(target);
    if (error) console.warn(`Failed to open pet folder: ${error}`);
  } catch (error) {
    console.warn(`Failed to open pet folder: ${error.message}`);
    logger?.warn("Failed to open pet folder", error);
  }
}

function getDataPaths() {
  const dataDirectory = app.getPath("userData");
  return {
    dataDirectory,
    databasePath: path.join(dataDirectory, "taskpet.sqlite3"),
    settingsPath: path.join(dataDirectory, "settings.json"),
    logsDirectory: path.join(dataDirectory, "logs"),
    backupDirectory: path.join(dataDirectory, "backups")
  };
}

function getLicensesPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "THIRD_PARTY_LICENSES.txt")
    : path.join(app.getAppPath(), "THIRD_PARTY_LICENSES.txt");
}

function appSettingsSnapshot() {
  // app.getVersion() 读取 package.json 的 version。设置页 aboutVersion 最终显示的
  // 就是这里返回的 version，因此发布时只需要维护 package.json 这一处版本号。
  return {
    autoStart: loginItemService?.status ?? {
      supported: false,
      registered: false,
      willLaunch: null,
      blockedByWindows: false
    },
    petSize: settings.petSize,
    petOpacity: settings.petOpacity ?? DEFAULT_PET_OPACITY,
    petScale: settings.petScale,
    radialMenu: structuredClone(settings.radialMenu),
    ignoreMouseEvents: settings.ignoreMouseEvents === true,
    alwaysOnTop: settings.alwaysOnTop !== false,
    mouseBindings: { ...settings.mouseBindings },
    keyboardMapping: {
      enabled: settings.keyboardMapping.enabled,
      mappings: settings.keyboardMapping.mappings.map((mapping) => ({ ...mapping }))
    },
    keyboardInputSupported: keyboardMappingMonitor?.supported ?? process.platform === "win32",
    activePetKey: activePet?.key ?? null,
    pets: pets.map((pet) => {
      const payload = toPetPayload(pet);
      return {
        key: pet.key,
        displayName: pet.displayName,
        description: pet.description,
        spritesheetUrl: payload?.spritesheetUrl ?? "",
        frame: payload?.frame ?? { width: 192, height: 208, columns: 8, rows: 9 }
      };
    }),
    dataDirectory: app.getPath("userData"),
    appName: APP_NAME,
    version: app.getVersion(),
    githubUrl: GITHUB_URL
  };
}

async function applyAppSettings(input) {
  let persistSettings = false;

  if (input.autoStart !== undefined) {
    if (!loginItemService?.supported) {
      throw new Error("开机自动启动仅在 TaskPet 安装版中可用");
    }
    const autoStart = await loginItemService.setEnabled(input.autoStart);
    logger?.info(`Auto start ${autoStart.registered ? "enabled" : "disabled"}`);
  }

  if (input.petSize !== undefined) {
    settings.petSize = input.petSize;
    settings.petScale = normalizePetScale(undefined, input.petSize);
    resizePetWindow(input.petSize);
    persistSettings = true;
  }

  if (input.petScale !== undefined) {
    settings.petScale = normalizePetScale(input.petScale);
    resizePetWindow(settings.petSize);
    if (radialMenuWindow?.isVisible()) positionRadialMenu();
    persistSettings = true;
  }
  if (input.radialMenu !== undefined) {
    const next = normalizeRadialSettings(RadialSettingsSchema.parse(input.radialMenu));
    // Validate newly selected targets, but keep existing missing shortcuts repairable.
    for (const item of next.items) {
      if (item.id.startsWith("app-") && item.path !== settings.radialMenu.items.find(old => old.id === item.id)?.path) {
        await validateRadialAppPath(item.path);
      }
    }
    settings.radialMenu = next;
    if (!next.enabled) hideRadialMenu();
    else if (radialMenuWindow?.isVisible()) positionRadialMenu();
    persistSettings = true;
  }
  if (input.petOpacity !== undefined) {
    settings.petOpacity = normalizePetOpacity(input.petOpacity);
    if (petWindow && !petWindow.isDestroyed()) {
      petWindow.setOpacity(settings.petOpacity / 100);
    }
    persistSettings = true;
  }

  if (input.ignoreMouseEvents !== undefined) {
    settings.ignoreMouseEvents = input.ignoreMouseEvents;
    if (petWindow && !petWindow.isDestroyed()) {
      // Keep the pet hit-testable so double-clicks and drags remain available.
      petWindow.setIgnoreMouseEvents(false);
    }
    persistSettings = true;
  }

  if (input.alwaysOnTop !== undefined) {
    settings.alwaysOnTop = input.alwaysOnTop;
    if (petWindow && !petWindow.isDestroyed()) {
      refreshOverlayOrder();
    }
    persistSettings = true;
  }

  if (input.mouseBindings !== undefined) {
    settings.mouseBindings = normalizePetMouseBindings(input.mouseBindings);
    persistSettings = true;
  }

  if (input.keyboardMapping !== undefined) {
    settings.keyboardMapping = normalizeKeyboardMappingSettings(input.keyboardMapping);
    keyboardMappingMonitor?.update(settings.keyboardMapping);
    persistSettings = true;
  }

  if (input.activePetKey !== undefined) {
    if (!setActivePet(input.activePetKey)) throw new Error("选择的宠物不存在");
    persistSettings = true;
  }

  if (persistSettings) saveSettings();
  rebuildTrayMenu();
  broadcastRadialMenuState();
  return appSettingsSnapshot();
}

async function applyTraySetting(input) {
  const snapshot = await applyAppSettings(input);
  taskSystem?.notifySettingsChanged();
  return snapshot;
}

function validatePetSpritesheet(filePath, manifest) {
  const imageSize = inspectPetSpritesheetFile(filePath);
  const expectedWidth = manifest.frame.width * manifest.frame.columns;
  const expectedHeight = manifest.frame.height * manifest.frame.rows;
  if (imageSize.width !== expectedWidth || imageSize.height !== expectedHeight) {
    throw new Error(
      `宠物图集尺寸应为 ${expectedWidth} × ${expectedHeight}，实际为 ${imageSize.width} × ${imageSize.height}`
    );
  }
  if (imageSize.hasAlpha === false) {
    throw new Error("宠物图集必须包含透明背景");
  }
}

function activateImportedPet(installed) {
  discoverPets();
  if (!setActivePet(installed.key)) {
    throw new Error("宠物已导入，但重新加载失败；请重新打开 TaskPet 后再试");
  }
  saveSettings();
  rebuildTrayMenu();
  logger?.info(`Pet package imported: ${installed.id}`);
  return {
    canceled: false,
    petKey: installed.key,
    settings: appSettingsSnapshot()
  };
}

function petPackageInstallOptions() {
  return {
    petsRoot: getPetStorageInfo().petsRoot,
    validateSpritesheet: validatePetSpritesheet
  };
}

async function importPetZipFile(parentWindow) {
  const dialogOptions = {
    title: "选择 PetDex 宠物包",
    buttonLabel: "导入宠物",
    properties: ["openFile"],
    filters: [{ name: "PetDex 宠物包", extensions: ["zip"] }]
  };
  const result = parentWindow && !parentWindow.isDestroyed()
    ? await dialog.showOpenDialog(parentWindow, dialogOptions)
    : await dialog.showOpenDialog(dialogOptions);
  if (result.canceled || result.filePaths.length !== 1) {
    return { canceled: true, petKey: null, settings: appSettingsSnapshot() };
  }
  const zipPath = result.filePaths[0];
  if (!zipPath) throw new Error("未选择宠物 ZIP");
  return activateImportedPet(installPetPackageFromZipFile({
    ...petPackageInstallOptions(),
    zipPath
  }));
}

async function importDroppedPetZip(input) {
  return activateImportedPet(installPetPackageFromZip({
    ...petPackageInstallOptions(),
    archive: input.bytes
  }));
}

async function importPetFolder(parentWindow) {
  const dialogOptions = {
    title: "选择包含 pet.json 的宠物文件夹",
    buttonLabel: "导入宠物",
    properties: ["openDirectory"]
  };
  const result = parentWindow && !parentWindow.isDestroyed()
    ? await dialog.showOpenDialog(parentWindow, dialogOptions)
    : await dialog.showOpenDialog(dialogOptions);
  if (result.canceled || result.filePaths.length !== 1) {
    return { canceled: true, petKey: null, settings: appSettingsSnapshot() };
  }
  const sourceDirectory = result.filePaths[0];
  if (!sourceDirectory) throw new Error("未选择宠物文件夹");
  return activateImportedPet(installPetPackageFromDirectory({
    ...petPackageInstallOptions(),
    sourceDirectory
  }));
}

async function openWindowsStartupApps() {
  if (process.platform !== "win32") {
    throw new Error("Windows 启动应用设置仅在 Windows 中可用");
  }
  await shell.openExternal("ms-settings:startupapps");
}

async function openGitHub() {
  await shell.openExternal(GITHUB_URL);
}

async function openPetDex() {
  await shell.openExternal(PETDEX_URL);
}

async function openPetDexCreate() {
  await shell.openExternal(PETDEX_CREATE_URL);
}

async function openThirdPartyLicenses() {
  const error = await shell.openPath(getLicensesPath());
  if (error) throw new Error(error);
}

// ---------- 透明桌宠窗口、拖拽与缩放 ----------

function createPetWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const workAreas = [
    primaryDisplay,
    ...screen.getAllDisplays().filter((display) => display.id !== primaryDisplay.id)
  ].map((display) => display.workArea);

  petWindow = new BrowserWindow(createPetWindowOptions({
    preloadPath: path.join(__dirname, "preload.js"),
    icon: createAppIcon(),
    savedBounds: settings.windowBounds,
    preset: currentPetSizePreset(),
    alwaysOnTop: settings.alwaysOnTop !== false,
    workAreas
  }));

  refreshOverlayOrder();
  petWindow.setOpacity((settings.petOpacity ?? DEFAULT_PET_OPACITY) / 100);
  petWindow.setIgnoreMouseEvents(false);
  petWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
  petWindow.once("ready-to-show", () => {
    if (!IS_SMOKE_TEST) petWindow.show();
  });
  petWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription) => {
    console.error(`TaskPet renderer failed to load (${errorCode}): ${errorDescription}`);
    logger?.error(`Pet renderer failed to load (${errorCode}): ${errorDescription}`);
    if (IS_SMOKE_TEST) app.exit(1);
  });
  petWindow.on("closed", () => {
    keyboardMappingMonitor?.close();
    keyboardMappingMonitor = null;
    keyBubbleWindow?.hide();
    petDragSession = null;
    petWindow = null;
  });
  petWindow.on("move", () => {
    positionKeyBubbleWindow();
    if (radialMenuWindow?.isVisible()) positionRadialMenu();
  });
  petWindow.on("resize", positionKeyBubbleWindow);
  petWindow.on("focus", () => {
    if (process.platform !== "darwin" && radialMenuWindow?.isVisible()) radialMenuWindow.moveTop();
  });
}

// ---------- 独立径向菜单与按键气泡 ----------

function radialMenuState() {
  return {
    petVisible: Boolean(petWindow && !petWindow.isDestroyed() && petWindow.isVisible()),
    ignoreMouseEvents: settings.ignoreMouseEvents === true,
    petOpacity: settings.petOpacity ?? DEFAULT_PET_OPACITY,
    petScale: settings.petScale,
    alwaysOnTop: settings.alwaysOnTop !== false,
    monitoringPaused: taskSystem?.monitoringPaused ?? false,
    radialMenu: structuredClone(settings.radialMenu)
  };
}

function isRadialMenuSender(event) {
  return Boolean(
    radialMenuWindow
    && !radialMenuWindow.isDestroyed()
    && event?.sender === radialMenuWindow.webContents
  );
}

function isKeyBubbleSender(event) {
  return Boolean(
    keyBubbleWindow
    && !keyBubbleWindow.isDestroyed()
    && event?.sender === keyBubbleWindow.webContents
  );
}

function broadcastRadialMenuState() {
  if (!radialMenuWindow || radialMenuWindow.isDestroyed()) return;
  radialMenuWindow.webContents.send("taskpet:radial-menu:changed", radialMenuState());
}

function hideRadialMenu() {
  pendingRadialMenuBounds = null;
  if (radialMenuWindow && !radialMenuWindow.isDestroyed()) radialMenuWindow.hide();
}

function positionRadialMenu() {
  const petBounds = petWindowBounds();
  const point = petBounds ? {x: petBounds.x + Math.floor(petBounds.width / 2), y: petBounds.y + Math.floor(currentPetSizePreset().petHeight / 2)} : screen.getCursorScreenPoint();
  const workArea = screen.getDisplayNearestPoint(point).workArea;
  const preset = currentPetSizePreset();
  const safeDiameter = Math.hypot(preset.petWidth, preset.petHeight) + 112;
  const size = Math.round(safeDiameter + (settings.radialMenu.scale - 50) * 4.4);
  const bounds = radialMenuBoundsForPoint(point, workArea, size);
  if (petBounds && petWindow) {
    const x = bounds.x + Math.floor(bounds.width / 2) - Math.floor(petBounds.width / 2);
    const y = bounds.y + Math.floor(bounds.width / 2) - Math.floor(currentPetSizePreset().petHeight / 2);
    if (x !== petBounds.x || y !== petBounds.y) petWindow.setPosition(x, y);
  }
  if (radialMenuWindow && !radialMenuWindow.isDestroyed()) {
    radialMenuWindow.setBounds(bounds);
    if (process.platform === "win32" || process.platform === "linux") {
      const body = petWindow?.getBounds();
      radialMenuWindow.setShape(body && petWindow.isVisible() ? radialMenuShape(bounds.width,bounds.height,{
        x:body.x-bounds.x+Math.round((preset.windowWidth-preset.petWidth)/2),
        y:body.y-bounds.y+preset.petTop,
        width:preset.petWidth,height:preset.petHeight
      }) : [{x:0,y:0,width:bounds.width,height:bounds.height}]);
    }
  }
  return bounds;
}

function refreshOverlayOrder() {
  for (const overlay of [radialMenuWindow, petWindow, keyBubbleWindow]) {
    if (!overlay || overlay.isDestroyed()) continue;
    try {
      const topmost = settings.alwaysOnTop !== false;
      if (overlay.isAlwaysOnTop() !== topmost) overlay.setAlwaysOnTop(topmost, "screen-saver");
    } catch (error) { logger?.warn("Unable to refresh overlay order", error); }
  }
}

async function chooseRadialApp() {
  const result = await dialog.showOpenDialog({title: "绑定轮盘应用", properties: ["openFile"], filters: [{name: "应用程序和快捷方式", extensions: ["exe", "lnk"]}]});
  if (result.canceled || !result.filePaths[0]) return null;
  const target = await validateRadialAppPath(result.filePaths[0]);
  return {path: target, name: path.basename(target, path.extname(target))};
}

const appIconCache = new Map();
async function radialAppIcon(id) {
  const item = settings.radialMenu.items.find(entry => entry.id === id && entry.id.startsWith("app-"));
  if (!item?.path) return null;
  if (appIconCache.has(item.path)) return appIconCache.get(item.path);
  try {
    await validateRadialAppPath(item.path);
    const icon = await app.getFileIcon(item.path, {size: "small"});
    const data = icon.isEmpty() ? null : icon.toDataURL();
    if (appIconCache.size >= 64) appIconCache.clear();
    appIconCache.set(item.path, data);
    return data;
  } catch { return null; }
}

function createRadialMenuWindow() {
  if (radialMenuWindow && !radialMenuWindow.isDestroyed()) return radialMenuWindow;
  const nextWindow = new BrowserWindow(createRadialMenuWindowOptions({
    preloadPath: path.join(__dirname, "..", "build", "preload", "radial-menu-preload.js"),
    icon: createAppIcon()
  }));
  radialMenuWindow = nextWindow;
  refreshOverlayOrder();
  nextWindow.loadFile(path.join(__dirname, "renderer", "radial-menu", "index.html"));
  nextWindow.webContents.once("did-finish-load", () => markSmokeReady("radialMenu"));
  nextWindow.once("ready-to-show", () => {
    if (!pendingRadialMenuBounds || nextWindow.isDestroyed()) return;
    nextWindow.setBounds(pendingRadialMenuBounds);
    pendingRadialMenuBounds = null;
    nextWindow.show();
    nextWindow.focus();
    if (process.platform === "darwin") petWindow?.moveTop();
    broadcastRadialMenuState();
  });
  nextWindow.on("blur", () => {
    setTimeout(() => {
      if (nextWindow.isDestroyed() || !nextWindow.isVisible()) return;
      const focused = BrowserWindow.getFocusedWindow();
      if (focused !== nextWindow && focused !== petWindow) hideRadialMenu();
    }, 80);
  });
  nextWindow.on("closed", () => {
    if (radialMenuWindow === nextWindow) radialMenuWindow = null;
  });
  return nextWindow;
}

function showRadialMenu() {
  if (!settings.radialMenu.enabled) return false;
  const menuWindow = createRadialMenuWindow();
  const bounds = positionRadialMenu();
  if (menuWindow.webContents.isLoading()) {
    pendingRadialMenuBounds = bounds;
    return true;
  }
  menuWindow.setBounds(bounds);
  menuWindow.show();
  refreshOverlayOrder();
  menuWindow.focus();
  if (process.platform === "darwin") petWindow?.moveTop();
  broadcastRadialMenuState();
  return true;
}

function toggleRadialMenu() {
  if (radialMenuWindow?.isVisible()) {
    hideRadialMenu();
    return true;
  }
  return showRadialMenu();
}

function togglePetVisibility() {
  if (!petWindow || petWindow.isDestroyed()) return false;
  if (petWindow.isVisible()) {
    petWindow.hide();
    keyBubbleWindow?.hide();
  } else {
    petWindow.show();
  }
  broadcastRadialMenuState();
  return true;
}

function createKeyBubbleWindow() {
  if (keyBubbleWindow && !keyBubbleWindow.isDestroyed()) return keyBubbleWindow;
  const nextWindow = new BrowserWindow(createKeyBubbleWindowOptions({
    preloadPath: path.join(__dirname, "..", "build", "preload", "key-bubble-preload.js"),
    icon: createAppIcon()
  }));
  keyBubbleWindow = nextWindow;
  keyBubbleReady = false;
  refreshOverlayOrder();
  nextWindow.setIgnoreMouseEvents(true, { forward: true });
  nextWindow.loadFile(path.join(__dirname, "renderer", "key-bubbles", "index.html"));
  nextWindow.on("closed", () => {
    if (keyBubbleWindow === nextWindow) {
      keyBubbleWindow = null;
      keyBubbleReady = false;
      pendingKeyBubbleLabels = [];
    }
  });
  return nextWindow;
}

function positionKeyBubbleWindow() {
  if (
    !petWindow
    || petWindow.isDestroyed()
    || !keyBubbleWindow
    || keyBubbleWindow.isDestroyed()
  ) return;
  const petBounds = petWindow.getBounds();
  const workArea = screen.getDisplayMatching(petBounds).workArea;
  keyBubbleWindow.setBounds(keyBubbleBoundsForPet(petBounds, workArea));
}

function pushKeyBubble(label) {
  if (!petWindow || petWindow.isDestroyed() || !petWindow.isVisible()) return;
  const safeLabel = [...String(label)].slice(0, 8).join("");
  if (!safeLabel) return;
  const bubbleWindow = createKeyBubbleWindow();
  positionKeyBubbleWindow();
  bubbleWindow.showInactive();
  if (!keyBubbleReady || bubbleWindow.webContents.isLoading()) {
    pendingKeyBubbleLabels.push(safeLabel);
    pendingKeyBubbleLabels = pendingKeyBubbleLabels.slice(-3);
    return;
  }
  keyBubbleSequence += 1;
  bubbleWindow.webContents.send("taskpet:key-bubbles:push", {
    label: safeLabel,
    sequence: keyBubbleSequence
  });
}

function initializeKeyboardMappingMonitor() {
  keyboardMappingMonitor?.close();
  const source = process.platform === "win32" && petWindow && !petWindow.isDestroyed()
    ? new WindowsRawKeyboardSource(petWindow, (error) => {
      logger?.warn("Windows raw keyboard input failed", error);
    })
    : new UnsupportedKeyboardInputSource();
  keyboardMappingMonitor = new KeyboardMappingMonitor(
    source,
    ({ label }) => pushKeyBubble(label),
    (error) => logger?.warn("Keyboard mapping monitor failed", error)
  );
  keyboardMappingMonitor.update(settings.keyboardMapping);
}

function saveWindowBounds() {
  if (!petWindow || petWindow.isDestroyed()) return;
  settings.windowBounds = enforcePetWindowSize();
  saveSettings();
}

function resizePetWindow(petSize) {
  if (!petWindow || petWindow.isDestroyed()) return { ok: false };

  const preset = currentPetSizePreset();
  const { width, height } = getPetWindowSize(preset);
  petWindow.setContentSize(width, height);
  settings.windowBounds = petWindow.getBounds();
  positionKeyBubbleWindow();
  broadcastPetSize();
  return { ok: true, petSize, bounds: petWindow.getBounds() };
}

function recallPetWindow() {
  if (!petWindow || petWindow.isDestroyed()) return false;
  const workArea = screen.getPrimaryDisplay().workArea;
  const bounds = getCenteredPetBounds(workArea, currentPetSizePreset());
  petWindow.setContentBounds(bounds);
  petWindow.show();
  positionKeyBubbleWindow();
  settings.windowBounds = petWindow.getBounds();
  saveSettings();
  logger?.info("Pet recalled to the primary display center");
  return true;
}

function performPetMouseAction(action) {
  switch (action) {
    case "open-panel":
      taskSystem?.togglePanel(petWindowBounds());
      break;
    case "quick-add":
      taskSystem?.showQuickAdd(petWindowBounds());
      break;
    case "open-settings":
      taskSystem?.toggleSettings();
      break;
    case "toggle-radial-menu":
      toggleRadialMenu();
      break;
    case "toggle-monitoring":
      if (taskSystem) taskSystem.setMonitoringPaused(!taskSystem.monitoringPaused);
      break;
    case "recall-pet":
      recallPetWindow();
      break;
    case "quit":
      app.quit();
      break;
    case "none":
      break;
    default:
      return false;
  }
  return true;
}

// ---------- 系统托盘 ----------

function petTrayItems() {
  return pets.map((pet) => ({
    label: pet.displayName,
    type: "radio",
    checked: pet.key === activePet?.key,
    click: () => selectPet(pet.key)
  }));
}

function buildTrayMenu() {
  const template = createTrayMenuTemplate({
    ignoreMouseEvents: settings.ignoreMouseEvents === true
  }, {
    quickAddTask: () => taskSystem?.showQuickAdd(petWindowBounds()),
    togglePet: () => togglePetVisibility(),
    recallPet: () => recallPetWindow(),
    setIgnoreMouseEvents: (enabled) => {
      void applyTraySetting({ ignoreMouseEvents: enabled }).catch((error) => {
        logger?.warn("Failed to change mouse passthrough from Tray", error);
        rebuildTrayMenu();
      });
    },
    openSettings: () => taskSystem?.showSettings(),
    quit: () => app.quit()
  }, petTrayItems());
  return Menu.buildFromTemplate(template);
}

function rebuildTrayMenu() {
  if (!tray || tray.isDestroyed()) return;
  tray.setContextMenu(buildTrayMenu());
}

function createTray() {
  const icon = createAppIcon().resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip(APP_NAME);
  tray.setContextMenu(buildTrayMenu());
  tray.on("click", () => {
    togglePetVisibility();
  });
}

// ---------- 桌宠 preload IPC ----------

const RADIAL_MENU_ACTIONS = new Set([
  "open-panel", "quick-add", "toggle-monitoring", "toggle-always-on-top",
  "open-settings",
  "toggle-pet",
  "toggle-ignore-mouse",
  "open-opacity-settings",
  "quit"
]);

async function performRadialMenuAction(action) {
  try {
  if (typeof action !== "string") return {ok: false, error: "无效操作"};
  if (action.startsWith("app-")) {
    await launchRadialApp(action, settings.radialMenu, target => shell.openPath(target));
    hideRadialMenu();
    return {ok: true};
  }
  if (!RADIAL_MENU_ACTIONS.has(action)) return {ok: false, error: "不支持此操作"};
  switch (action) {
    case "open-panel":
      hideRadialMenu(); taskSystem?.showPanel(petWindowBounds()); break;
    case "quick-add":
      hideRadialMenu(); taskSystem?.showQuickAdd(petWindowBounds()); break;
    case "toggle-monitoring":
      taskSystem?.setMonitoringPaused(!taskSystem.monitoringPaused); broadcastRadialMenuState(); break;
    case "toggle-always-on-top":
      await applyTraySetting({alwaysOnTop: settings.alwaysOnTop === false}); break;
    case "open-settings":
      hideRadialMenu();
      taskSystem?.showSettings();
      break;
    case "toggle-pet":
      hideRadialMenu();
      togglePetVisibility();
      break;
    case "toggle-ignore-mouse":
      await applyTraySetting({ ignoreMouseEvents: settings.ignoreMouseEvents !== true });
      break;
    case "open-opacity-settings":
      hideRadialMenu();
      taskSystem?.showSettings("interactionSection");
      break;
    case "quit":
      app.quit();
      break;
  }
  return {ok: true};
  } catch (error) { return {ok: false, error: error instanceof Error ? error.message : "操作失败，请重试"}; }
}

function registerIpcHandlers() {
  ipcMain.handle("taskpet:get-initial-state", (event) => isPetWindowSender(event) ? ({
    ...petStatePayload(),
    config: {
      petSize: settings.petSize,
      preset: currentPetSizePreset(),
      debugPetBounds: IS_DEBUG_PET_BOUNDS,
      doubleClickDelayMs
    }
  }) : null);

  ipcMain.on("taskpet:start-window-drag", (event) => {
    if (!isPetWindowSender(event)) return;
    if (radialMenuWindow?.isVisible()) hideRadialMenu();
    startPetWindowDrag();
  });

  ipcMain.on("taskpet:move-window", (event) => {
    if (!isPetWindowSender(event)) return;
    movePetWindowForDrag();
  });

  ipcMain.handle("taskpet:finish-drag", (event) => {
    if (!isPetWindowSender(event)) return false;
    movePetWindowForDrag();
    petDragSession = null;
    saveWindowBounds();
    petState.finishDrag();
    return true;
  });

  ipcMain.handle("taskpet:toggle-task-panel", (event) => {
    if (!isPetWindowSender(event) || !taskSystem) return false;
    taskSystem.togglePanel(petWindowBounds());
    return true;
  });

  ipcMain.handle("taskpet:pet-mouse-action", (event, gesture) => {
    if (!isPetWindowSender(event)) return false;
    if (gesture === "left" && settings.ignoreMouseEvents) return false;
    const bindings = settings.mouseBindings || DEFAULT_PET_MOUSE_BINDINGS;
    const action = petMouseActionForGesture(bindings, gesture);
    if (!action) return false;
    // 开关轮盘菜单需要看到当前可见状态，其他桌宠动作仍先关闭轮盘。
    if (action !== "toggle-radial-menu" && radialMenuWindow?.isVisible()) hideRadialMenu();
    return performPetMouseAction(action);
  });

  ipcMain.on("taskpet:drag-direction", (event, direction) => {
    if (!isPetWindowSender(event) || (direction !== "drag-left" && direction !== "drag-right")) return;
    petState.startDrag(direction);
  });

  ipcMain.on("taskpet:renderer-ready", (event) => {
    if (!petWindow || event.sender !== petWindow.webContents) return;
    if (IS_SMOKE_TEST) markSmokeReady("pet");
    if (IS_PERFORMANCE_SMOKE_TEST) startPerformanceSmoke();
    if (
      IS_DEBUG_PET_BOUNDS
      && DEBUG_PET_BOUNDS_CAPTURE_PATH
      && !petBoundsCaptureStarted
    ) {
      petBoundsCaptureStarted = true;
      if (IS_DEBUG_PET_WORKING) {
        sendToPetWindow("taskpet:state-changed", petStatePayload({
          state: "working",
          message: "TaskPet working 状态文字",
          detail: "00:42:18"
        }));
      }
      setTimeout(() => {
        void Promise.all([
          petWindow.webContents.capturePage(),
          petWindow.webContents.executeJavaScript(
            "({ innerWidth: window.innerWidth, innerHeight: window.innerHeight, devicePixelRatio: window.devicePixelRatio })"
          )
        ]).then(([image, viewport]) => {
          const targetPath = path.resolve(DEBUG_PET_BOUNDS_CAPTURE_PATH);
          fs.mkdirSync(path.dirname(targetPath), { recursive: true });
          fs.writeFileSync(targetPath, image.toPNG());
          console.log(
            `TaskPet pet bounds captured size=${settings.petSize}`
            + ` bounds=${JSON.stringify(petWindow.getBounds())}`
            + ` content=${JSON.stringify(petWindow.getContentBounds())}`
            + ` viewport=${JSON.stringify(viewport)} path=${targetPath}`
          );
          app.exit(0);
        }).catch((error) => {
          console.error(`TaskPet pet bounds capture failed: ${error.stack || error.message}`);
          app.exit(1);
        });
      }, 250);
    }
  });

  ipcMain.handle("taskpet:radial-menu:get-state", (event) => (
    isRadialMenuSender(event) ? radialMenuState() : null
  ));
  ipcMain.handle("taskpet:radial-menu:action", (event, action) => (
    isRadialMenuSender(event) ? performRadialMenuAction(action) : {ok: false, error: "无效窗口"}
  ));
  ipcMain.handle("taskpet:radial-menu:update", async (event, raw) => {
    if (!isRadialMenuSender(event)) throw new Error("无效窗口");
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("无效调节请求");
    if (raw.radialMenu) {
      if (Object.keys(raw.radialMenu).some(key => !["opacity", "scale"].includes(key))) throw new Error("无效轮盘调节项");
      raw = {...raw, radialMenu: {...settings.radialMenu, ...raw.radialMenu}};
    }
    const parsed = UpdateAppSettingsInputSchema.parse(raw);
    if (Object.keys(parsed).some(key => !["petOpacity", "petScale", "radialMenu"].includes(key))) throw new Error("不支持的轮盘设置");
    await applyTraySetting(parsed);
    return radialMenuState();
  });
  ipcMain.handle("taskpet:radial-menu:music", (event, command) => {
    if (!isRadialMenuSender(event) || !["status", "previous", "toggle", "next"].includes(command)) return {available: false, error: "无效音乐请求"};
    return musicService.execute(command);
  });
  ipcMain.handle("taskpet:radial-menu:icon", (event, id) => isRadialMenuSender(event) && typeof id === "string" ? radialAppIcon(id) : null);
  ipcMain.on("taskpet:radial-menu:close", (event) => {
    if (isRadialMenuSender(event)) hideRadialMenu();
  });

  ipcMain.on("taskpet:key-bubbles:ready", (event) => {
    if (!isKeyBubbleSender(event)) return;
    keyBubbleReady = true;
    markSmokeReady("keyBubbles");
    positionKeyBubbleWindow();
    const labels = pendingKeyBubbleLabels;
    pendingKeyBubbleLabels = [];
    for (const label of labels) pushKeyBubble(label);
  });
  ipcMain.on("taskpet:key-bubbles:empty", (event, sequence) => {
    if (
      isKeyBubbleSender(event)
      && Number.isSafeInteger(sequence)
      && sequence === keyBubbleSequence
    ) keyBubbleWindow.hide();
  });
}

function configureMacMenuBarMode() {
  if (process.platform !== "darwin") return;
  app.setActivationPolicy("accessory");
  app.dock.hide();
}

// ---------- Electron 应用生命周期 ----------

app.whenReady().then(async () => {
  configureMacMenuBarMode();
  if (process.platform === "win32") app.setAppUserModelId(APP_ID);
  if (IS_LOGIN_ITEM_SMOKE_TEST) {
    await runPackagedLoginItemSmokeTest();
    app.exit(0);
    return;
  }
  if (IS_NATIVE_PROCESS_SMOKE_TEST) {
    await runPackagedNativeProcessSmokeTest();
    app.exit(0);
    return;
  }
  const dataPaths = getDataPaths();
  fs.mkdirSync(dataPaths.logsDirectory, { recursive: true });
  fs.mkdirSync(dataPaths.backupDirectory, { recursive: true });
  logger = createFileLogger({ logsDirectory: dataPaths.logsDirectory });
  logger.info(
    `Application start version=${app.getVersion()} packaged=${String(app.isPackaged)}`
  );
  loginItemService = new LoginItemService(app, {
    platform: process.platform,
    executablePath: process.execPath,
    appName: APP_NAME
  });
  loadSettings();
  saveSettings();
  if (process.platform === "win32") {
    try { doubleClickDelayMs = require("koffi").load("user32.dll").func("uint32_t __stdcall GetDoubleClickTime()")(); }
    catch { /* Windows default if native timing is unavailable. */ }
  }
  discoverPets();
  registerIpcHandlers();
  createPetWindow();
  initializeKeyboardMappingMonitor();
  taskSystem = new TaskSystem({
    databasePath: IS_SMOKE_TEST
      ? ":memory:"
      : dataPaths.databasePath,
    dataDirectory: dataPaths.dataDirectory,
    backupDirectory: dataPaths.backupDirectory,
    panelPreloadPath: path.join(__dirname, "..", "build", "preload", "panel-preload.js"),
    panelHtmlPath: path.join(__dirname, "renderer", "panel", "index.html"),
    settingsPreloadPath: path.join(__dirname, "..", "build", "preload", "settings-preload.js"),
    settingsHtmlPath: path.join(__dirname, "renderer", "settings", "index.html"),
    icon: createAppIcon(),
    onPetState: (state, message, detail) => petState.setState(state, { message, detail }),
    onPanelReady: (ready) => markSmokeReady("panel", ready),
    onSettingsReady: (ready) => markSmokeReady("settings", ready),
    onMonitoringStateChanged: () => { rebuildTrayMenu(); broadcastRadialMenuState(); },
    settings: {
      chooseRadialApp,
      radialAppIcon,
      testRadialApp: id => launchRadialApp(id, settings.radialMenu, target => shell.openPath(target)),
      getSnapshot: () => appSettingsSnapshot(),
      update: (input) => applyAppSettings(input),
      importPetZip: (parentWindow) => importPetZipFile(parentWindow),
      importDroppedPetZip,
      importPetFolder,
      openPetDex,
      openPetDexCreate,
      openStartupApps: openWindowsStartupApps,
      openGitHub,
      openLicenses: openThirdPartyLicenses,
      setKeyboardCaptureActive: (active) => keyboardMappingMonitor?.setSuppressed(active)
    },
    logger
  });
  taskSystem.initialize();
  if (IS_SMOKE_TEST) {
    // smoke 显式走首次打开路径，覆盖面板/设置窗口的懒创建。
    taskSystem.showPanel(petWindowBounds());
    taskSystem.showSettings();
    createRadialMenuWindow();
    createKeyBubbleWindow();
  }
  createTray();
  overlayTimer = setInterval(refreshOverlayOrder, 2000);
  overlayTimer.unref();
  powerMonitor.on("resume", refreshOverlayOrder);
  screen.on("display-metrics-changed", refreshOverlayOrder);
  screen.on("display-removed", () => { recallPetWindow(); hideRadialMenu(); refreshOverlayOrder(); });
  if (IS_SMOKE_TEST) {
    smokeTimeout = setTimeout(() => {
      console.error("TaskPet smoke test timed out before renderer initialization");
      app.exit(1);
    }, 10_000);
  }
}).catch((error) => {
  console.error(`TaskPet failed to start: ${error.stack || error.message}`);
  logger?.error("Application failed to start", error);
  app.exit(1);
});

app.on("activate", () => {
  if (!petWindow) {
    createPetWindow();
    initializeKeyboardMappingMonitor();
  }
  else petWindow.show();
});

app.on("window-all-closed", () => {
  // The tray owns the application lifecycle; quitting is explicit from its menu.
});

app.on("before-quit", () => {
  clearInterval(overlayTimer);
  musicService.dispose();
  clearTimeout(smokeTimeout);
  keyboardMappingMonitor?.close();
  keyboardMappingMonitor = null;
  saveWindowBounds();
  taskSystem?.close();
  taskSystem = null;
  logger?.info("Application shutdown");
});
