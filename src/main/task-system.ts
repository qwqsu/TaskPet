/**
 * 任务子系统总协调器。
 * 组装 SQLite、Service、IPC、ProcessMonitor、RuntimeTracker、PetStateMachine 和任务面板窗口。
 */
import path from "node:path";
import {
  BrowserWindow,
  dialog,
  ipcMain,
  screen,
  shell,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type NativeImage,
  type Rectangle,
  type WebContents
} from "electron";
import { openTaskDatabase, type TaskDatabase } from "./db/database";
import { latestSchemaVersion } from "./db/migrations";
import type {
  AppSettingsSnapshot,
  PanelCommand,
  UpdateAppSettingsInput
} from "../shared/app-settings";
import { PanelReadyInputSchema } from "../shared/task-schemas";
import type {
  RunningProgram,
  TaskRuntimeEvent,
  TaskProcessRule
} from "../shared/process-types";
import { PROCESS_CHANNELS } from "./ipc/process-channels";
import { registerProcessIpc } from "./ipc/register-process-ipc";
import { registerSettingsIpc } from "./ipc/register-settings-ipc";
import { registerTaskIpc } from "./ipc/register-task-ipc";
import { SETTINGS_CHANNELS } from "./ipc/settings-channels";
import { TASK_CHANNELS } from "./ipc/task-channels";
import {
  ProcessMonitor,
  type ProcessWatchTarget
} from "./process/process-monitor";
import {
  createPlatformProcessProvider,
  type ProcessProvider
} from "./process/process-provider";
import { PetStateMachine, type RuntimePetState } from "./runtime/pet-state-machine";
import { MonitorControl } from "./runtime/monitor-control";
import { RuntimeTracker } from "./runtime/runtime-tracker";
import { TaskEventBus } from "./runtime/task-event-bus";
import { DataService } from "./services/data-service";
import { ProcessRuleService } from "./services/process-rule-service";
import { TaskService, TaskServiceError } from "./services/task-service";
import { TimeStatsService } from "./services/time-stats-service";
import { createSettingsWindowOptions } from "./windows/settings-window";
import { createTaskPanelWindowOptions } from "./windows/task-panel-window";

export interface TaskSystemLogger {
  info(message: string): void;
  warn(message: string, error?: unknown): void;
  error(message: string, error?: unknown): void;
}

export interface TaskSystemSettingsAdapter {
  getSnapshot(): AppSettingsSnapshot;
  update(input: UpdateAppSettingsInput): AppSettingsSnapshot;
  openGitHub(): Promise<void>;
  openLicenses(): Promise<void>;
}

export interface TaskSystemOptions {
  databasePath: string;
  dataDirectory: string;
  backupDirectory: string;
  panelPreloadPath: string;
  panelHtmlPath: string;
  settingsPreloadPath: string;
  settingsHtmlPath: string;
  icon?: NativeImage;
  onPetState: (state: RuntimePetState, message: string, detail?: string) => void;
  onPanelReady?: (ready: boolean) => void;
  onSettingsReady?: (ready: boolean) => void;
  onMonitoringStateChanged?: (paused: boolean) => void;
  settings: TaskSystemSettingsAdapter;
  logger?: TaskSystemLogger;
  processProvider?: ProcessProvider;
}

export class TaskSystem {
  private readonly database: TaskDatabase;
  private readonly service: TaskService;
  private readonly ruleService: ProcessRuleService;
  private readonly timeStats: TimeStatsService;
  private readonly processProvider: ProcessProvider;
  private readonly events: TaskEventBus;
  private readonly runtime: RuntimeTracker;
  private readonly monitor: ProcessMonitor;
  private readonly monitorControl: MonitorControl;
  private readonly petStateMachine: PetStateMachine;
  private readonly dataService: DataService;
  private readonly logger: TaskSystemLogger;
  private readonly disposeRuntimeEvents: () => void;
  private panelWindow: BrowserWindow | null = null;
  private settingsWindow: BrowserWindow | null = null;
  private pendingShow = false;
  private pendingSettingsShow = false;
  private disposeTaskIpc: (() => void) | null = null;
  private disposeProcessIpc: (() => void) | null = null;
  private disposeSettingsIpc: (() => void) | null = null;
  private midnightTimer: NodeJS.Timeout | null = null;
  private pendingPanelCommand: PanelCommand | null = null;
  private panelReady = false;
  private closing = false;

