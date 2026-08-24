/**
 * TaskPet 的 Electron Main Process 入口。
 * 负责桌宠窗口、托盘、宠物资源、桌宠 IPC 和 TaskSystem 生命周期；任务业务本身在 src/main/ 下。
 */
const { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, screen, shell } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  discoverPets: discoverPetsInRoot,
  getActivePetsRoot,
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
  DEFAULT_PET_MOUSE_BINDINGS,
  PET_SIZE_PRESETS,
  normalizePetMouseBindings,
  normalizePetSize,
  petMouseActionForGesture
} = require("../build/shared/app-settings");
const { LoginItemService } = require("../build/main/services/login-item-service");
const { createTrayMenuTemplate } = require("../build/main/windows/tray-menu");
const { TaskSystem } = require("../build/main/task-system");

const APP_NAME = "TaskPet";
const APP_ID = "com.taskpet.shell";
const GITHUB_URL = "https://github.com/qwqsu/TaskPet";
const CODEX_HOME = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
const LOGO_PATH = path.join(__dirname, "assets", "logo.png");
const BUNDLED_PETS_ROOT = path.join(__dirname, "assets", "pets");
const IS_SMOKE_TEST = process.argv.includes("--smoke-test");
const IS_LOGIN_ITEM_SMOKE_TEST = process.argv.includes("--smoke-test-login-item");
const IS_DEBUG_PET_BOUNDS = process.argv.includes("--debug-pet-bounds");
const IS_DEBUG_PET_WORKING = process.argv.includes("--debug-pet-working");
const DEBUG_PET_SIZE = process.argv
  .find((argument) => argument.startsWith("--debug-pet-size="))
  ?.slice("--debug-pet-size=".length);
const DEBUG_PET_BOUNDS_CAPTURE_PATH = process.argv
  .find((argument) => argument.startsWith("--debug-pet-bounds-capture="))
  ?.slice("--debug-pet-bounds-capture=".length);
const SMOKE_USER_DATA_PATH = path.join(os.tmpdir(), "TaskPet-smoke");
const LOGIN_ITEM_SMOKE_NAME = "TaskPet Login Item Smoke Test";
const LOGIN_ITEM_SMOKE_ARGS = [];

// Main Process 持有原生对象；Renderer 只能通过 preload 请求有限操作。
let petWindow = null;
let tray = null;
let pets = [];
let activePet = null;
let settings = {};
let smokeTimeout = null;
let taskSystem = null;
let petDragSession = null;
let loginItemService = null;
let logger = null;
let petBoundsCaptureStarted = false;
const smokeReady = { pet: false, panel: false, settings: false };

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
  if (!smokeReady.pet || !smokeReady.panel || !smokeReady.settings) return;
  clearTimeout(smokeTimeout);
  smokeTimeout = null;
  console.log("TaskPet smoke test ready (pet + task panel + settings + SQLite)");
  setTimeout(() => app.quit(), 100);
}

function petWindowBounds() {
  return petWindow && !petWindow.isDestroyed() ? petWindow.getBounds() : null;
}

function currentPetSizePreset() {
  return PET_SIZE_PRESETS[settings.petSize] || PET_SIZE_PRESETS.normal;
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
  const stored = readJson(getSettingsPath());
  const raw = stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
  const petSize = normalizePetSize(raw.petSize, raw.zoom);
  settings = {
    ...raw,
    petSize,
    alwaysOnTop: raw.alwaysOnTop !== false,
    mouseBindings: normalizePetMouseBindings(raw.mouseBindings)
  };
  // zoom 只作为旧设置迁移输入；三档尺寸从此只由 PET_SIZE_PRESETS 决定。
  delete settings.zoom;
  if (
    IS_DEBUG_PET_BOUNDS
    && (DEBUG_PET_SIZE === "small" || DEBUG_PET_SIZE === "normal" || DEBUG_PET_SIZE === "large")
  ) {
    settings.petSize = DEBUG_PET_SIZE;
  }
}

