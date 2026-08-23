/**
 * 透明桌宠 BrowserWindow 的尺寸、缩放和多屏防丢失规则。
 * 安全选项集中在这里，修改窗口外观时不要关闭 contextIsolation。
 */
const BASE_WINDOW_WIDTH = 240;
const BASE_WINDOW_HEIGHT = 286;
const MIN_ZOOM = 0.65;
const MAX_ZOOM = 2.4;
const MIN_VISIBLE_EDGE = 48;
const WINDOW_EDGE_MARGIN = 24;

function clampZoom(value) {
  const zoom = Number(value);
  if (!Number.isFinite(zoom)) return 1;
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
}

function finiteCoordinate(value, fallback) {
  const coordinate = Number(value);
  return Number.isFinite(coordinate) ? Math.round(coordinate) : fallback;
}

function getPetWindowSize(zoomInput) {
  const zoom = clampZoom(zoomInput);
  return {
    width: Math.round(BASE_WINDOW_WIDTH * zoom),
    height: Math.round(BASE_WINDOW_HEIGHT * zoom)
  };
}

function normalizeWorkArea(workArea) {
  const x = Number(workArea?.x);
  const y = Number(workArea?.y);
  const width = Number(workArea?.width);
  const height = Number(workArea?.height);
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
    return null;
  }

  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height)
  };
}

function overlapLength(startA, lengthA, startB, lengthB) {
  return Math.max(0, Math.min(startA + lengthA, startB + lengthB) - Math.max(startA, startB));
}

function isReachableFromWorkArea(bounds, workArea) {
  const visibleWidth = overlapLength(bounds.x, bounds.width, workArea.x, workArea.width);
  const visibleHeight = overlapLength(bounds.y, bounds.height, workArea.y, workArea.height);
  return visibleWidth >= Math.min(MIN_VISIBLE_EDGE, bounds.width)
    && visibleHeight >= Math.min(MIN_VISIBLE_EDGE, bounds.height);
}

function resolveVisiblePosition({ x, y, width, height, workAreas }) {
  const candidate = { x, y, width, height };
  const validWorkAreas = Array.isArray(workAreas)
    ? workAreas.map(normalizeWorkArea).filter(Boolean)
    : [];

  // 只要至少 48px 仍可见就保留用户位置，否则召回主显示器右下角。
  if (validWorkAreas.length === 0
    || validWorkAreas.some((workArea) => isReachableFromWorkArea(candidate, workArea))) {
    return { x, y };
  }

  const primaryWorkArea = validWorkAreas[0];
  return {
    x: Math.max(
      primaryWorkArea.x,
      primaryWorkArea.x + primaryWorkArea.width - width - WINDOW_EDGE_MARGIN
    ),
    y: Math.max(
      primaryWorkArea.y,
      primaryWorkArea.y + primaryWorkArea.height - height - WINDOW_EDGE_MARGIN
    )
  };
}

function createPetWindowOptions(options = {}) {
  if (typeof options.preloadPath !== "string" || !options.preloadPath) {
    throw new TypeError("preloadPath is required");
  }

  const zoom = clampZoom(options.zoom);
  const savedBounds = options.savedBounds || {};
  const { width, height } = getPetWindowSize(zoom);
  const position = resolveVisiblePosition({
    x: finiteCoordinate(savedBounds.x, 40),
    y: finiteCoordinate(savedBounds.y, 220),
    width,
    height,
    workAreas: options.workAreas
  });
  // 这里是 P0 桌宠壳验收的关键配置：透明、无边框、置顶、跳过任务栏。
  const windowOptions = {
    title: "TaskPet",
    width,
    height,
    x: position.x,
    y: position.y,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    resizable: false,
    movable: true,
    maximizable: false,
    fullscreenable: false,
    show: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: options.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  };

  if (options.icon) windowOptions.icon = options.icon;
  return windowOptions;
}

module.exports = {
  BASE_WINDOW_HEIGHT,
  BASE_WINDOW_WIDTH,
  MAX_ZOOM,
  MIN_ZOOM,
  clampZoom,
  createPetWindowOptions,
  getPetWindowSize,
  resolveVisiblePosition
};