  constructor(private readonly options: TaskSystemOptions) {
    // 依赖在 Main Process 内组装；Renderer 只能看到 preload 暴露的最小 API。
    this.logger = options.logger ?? {
      info: (message) => console.info(message),
      warn: (message, error) => console.warn(message, error),
      error: (message, error) => console.error(message, error)
    };
    this.database = openTaskDatabase(options.databasePath, {
      backupDirectory: options.backupDirectory,
      onBackupCreated: () => {
        this.logger.info("Database pre-migration backup created");
      },
      onMigrationApplied: (migration) => {
        this.logger.info(`Database migration applied: ${migration.name}`);
      }
    });
    this.logger.info(`Database ready at schema ${latestSchemaVersion()}`);
    this.service = new TaskService(this.database);
    this.ruleService = new ProcessRuleService(this.database);
    this.processProvider = options.processProvider ?? createPlatformProcessProvider();
    this.events = new TaskEventBus();
    this.runtime = new RuntimeTracker(this.database, this.events);
    this.timeStats = new TimeStatsService(this.database, this.runtime);
    this.petStateMachine = new PetStateMachine(this.events, {
      setState: (state, message, detail) => this.options.onPetState(state, message, detail)
    });
    this.monitor = new ProcessMonitor(this.processProvider, {
      onStarted: (taskId, processInfo, observedAt) => {
        return this.runtime.startTask(taskId, processInfo, observedAt);
      },
      onSeen: (taskId, processInfo) => this.runtime.seeTask(taskId, processInfo),
      onSuspectedExit: (taskId, missingSince) => {
        this.runtime.suspectTaskExit(taskId, missingSince);
      },
      onStopped: (taskId, stoppedAt) => this.runtime.stopTask(taskId, stoppedAt),
      onError: (error) => this.logger.warn("Process monitor scan failed", error)
    });
    this.monitorControl = new MonitorControl(this.monitor, this.runtime);
    this.disposeRuntimeEvents = this.events.subscribe(
      (event) => this.handleRuntimeEvent(event)
    );
    this.dataService = new DataService(this.database, {
      databasePath: options.databasePath,
      dataDirectory: options.dataDirectory,
      backupDirectory: options.backupDirectory,
      showSaveDialog: (dialogOptions) => {
        const parent = this.settingsWindow && !this.settingsWindow.isDestroyed()
          ? this.settingsWindow
          : this.panelWindow && !this.panelWindow.isDestroyed()
            ? this.panelWindow
            : null;
        return parent
          ? dialog.showSaveDialog(parent, dialogOptions)
          : dialog.showSaveDialog(dialogOptions);
      },
      openPath: (targetPath) => shell.openPath(targetPath),
      logger: this.logger
    });
  }

