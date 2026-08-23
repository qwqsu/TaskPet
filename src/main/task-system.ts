import {
  BrowserWindow,
  ipcMain,
  screen,
  type IpcMainEvent,
  type NativeImage,
  type Rectangle,
  type WebContents
} from "electron";
import { openTaskDatabase, type TaskDatabase } from "./db/database";
import { PanelReadyInputSchema } from "../shared/task-schemas";
import { TASK_CHANNELS } from "./ipc/task-channels";
import { registerTaskIpc } from "./ipc/register-task-ipc";
import { TaskService } from "./services/task-service";
import { createTaskPanelWindowOptions } from "./windows/task-panel-window";

export interface TaskSystemOptions {
  databasePath: string;
  panelPreloadPath: string;
  panelHtmlPath: string;
  icon?: NativeImage;
  onCompleted: (title: string) => void;
  onPanelReady?: (ready: boolean) => void;
}

export class TaskSystem {
  private readonly database: TaskDatabase;
  private readonly service: TaskService;
  private panelWindow: BrowserWindow | null = null;
  private pendingShow = false;
  private disposeTaskIpc: (() => void) | null = null;

  constructor(private readonly options: TaskSystemOptions) {
    this.database = openTaskDatabase(options.databasePath);
    this.service = new TaskService(this.database);
  }

  initialize(): void {
    this.disposeTaskIpc = registerTaskIpc({
      ipcMain,
      service: this.service,
      isTrustedSender: (event) => this.isPanelSender(event),
      onChanged: () => this.broadcastChanged(),
      onCompleted: this.options.onCompleted
    });
    ipcMain.on(TASK_CHANNELS.rendererReady, this.handleRendererReady);
    this.createPanelWindow();
  }

  togglePanel(anchorBounds?: Rectangle | null): void {
    if (!this.panelWindow || this.panelWindow.isDestroyed()) {
      this.pendingShow = true;
      this.createPanelWindow();
      return;
    }

    if (this.panelWindow.isVisible()) {
      this.panelWindow.hide();
      return;
    }

    this.showPanel(anchorBounds);
  }

  showPanel(anchorBounds?: Rectangle | null): void {
    if (!this.panelWindow || this.panelWindow.isDestroyed()) {
      this.pendingShow = true;
      this.createPanelWindow();
      return;
    }

    this.positionPanel(anchorBounds);
    if (this.panelWindow.webContents.isLoading()) {
      this.pendingShow = true;
      return;
    }

    this.panelWindow.show();
    this.panelWindow.focus();
  }

  close(): void {
    this.disposeTaskIpc?.();
    this.disposeTaskIpc = null;
    ipcMain.removeListener(TASK_CHANNELS.rendererReady, this.handleRendererReady);

    if (this.panelWindow && !this.panelWindow.isDestroyed()) {
      this.panelWindow.destroy();
    }
    this.panelWindow = null;

    if (this.database.open) this.database.close();
  }

  private createPanelWindow(): void {
    const panelWindow = new BrowserWindow(createTaskPanelWindowOptions({
      preloadPath: this.options.panelPreloadPath,
      icon: this.options.icon
    }));
    this.panelWindow = panelWindow;

    panelWindow.loadFile(this.options.panelHtmlPath);
    panelWindow.once("ready-to-show", () => {
      if (!this.pendingShow || panelWindow.isDestroyed()) return;
      this.pendingShow = false;
      this.positionPanel(null);
      panelWindow.show();
      panelWindow.focus();
    });
    panelWindow.webContents.on("did-fail-load", (_event, code, description) => {
      console.error(`TaskPet task panel failed to load (${code}): ${description}`);
      this.options.onPanelReady?.(false);
    });
    panelWindow.on("closed", () => {
      if (this.panelWindow === panelWindow) this.panelWindow = null;
    });
  }

  private positionPanel(anchorBounds?: Rectangle | null): void {
    if (!this.panelWindow || this.panelWindow.isDestroyed()) return;

    const display = anchorBounds
      ? screen.getDisplayMatching(anchorBounds)
      : screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const workArea = display.workArea;
    const bounds = this.panelWindow.getBounds();
    const anchor = anchorBounds ?? {
      x: workArea.x + workArea.width,
      y: workArea.y + workArea.height,
      width: 0,
      height: 0
    };

    let x = anchor.x - bounds.width - 12;
    if (x < workArea.x) x = anchor.x + anchor.width + 12;
    x = Math.max(workArea.x, Math.min(x, workArea.x + workArea.width - bounds.width));

    let y = anchor.y + anchor.height - bounds.height;
    y = Math.max(workArea.y, Math.min(y, workArea.y + workArea.height - bounds.height));
    this.panelWindow.setPosition(Math.round(x), Math.round(y));
  }

  private isPanelSender(event: { sender: WebContents }): boolean {
    return Boolean(
      this.panelWindow
      && !this.panelWindow.isDestroyed()
      && event.sender === this.panelWindow.webContents
    );
  }

  private broadcastChanged(): void {
    if (!this.panelWindow || this.panelWindow.isDestroyed()) return;
    this.panelWindow.webContents.send(TASK_CHANNELS.changed);
  }

  private readonly handleRendererReady = (
    event: IpcMainEvent,
    payload: unknown
  ): void => {
    if (!this.isPanelSender(event)) return;
    const parsed = PanelReadyInputSchema.safeParse(payload);
    this.options.onPanelReady?.(parsed.success && parsed.data.ok);
  };
}
