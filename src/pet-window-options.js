/**
 * 透明桌宠 BrowserWindow 的尺寸、缩放和多屏防丢失规则。
 * 安全选项集中在这里，修改窗口外观时不要关闭 contextIsolation。
 */
const MIN_VISIBLE_EDGE = 48;
const WINDOW_EDGE_MARGIN = 24;

function finiteCoordinate(value, fallback) {
  const coordinate = Number(value);
  return Number.isFinite(coordinate) ? Math.round(coordinate) : fallback;
}

function positiveDimension(value, label) {
  const dimension = Math.round(Number(value));
  if (!Number.isFinite(dimension) || dimension <= 0) {
    throw new TypeError(`${label} must be a positive number`);
  }
  return dimension;
}

function getPetWindowSize(preset) {
  return {
    width: positiveDimension(preset?.windowWidth, "preset.windowWidth"),
    height: positiveDimension(preset?.windowHeight, "preset.windowHeight")
  };
}

function getCenteredPetBounds(workArea, preset) {
  const normalized = normalizeWorkArea(workArea);
  if (!normalized) throw new TypeError("A valid display work area is required");
  const size = getPetWindowSize(preset);
  return {
    x: Math.round(normalized.x + (normalized.width - size.width) / 2),
    y: Math.round(normalized.y + (normalized.height - size.height) / 2),
    ...size
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

  const savedBounds = options.savedBounds || {};
  const { width, height } = getPetWindowSize(options.preset);
  const position = resolveVisiblePosition({
    x: finiteCoordinate(savedBounds.x, 40),
    y: finiteCoordinate(savedBounds.y, 220),
    width,
    height,
    workAreas: options.workAreas
  });
  // 透明、无边框、置顶、跳过任务栏是桌宠壳的关键配置。
  const windowOptions = {
    title: "TaskPet",
    width,
    height,
    useContentSize: true,
    x: position.x,
    y: position.y,
    frame: false,
    thickFrame: false,
    transparent: true,
    backgroundColor: "#00000000",
    resizable: false,
    movable: true,
    maximizable: false,
    fullscreenable: false,
    show: false,
    alwaysOnTop: options.alwaysOnTop !== false,
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
  createPetWindowOptions,
  getCenteredPetBounds,
  getPetWindowSize,
  resolveVisiblePosition
};
