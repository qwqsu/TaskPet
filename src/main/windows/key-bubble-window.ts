/** 全局按键视觉反馈窗口；永不获取焦点，也不参与鼠标命中。 */
import type {
  BrowserWindowConstructorOptions,
  NativeImage,
  Rectangle
} from "electron";

export const KEY_BUBBLE_WINDOW_SIZE = Object.freeze({ width: 280, height: 86 });
const EDGE_MARGIN = 8;
const PET_GAP = 8;

export interface KeyBubbleWindowOptions {
  preloadPath: string;
  icon?: NativeImage;
}

export function keyBubbleBoundsForPet(
  petBounds: Rectangle,
  workArea: Rectangle,
  size = KEY_BUBBLE_WINDOW_SIZE
): Rectangle {
  const preferredX = petBounds.x + (petBounds.width - size.width) / 2;
  const minX = workArea.x + EDGE_MARGIN;
  const maxX = workArea.x + Math.max(EDGE_MARGIN, workArea.width - size.width - EDGE_MARGIN);
  const preferredY = petBounds.y - size.height - PET_GAP;
  const minY = workArea.y + EDGE_MARGIN;
  const maxY = workArea.y + Math.max(EDGE_MARGIN, workArea.height - size.height - EDGE_MARGIN);
  return {
    x: Math.round(Math.max(minX, Math.min(preferredX, maxX))),
    y: Math.round(Math.max(minY, Math.min(preferredY, maxY))),
    width: size.width,
    height: size.height
  };
}

export function createKeyBubbleWindowOptions(
  options: KeyBubbleWindowOptions
): BrowserWindowConstructorOptions {
  if (!options.preloadPath) throw new TypeError("preloadPath is required");
  const windowOptions: BrowserWindowConstructorOptions = {
    title: "TaskPet 按键提示",
    width: KEY_BUBBLE_WINDOW_SIZE.width,
    height: KEY_BUBBLE_WINDOW_SIZE.height,
    useContentSize: true,
    frame: false,
    thickFrame: false,
    transparent: true,
    backgroundColor: "#00000000",
    resizable: false,
    movable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    show: false,
    focusable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: options.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  };
  if (options.icon) windowOptions.icon = options.icon;
  return windowOptions;
}