function saveSettings() {
  try {
    fs.mkdirSync(path.dirname(getSettingsPath()), { recursive: true });
    fs.writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 2));
  } catch (error) {
    console.warn(`Failed to save TaskPet settings: ${error.message}`);
    logger?.warn("Failed to save settings", error);
  }
}

function createAppIcon() {
  try {
    const image = nativeImage.createFromPath(LOGO_PATH);
    if (!image.isEmpty()) return image;
  } catch (error) {
    console.warn(`Failed to load TaskPet icon: ${error.message}`);
  }

  return nativeImage.createFromDataURL(
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAMAAAAoLQ9TAAAAGFBMVEUAAAAYIi9i5v9y8qaZfP/90WYfKz2xyNj28m6BAAAAB3RSTlMA///f39+fn6uU/gAAAEFJREFUeNqVj0kOwCAIBQO//2XnplkYQYJGk0BHyDKJg1xmEAjJQWYNZUdGgTYosAkfiBPwYQnKN3qHf6Snw6gudTW2DdqgAhoBA3kwAAAAAElFTkSuQmCC"
  );
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

// ---------- 宠物资源发现与状态广播 ----------

function getPetStorageInfo() {
  return getActivePetsRoot({ codexHome: CODEX_HOME, settings: {} });
}

function discoverPets() {
  const storage = getPetStorageInfo();
  const preferred = process.env.TASKPET_PET_ID
    || process.env.PET_ID
    || settings.activePetKey
    || activePet?.key;

  pets = discoverPetsInRoot(storage.petsRoot, {
    bundledPetsRoot: BUNDLED_PETS_ROOT,
    onError: (message) => logger?.warn("Pet load error", message)
  });
  activePet = pets.find((pet) => pet.id === preferred || pet.key === preferred)
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

async function openCodexPetsFolder() {
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
  return {
    autoStart: loginItemService?.status ?? {
      supported: false,
      registered: false,
      willLaunch: null,
      blockedByWindows: false
    },
    petSize: settings.petSize,
    alwaysOnTop: settings.alwaysOnTop !== false,
    mouseBindings: { ...settings.mouseBindings },
    activePetKey: activePet?.key ?? null,
    pets: pets.map((pet) => ({
      key: pet.key,
      displayName: pet.displayName,
      sourceLabel: pet.sourceLabel
    })),
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
    resizePetWindow(input.petSize);
    persistSettings = true;
  }

  if (input.alwaysOnTop !== undefined) {
    settings.alwaysOnTop = input.alwaysOnTop;
    if (petWindow && !petWindow.isDestroyed()) {
      petWindow.setAlwaysOnTop(input.alwaysOnTop, "floating");
    }
    persistSettings = true;
  }

  if (input.mouseBindings !== undefined) {
    settings.mouseBindings = normalizePetMouseBindings(input.mouseBindings);
    persistSettings = true;
  }

  if (input.activePetKey !== undefined) {
    if (!setActivePet(input.activePetKey)) throw new Error("选择的宠物不存在");
    persistSettings = true;
  }

  if (persistSettings) saveSettings();
  rebuildTrayMenu();
  return appSettingsSnapshot();
}

async function applyTraySetting(input) {
  const snapshot = await applyAppSettings(input);
  taskSystem?.notifySettingsChanged();
  return snapshot;
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

  petWindow.setAlwaysOnTop(settings.alwaysOnTop !== false, "floating");
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
    petDragSession = null;
    petWindow = null;
  });
}

function saveWindowBounds() {
  if (!petWindow || petWindow.isDestroyed()) return;
  settings.windowBounds = enforcePetWindowSize();
  saveSettings();
}

function resizePetWindow(petSize) {
  if (!petWindow || petWindow.isDestroyed()) return { ok: false };

  const preset = PET_SIZE_PRESETS[petSize] || PET_SIZE_PRESETS.normal;
  const { width, height } = getPetWindowSize(preset);
  petWindow.setContentSize(width, height);
  settings.windowBounds = petWindow.getBounds();
  broadcastPetSize();
  return { ok: true, petSize, bounds: petWindow.getBounds() };
}

