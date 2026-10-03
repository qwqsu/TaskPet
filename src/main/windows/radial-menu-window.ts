/** 径向快捷菜单窗口配置与多显示器边缘约束。 */
import type {
  BrowserWindowConstructorOptions,
  NativeImage,
  Point,
  Rectangle
} from "electron";

export const RADIAL_MENU_SIZE = 300;
export const RADIAL_PANEL_HEIGHT = 100;
const EDGE_MARGIN = 8;

export interface RadialMenuWindowOptions {
  preloadPath: string;
  icon?: NativeImage;
}

/** Native hit-test region: the transparent pet body must pass clicks through. */
export function radialMenuShape(width: number, height: number, hole: Rectangle): Rectangle[] {
  const left=Math.max(0,Math.min(width,hole.x));
  const top=Math.max(0,Math.min(height,hole.y));
  const right=Math.max(left,Math.min(width,hole.x+hole.width));
  const bottom=Math.max(top,Math.min(height,hole.y+hole.height));
  return [
    {x:0,y:0,width,height:top},
    {x:0,y:top,width:left,height:bottom-top},
    {x:right,y:top,width:width-right,height:bottom-top},
    {x:0,y:bottom,width,height:height-bottom}
  ].filter(rect=>rect.width>0 && rect.height>0);
}

export function radialMenuBoundsForPoint(
  point: Point,
  workArea: Rectangle,
  size = RADIAL_MENU_SIZE
): Rectangle {
  size = Math.max(1, Math.min(size, workArea.width - 16, workArea.height - 16 - RADIAL_PANEL_HEIGHT));
  const height = size + RADIAL_PANEL_HEIGHT;
  const maxX = workArea.x + Math.max(0, workArea.width - size - EDGE_MARGIN);
  const maxY = workArea.y + Math.max(0, workArea.height - height - EDGE_MARGIN);
  return {
    x: Math.round(Math.max(workArea.x + EDGE_MARGIN, Math.min(point.x - Math.floor(size / 2), maxX))),
    y: Math.round(Math.max(workArea.y + EDGE_MARGIN, Math.min(point.y - Math.floor(size / 2), maxY))),
    width: size,
    height
  };
}

export function createRadialMenuWindowOptions(
  options: RadialMenuWindowOptions
): BrowserWindowConstructorOptions {
  if (!options.preloadPath) throw new TypeError("preloadPath is required");
  const windowOptions: BrowserWindowConstructorOptions = {
    title: "TaskPet 快捷菜单",
    width: RADIAL_MENU_SIZE,
    height: RADIAL_MENU_SIZE + RADIAL_PANEL_HEIGHT,
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
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    autoHideMenuBar: true,
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
