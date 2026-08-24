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
  BASE_WINDOW_HEIGHT,
  BASE_WINDOW_WIDTH,
  MAX_ZOOM,
  MIN_ZOOM,
  clampZoom,
  createPetWindowOptions,
  getCenteredPetBounds,
  getPetWindowSize
} = require("./pet-window-options");
const { createFileLogger } = require("./app-logger");
const {
  PET_SIZE_ZOOMS,
  normalizePetSize
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
const IS_DEBUG_PET_BOUNDS = process.argv.includes("--debug-pet-bounds");
const SMOKE_USER_DATA_PATH = path.join(os.tmpdir(), "TaskPet-smoke");

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
const smokeReady = { pet: false, panel: false };

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
  if (!smokeReady.pet || !smokeReady.panel) return;
  clearTimeout(smokeTimeout);
  smokeTimeout = null;
  console.log("TaskPet smoke test ready (pet + task panel + SQLite)");
  setTimeout(() => app.quit(), 100);
}

function petWindowBounds() {
  return petWindow && !petWindow.isDestroyed() ? petWindow.getBounds() : null;
}

function enforcePetWindowSize() {
  if (!petWindow || petWindow.isDestroyed()) return null;
  const bounds = petWindow.getBounds();
  const size = getPetWindowSize(settings.zoom);
  if (bounds.width !== size.width || bounds.height !== size.height) {
    petWindow.setBounds({ x: bounds.x, y: bounds.y, ...size });
  }
  return petWindow.getBounds();
}

function startPetWindowDrag() {
  if (!petWindow || petWindow.isDestroyed()) return false;
  const cursorPoint = screen.getCursorScreenPoint();
  petDragSession = createPetDragSession({
    windowBounds: petWindow.getBounds(),
    cursorPoint,
    windowSize: getPetWindowSize(settings.zoom)
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
    zoom: PET_SIZE_ZOOMS[petSize],
    alwaysOnTop: raw.alwaysOnTop !== false
  };
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

function broadcastZoom() {
  sendToPetWindow("taskpet:zoom-changed", {
    zoom: clampZoom(settings.zoom),
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
    autoStart: loginItemService?.enabled ?? false,
    autoStartSupported: loginItemService?.supported ?? false,
    petSize: settings.petSize,
    alwaysOnTop: settings.alwaysOnTop !== false,
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

function applyAppSettings(input) {
  let persistSettings = false;

  if (input.autoStart !== undefined) {
    if (!loginItemService?.supported) {
      throw new Error("开机自动启动仅在 TaskPet 安装版中可用");
    }
    const enabled = loginItemService.setEnabled(input.autoStart);
    if (enabled !== input.autoStart) throw new Error("Windows 未能更新开机启动状态");
    logger?.info(`Auto start ${enabled ? "enabled" : "disabled"}`);
  }

  if (input.petSize !== undefined) {
    settings.petSize = input.petSize;
    settings.zoom = PET_SIZE_ZOOMS[input.petSize];
    resizePetWindow(settings.zoom);
    persistSettings = true;
  }

  if (input.alwaysOnTop !== undefined) {
    settings.alwaysOnTop = input.alwaysOnTop;
    if (petWindow && !petWindow.isDestroyed()) {
      petWindow.setAlwaysOnTop(input.alwaysOnTop, "floating");
    }
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

function applyTraySetting(input) {
  const snapshot = applyAppSettings(input);
  taskSystem?.notifySettingsChanged();
  return snapshot;
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
    zoom: settings.zoom,
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

function resizePetWindow(zoomInput) {
  if (!petWindow || petWindow.isDestroyed()) return { ok: false };

  const zoom = clampZoom(zoomInput);
  const bounds = petWindow.getBounds();
  const { width, height } = getPetWindowSize(zoom);
  petWindow.setBounds({ x: bounds.x, y: bounds.y, width, height });
  settings.zoom = zoom;
  settings.windowBounds = petWindow.getBounds();
  broadcastZoom();
  return { ok: true, zoom, bounds: petWindow.getBounds() };
}

function recallPetWindow() {
  if (!petWindow || petWindow.isDestroyed()) return false;
  const workArea = screen.getPrimaryDisplay().workArea;
  const bounds = getCenteredPetBounds(workArea, settings.zoom);
  petWindow.setBounds(bounds);
  petWindow.show();
  settings.windowBounds = petWindow.getBounds();
  saveSettings();
  logger?.info("Pet recalled to the primary display center");
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
  const template = createTrayMenuTemplate({
    monitorPaused: taskSystem?.monitoringPaused ?? false,
    autoStart: loginItemService?.enabled ?? false,
    autoStartSupported: loginItemService?.supported ?? false
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
      try {
        applyTraySetting({ autoStart: enabled });
      } catch (error) {
        logger?.warn("Failed to change auto start from Tray", error);
        rebuildTrayMenu();
      }
    },
    openSettings: () => taskSystem?.showSettings(petWindowBounds()),
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
      zoom: clampZoom(settings.zoom),
      minZoom: MIN_ZOOM,
      maxZoom: MAX_ZOOM,
      baseWindowWidth: BASE_WINDOW_WIDTH,
      baseWindowHeight: BASE_WINDOW_HEIGHT,
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

  ipcMain.on("taskpet:drag-direction", (event, direction) => {
    if (!isPetWindowSender(event) || (direction !== "drag-left" && direction !== "drag-right")) return;
    petState.startDrag(direction);
  });

  ipcMain.on("taskpet:renderer-ready", (event) => {
    if (!IS_SMOKE_TEST || !petWindow || event.sender !== petWindow.webContents) return;
    markSmokeReady("pet");
  });
}

function configureMacMenuBarMode() {
  if (process.platform !== "darwin") return;
  app.setActivationPolicy("accessory");
  app.dock.hide();
}

// ---------- Electron 应用生命周期 ----------

app.whenReady().then(() => {
  configureMacMenuBarMode();
  if (process.platform === "win32") app.setAppUserModelId(APP_ID);
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
    icon: createAppIcon(),
    onPetState: (state, message, detail) => petState.setState(state, { message, detail }),
    onPanelReady: (ready) => markSmokeReady("panel", ready),
    onMonitoringStateChanged: () => rebuildTrayMenu(),
    settings: {
      getSnapshot: () => appSettingsSnapshot(),
      update: (input) => applyAppSettings(input),
      openGitHub,
      openLicenses: openThirdPartyLicenses
    },
    logger
  });
  taskSystem.initialize();
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