function recallPetWindow() {
  if (!petWindow || petWindow.isDestroyed()) return false;
  const workArea = screen.getPrimaryDisplay().workArea;
  const bounds = getCenteredPetBounds(workArea, currentPetSizePreset());
  petWindow.setContentBounds(bounds);
  petWindow.show();
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
      taskSystem?.showSettings();
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
  const items = pets.map((pet) => ({
    label: `${pet.displayName} · ${pet.sourceLabel}`,
    type: "radio",
    checked: pet.key === activePet?.key,
    click: () => selectPet(pet.key)
  }));

  if (items.length === 0) {
    items.push({ label: "未发现可用宠物", enabled: false });
  }

  return [
    ...items,
    { type: "separator" },
    { label: "重新加载宠物", click: () => reloadPets() },
    { label: "打开 Codex 宠物目录", click: () => openCodexPetsFolder() }
  ];
}

function buildTrayMenu() {
  const autoStart = loginItemService?.status ?? {
    supported: false,
    registered: false
  };
  const template = createTrayMenuTemplate({
    monitorPaused: taskSystem?.monitoringPaused ?? false,
    autoStart: autoStart.registered,
    autoStartSupported: autoStart.supported
  }, {
    openPanel: () => taskSystem?.showPanel(petWindowBounds()),
    quickAddTask: () => taskSystem?.showQuickAdd(petWindowBounds()),
    togglePet: () => {
      if (!petWindow || petWindow.isDestroyed()) return;
      petWindow.isVisible() ? petWindow.hide() : petWindow.show();
    },
    recallPet: () => recallPetWindow(),
    setMonitoringPaused: (paused) => taskSystem?.setMonitoringPaused(paused),
    setAutoStart: (enabled) => {
      void applyTraySetting({ autoStart: enabled }).catch((error) => {
        logger?.warn("Failed to change auto start from Tray", error);
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
    if (!petWindow || petWindow.isDestroyed()) return;
    petWindow.isVisible() ? petWindow.hide() : petWindow.show();
  });
}

// ---------- 桌宠 preload IPC ----------

function registerIpcHandlers() {
  ipcMain.handle("taskpet:get-initial-state", (event) => isPetWindowSender(event) ? ({
    ...petStatePayload(),
    config: {
      petSize: settings.petSize,
      preset: currentPetSizePreset(),
      debugPetBounds: IS_DEBUG_PET_BOUNDS
    }
  }) : null);

  ipcMain.on("taskpet:start-window-drag", (event) => {
    if (!isPetWindowSender(event)) return;
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
    const bindings = settings.mouseBindings || DEFAULT_PET_MOUSE_BINDINGS;
    const action = petMouseActionForGesture(bindings, gesture);
    return action ? performPetMouseAction(action) : false;
  });

  ipcMain.on("taskpet:drag-direction", (event, direction) => {
    if (!isPetWindowSender(event) || (direction !== "drag-left" && direction !== "drag-right")) return;
    petState.startDrag(direction);
  });

  ipcMain.on("taskpet:renderer-ready", (event) => {
    if (!petWindow || event.sender !== petWindow.webContents) return;
    if (IS_SMOKE_TEST) markSmokeReady("pet");
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
  discoverPets();
  registerIpcHandlers();
  createPetWindow();
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
    onMonitoringStateChanged: () => rebuildTrayMenu(),
    settings: {
      getSnapshot: () => appSettingsSnapshot(),
      update: (input) => applyAppSettings(input),
      openStartupApps: openWindowsStartupApps,
      openGitHub,
      openLicenses: openThirdPartyLicenses
    },
    logger
  });
  taskSystem.initialize();
  if (IS_SMOKE_TEST) taskSystem.showSettings();
  createTray();
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
  if (!petWindow) createPetWindow();
  else petWindow.show();
});

app.on("window-all-closed", () => {
  // The tray owns the application lifecycle; quitting is explicit from its menu.
});

app.on("before-quit", () => {
  clearTimeout(smokeTimeout);
  saveWindowBounds();
  taskSystem?.close();
  taskSystem = null;
  logger?.info("Application shutdown");
});