  initialize(): void {
    // 初始化顺序：恢复旧 Session → 注册 IPC → 创建面板 → 建立监控目标 → 安排跨日刷新。
    const recovered = this.runtime.recoverStaleSessions();
    if (recovered > 0) {
      this.logger.info(`Recovered ${recovered} unfinished process session(s)`);
    }

    this.disposeTaskIpc = registerTaskIpc({
      ipcMain,
      service: this.service,
      isTrustedSender: (event) => this.isPanelSender(event),
      beforeTaskUpdate: (taskId) => this.stopExternalRuntime(taskId),
      beforeTaskArchive: (taskId) => this.stopExternalRuntime(taskId),
      beforeOccurrenceComplete: (occurrenceId) => {
        this.runtime.stopOccurrence(occurrenceId);
      },
      onChanged: () => this.handleStoredDataChanged(),
      onCompleted: (item) => this.runtime.announceManualCompletion(item),
      onReopened: (item) => this.runtime.announceReopened(item),
      getTimeStats: (period) => this.timeStats.get(period)
    });
    this.disposeProcessIpc = registerProcessIpc({
      ipcMain,
      ruleService: this.ruleService,
      processProvider: this.processProvider,
      isTrustedSender: (event) => this.isPanelSender(event),
      pickExecutable: () => this.pickWindowsExecutable(),
      launchTask: (taskId) => this.launchBoundProgram(taskId),
      runtimeSnapshots: () => this.runtime.snapshots(),
      beforeRuleChange: (taskId) => this.stopExternalRuntime(taskId),
      onChanged: () => this.handleStoredDataChanged()
    });
    this.disposeSettingsIpc = registerSettingsIpc({
      ipcMain,
      isTrustedSender: (event) => this.isSettingsSender(event),
      getSettings: () => this.options.settings.getSnapshot(),
      updateSettings: (input) => {
        const snapshot = this.options.settings.update(input);
        this.broadcastSettings(snapshot);
        return snapshot;
      },
      openDataDirectory: () => this.dataService.openDataDirectory(),
      exportBackup: () => this.dataService.exportBackup(),
      openGitHub: () => this.options.settings.openGitHub(),
      openLicenses: () => this.options.settings.openLicenses()
    });
    ipcMain.handle(TASK_CHANNELS.rendererReady, this.handleRendererReady);
    ipcMain.on(SETTINGS_CHANNELS.rendererReady, this.handleSettingsRendererReady);
    this.createPanelWindow();
    this.reconcileWatchTargets();
    this.scheduleMidnightRefresh();
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

  showQuickAdd(anchorBounds?: Rectangle | null): void {
    this.showPanelCommand("open-add-task", anchorBounds);
  }

  showSettings(): void {
    if (!this.settingsWindow || this.settingsWindow.isDestroyed()) {
      this.pendingSettingsShow = true;
      this.createSettingsWindow();
      return;
    }
    if (this.settingsWindow.webContents.isLoading()) {
      this.pendingSettingsShow = true;
      return;
    }
    this.settingsWindow.show();
    this.settingsWindow.focus();
  }

  get monitoringPaused(): boolean {
    return this.monitorControl.isPaused;
  }

  setMonitoringPaused(paused: boolean): boolean {
    const changed = this.monitorControl.setPaused(paused);
    if (!changed) return false;
    this.logger.info(paused ? "Task monitoring paused" : "Task monitoring resumed");
    this.options.onMonitoringStateChanged?.(paused);
    this.broadcastChanged();
    this.broadcastRuntime();
    return true;
  }

  notifySettingsChanged(): void {
    this.broadcastSettings(this.options.settings.getSnapshot());
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
    this.flushPanelCommand();
  }

  close(): void {
    // 先停止产生新事件的 timer/monitor，再销毁 IPC、窗口和数据库连接。
    this.closing = true;
    if (this.midnightTimer) clearTimeout(this.midnightTimer);
    this.midnightTimer = null;
    this.monitor.close();
    this.runtime.shutdown();
    this.disposeRuntimeEvents();
    this.petStateMachine.dispose();

    this.disposeTaskIpc?.();
    this.disposeTaskIpc = null;
    this.disposeProcessIpc?.();
    this.disposeProcessIpc = null;
    this.disposeSettingsIpc?.();
    this.disposeSettingsIpc = null;
    ipcMain.removeHandler(TASK_CHANNELS.rendererReady);
    ipcMain.removeListener(
      SETTINGS_CHANNELS.rendererReady,
      this.handleSettingsRendererReady
    );

    if (this.panelWindow && !this.panelWindow.isDestroyed()) {
      this.panelWindow.destroy();
    }
    this.panelWindow = null;
    this.panelReady = false;
    this.pendingPanelCommand = null;

    if (this.settingsWindow && !this.settingsWindow.isDestroyed()) {
      this.settingsWindow.destroy();
    }
    this.settingsWindow = null;
    this.pendingSettingsShow = false;

    if (this.database.open) this.database.close();
  }

  private stopExternalRuntime(taskId: string): void {
    this.runtime.stopTask(taskId);
    this.monitor.forgetTask(taskId);
  }

  private handleStoredDataChanged(): void {
    if (this.closing) return;
    this.reconcileWatchTargets();
    this.broadcastChanged();
    this.broadcastRuntime();
  }

  private handleRuntimeEvent(event: TaskRuntimeEvent): void {
    if (this.closing) return;
    this.broadcastRuntime();
    if (event.type !== "TASK_PROGRESS") this.broadcastChanged();
    if (event.type === "TASK_COMPLETED") {
      this.logger.info(`Task completed: ${event.task.title}`);
      // 等完成事件当前调用栈结束后再移除监控目标，避免修改正在遍历的数据。
      queueMicrotask(() => {
        if (!this.closing) this.reconcileWatchTargets();
      });
    }
  }

  private reconcileWatchTargets(): void {
    // 只监控“今日未完成且存在程序规则”的任务；空列表会让 ProcessMonitor 自动停表。
    const rulesByTask = new Map<string, TaskProcessRule[]>();
    for (const rule of this.ruleService.listRules()) {
      const rules = rulesByTask.get(rule.taskId) ?? [];
      rules.push(rule);
      rulesByTask.set(rule.taskId, rules);
    }

    const targets: ProcessWatchTarget[] = [];
    for (const item of this.service.getTodayTasks()) {
      if (item.occurrence.status === "completed") continue;
      const rules = rulesByTask.get(item.task.id) ?? [];
      if (rules.length > 0) targets.push({ taskId: item.task.id, rules });
    }
    this.monitorControl.setTargets(targets);
  }

  private showPanelCommand(command: PanelCommand, anchorBounds?: Rectangle | null): void {
    this.pendingPanelCommand = command;
    this.showPanel(anchorBounds);
  }

  private async pickWindowsExecutable(): Promise<RunningProgram | null> {
    // 文件选择器只允许用户明确选择 .exe，不接受 Renderer 传来的任意 shell command。
    if (process.platform !== "win32") return null;
    const dialogOptions = {
      title: "选择要绑定的 Windows 程序",
      buttonLabel: "绑定程序",
      properties: ["openFile"] as Array<"openFile">,
      filters: [{ name: "Windows 程序", extensions: ["exe"] }]
    };
    const result = this.panelWindow && !this.panelWindow.isDestroyed()
      ? await dialog.showOpenDialog(this.panelWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);
    if (result.canceled || result.filePaths.length !== 1) return null;
    const executablePath = result.filePaths[0];
    if (!executablePath || !/\.exe$/i.test(executablePath)) return null;
    return {
      executableName: path.win32.basename(executablePath),
      executablePath: path.win32.normalize(executablePath),
      pidCount: 0
    };
  }

  private async launchBoundProgram(taskId: string): Promise<boolean> {
    const rule = this.ruleService.listRulesForTask(taskId).find((candidate) => (
      candidate.matchMode === "exact_path"
      && typeof candidate.executablePath === "string"
      && /\.exe$/i.test(candidate.executablePath)
    ));
    if (!rule?.executablePath || process.platform !== "win32") {
      throw new TaskServiceError(
        "CONFLICT",
        "当前任务没有可启动的精确 exe 绑定，请重新选择程序文件"
      );
    }
    const errorMessage = await shell.openPath(rule.executablePath);
    if (errorMessage) throw new Error(errorMessage);
    return true;
  }

  private scheduleMidnightRefresh(): void {
    // 00:00 后刷新 daily occurrence 和 watch targets；100ms 偏移避免卡在边界前。
    if (this.midnightTimer) clearTimeout(this.midnightTimer);
    const now = new Date();
    const nextMidnight = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1,
      0,
      0,
      0,
      100
    );
    const delayMs = Math.max(1_000, nextMidnight.getTime() - now.getTime());
    this.midnightTimer = setTimeout(() => {
      this.midnightTimer = null;
      this.handleStoredDataChanged();
      this.scheduleMidnightRefresh();
    }, delayMs);
  }

