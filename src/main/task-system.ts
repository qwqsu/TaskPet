import path from "node:path";
import {
  BrowserWindow,
  dialog,
  ipcMain,
  screen,
  type IpcMainEvent,
  type NativeImage,
  type Rectangle,
  type WebContents
} from "electron";
import { openTaskDatabase, type TaskDatabase } from "./db/database";
import { PanelReadyInputSchema } from "../shared/task-schemas";
import type {
  RunningProgram,
  TaskRuntimeEvent,
  TaskProcessRule
} from "../shared/process-types";
import { PROCESS_CHANNELS } from "./ipc/process-channels";
import { registerProcessIpc } from "./ipc/register-process-ipc";
import { registerTaskIpc } from "./ipc/register-task-ipc";
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
import { RuntimeTracker } from "./runtime/runtime-tracker";
import { TaskEventBus } from "./runtime/task-event-bus";
import { ProcessRuleService } from "./services/process-rule-service";
import { TaskService } from "./services/task-service";
import { createTaskPanelWindowOptions } from "./windows/task-panel-window";

export interface TaskSystemOptions {
  databasePath: string;
  panelPreloadPath: string;
  panelHtmlPath: string;
  icon?: NativeImage;
  onPetState: (state: RuntimePetState, message: string) => void;
  onPanelReady?: (ready: boolean) => void;
  processProvider?: ProcessProvider;
}

export class TaskSystem {
  private readonly database: TaskDatabase;
  private readonly service: TaskService;
  private readonly ruleService: ProcessRuleService;
  private readonly processProvider: ProcessProvider;
  private readonly events: TaskEventBus;
  private readonly runtime: RuntimeTracker;
  private readonly monitor: ProcessMonitor;
  private readonly petStateMachine: PetStateMachine;
  private readonly disposeRuntimeEvents: () => void;
  private panelWindow: BrowserWindow | null = null;
  private pendingShow = false;
  private disposeTaskIpc: (() => void) | null = null;
  private disposeProcessIpc: (() => void) | null = null;
  private midnightTimer: NodeJS.Timeout | null = null;
  private closing = false;

  constructor(private readonly options: TaskSystemOptions) {
    this.database = openTaskDatabase(options.databasePath);
    this.service = new TaskService(this.database);
    this.ruleService = new ProcessRuleService(this.database);
    this.processProvider = options.processProvider ?? createPlatformProcessProvider();
    this.events = new TaskEventBus();
    this.runtime = new RuntimeTracker(this.database, this.events);
    this.petStateMachine = new PetStateMachine(this.events, {
      setState: (state, message) => this.options.onPetState(state, message)
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
      onError: (error) => console.warn("TaskPet process scan failed", error)
    });
    this.disposeRuntimeEvents = this.events.subscribe(
      (event) => this.handleRuntimeEvent(event)
    );
  }

  initialize(): void {
    const recovered = this.runtime.recoverStaleSessions();
    if (recovered > 0) {
      console.info(`TaskPet recovered ${recovered} unfinished process session(s)`);
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
      onReopened: (item) => this.runtime.announceReopened(item)
    });
    this.disposeProcessIpc = registerProcessIpc({
      ipcMain,
      ruleService: this.ruleService,
      processProvider: this.processProvider,
      isTrustedSender: (event) => this.isPanelSender(event),
      pickExecutable: () => this.pickWindowsExecutable(),
      runtimeSnapshots: () => this.runtime.snapshots(),
      beforeRuleChange: (taskId) => this.stopExternalRuntime(taskId),
      onChanged: () => this.handleStoredDataChanged()
    });
    ipcMain.on(TASK_CHANNELS.rendererReady, this.handleRendererReady);
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
    ipcMain.removeListener(TASK_CHANNELS.rendererReady, this.handleRendererReady);

    if (this.panelWindow && !this.panelWindow.isDestroyed()) {
      this.panelWindow.destroy();
    }
    this.panelWindow = null;

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
      queueMicrotask(() => {
        if (!this.closing) this.reconcileWatchTargets();
      });
    }
  }

  private reconcileWatchTargets(): void {
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
    this.monitor.setTargets(targets);
  }

  private async pickWindowsExecutable(): Promise<RunningProgram | null> {
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

  private scheduleMidnightRefresh(): void {
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

  private broadcastRuntime(): void {
    if (!this.panelWindow || this.panelWindow.isDestroyed()) return;
    this.panelWindow.webContents.send(
      PROCESS_CHANNELS.runtimeChanged,
      this.runtime.snapshots()
    );
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