  private createPanelWindow(): void {
    const panelWindow = new BrowserWindow(createTaskPanelWindowOptions({
      preloadPath: this.options.panelPreloadPath,
      icon: this.options.icon
    }));
    this.panelWindow = panelWindow;
    this.panelReady = false;

    panelWindow.loadFile(this.options.panelHtmlPath);
    panelWindow.once("ready-to-show", () => {
      if (!this.pendingShow || panelWindow.isDestroyed()) return;
      this.pendingShow = false;
      this.positionPanel(null);
      panelWindow.show();
      panelWindow.focus();
      this.flushPanelCommand();
    });
    panelWindow.webContents.on("did-fail-load", (_event, code, description) => {
      console.error(`TaskPet task panel failed to load (${code}): ${description}`);
      this.options.onPanelReady?.(false);
    });
    panelWindow.on("closed", () => {
      if (this.panelWindow === panelWindow) {
        this.panelWindow = null;
        this.panelReady = false;
      }
    });
  }

  private createSettingsWindow(): void {
    const settingsWindow = new BrowserWindow(createSettingsWindowOptions({
      preloadPath: this.options.settingsPreloadPath,
      icon: this.options.icon
    }));
    this.settingsWindow = settingsWindow;
    settingsWindow.loadFile(this.options.settingsHtmlPath);
    settingsWindow.once("ready-to-show", () => {
      if (!this.pendingSettingsShow || settingsWindow.isDestroyed()) return;
      this.pendingSettingsShow = false;
      settingsWindow.show();
      settingsWindow.focus();
    });
    settingsWindow.webContents.on("did-fail-load", (_event, code, description) => {
      console.error(`TaskPet settings window failed to load (${code}): ${description}`);
    });
    settingsWindow.on("closed", () => {
      if (this.settingsWindow === settingsWindow) {
        this.settingsWindow = null;
        this.pendingSettingsShow = false;
      }
    });
  }

  private flushPanelCommand(): void {
    if (
      !this.pendingPanelCommand
      || !this.panelReady
      || !this.panelWindow
      || this.panelWindow.isDestroyed()
      || this.panelWindow.webContents.isLoading()
    ) {
      return;
    }
    const command = this.pendingPanelCommand;
    this.pendingPanelCommand = null;
    this.panelWindow.webContents.send(TASK_CHANNELS.panelCommand, command);
  }

  private positionPanel(anchorBounds?: Rectangle | null): void {
    // 优先放在桌宠左侧，空间不足再放右侧，最后限制在当前显示器工作区内。
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
    // IPC 不仅校验参数，还必须确认请求确实来自当前任务面板 WebContents。
    return Boolean(
      this.panelWindow
      && !this.panelWindow.isDestroyed()
      && event.sender === this.panelWindow.webContents
    );
  }

  private isSettingsSender(event: { sender: WebContents }): boolean {
    return Boolean(
      this.settingsWindow
      && !this.settingsWindow.isDestroyed()
      && event.sender === this.settingsWindow.webContents
    );
  }

  private broadcastChanged(): void {
    if (!this.panelWindow || this.panelWindow.isDestroyed()) return;
    this.panelWindow.webContents.send(TASK_CHANNELS.changed);
  }

  private broadcastRuntime(): void {
    if (!this.panelWindow || this.panelWindow.isDestroyed()) return;
    this.panelWindow.webContents.send(
      PROCESS_CHANNELS.runtimeChanged,
      this.runtime.snapshots()
    );
  }

  private broadcastSettings(snapshot: AppSettingsSnapshot): void {
    if (!this.settingsWindow || this.settingsWindow.isDestroyed()) return;
    this.settingsWindow.webContents.send(SETTINGS_CHANNELS.changed, snapshot);
  }

  private readonly handleRendererReady = (
    event: IpcMainInvokeEvent,
    payload: unknown
  ): PanelCommand | null => {
    if (!this.isPanelSender(event)) return null;
    const parsed = PanelReadyInputSchema.safeParse(payload);
    const ready = parsed.success && parsed.data.ok;
    this.panelReady = ready;
    this.options.onPanelReady?.(ready);
    if (ready) {
      if (this.pendingShow && this.panelWindow && !this.panelWindow.isDestroyed()) {
        this.pendingShow = false;
        this.panelWindow.show();
        this.panelWindow.focus();
      }
      const command = this.pendingPanelCommand;
      this.pendingPanelCommand = null;
      return command;
    }
    return null;
  };

  private readonly handleSettingsRendererReady = (
    event: IpcMainEvent,
    payload: unknown
  ): void => {
    if (!this.isSettingsSender(event)) return;
    const parsed = PanelReadyInputSchema.safeParse(payload);
    this.options.onSettingsReady?.(parsed.success && parsed.data.ok);
  };
}
