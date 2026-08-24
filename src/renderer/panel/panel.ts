/**
 * 任务面板 Renderer。
 * 负责表单、今日/历史渲染和程序选择；数据全部通过 sandboxed preload API 获取。
 */
type TaskType = "daily" | "one_time";
type CompletionMode = "manual" | "duration" | "process_start" | "process_exit";
type OccurrenceStatus = "pending" | "active" | "completed";
type ProcessMatchMode = "exact_path" | "process_name";
type PetSize = "large" | "normal" | "small";
type PanelView = "today" | "history" | "settings";
type PanelCommand = "open-add-task" | "open-settings";

interface Task {
  id: string;
  title: string;
  description: string | null;
  taskType: TaskType;
  completionMode: CompletionMode;
  targetDurationSec: number;
  archivedAt: string | null;
}

interface TaskOccurrence {
  id: string;
  occurrenceDate: string;
  status: OccurrenceStatus;
  accumulatedSec: number;
  completedAt: string | null;
  completionSource: CompletionMode | null;
}

interface TaskListItem {
  task: Task;
  occurrence: TaskOccurrence;
}

interface HistoryEntry extends TaskListItem {
  historyDate: string;
}

interface HistoryDay {
  date: string;
  entries: HistoryEntry[];
}

interface TaskProcessRule {
  id: string;
  taskId: string;
  executableName: string | null;
  executablePath: string | null;
  matchMode: ProcessMatchMode;
}

interface RunningProgram {
  executableName: string;
  executablePath: string | null;
  pidCount: number;
}

interface RuntimeTaskSnapshot {
  taskId: string;
  occurrenceId: string;
  title: string;
  occurrenceStatus: OccurrenceStatus;
  completionMode: CompletionMode;
  accumulatedSec: number;
  targetDurationSec: number;
  active: boolean;
}

interface AppSettingsSnapshot {
  autoStart: boolean;
  autoStartSupported: boolean;
  petSize: PetSize;
  alwaysOnTop: boolean;
  activePetKey: string | null;
  pets: Array<{ key: string; displayName: string; sourceLabel: string }>;
  dataDirectory: string;
  appName: string;
  version: string;
  githubUrl: string;
}

interface DataActionResult {
  canceled: boolean;
  filePath: string | null;
}

type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

interface TaskBridge {
  listToday(): Promise<ApiResult<TaskListItem[]>>;
  history(query: { fromDate: string; toDate: string }): Promise<ApiResult<HistoryDay[]>>;
  create(input: {
    title: string;
    description: string | null;
    taskType: TaskType;
    completionMode: "manual" | "duration";
    targetDurationSec: number;
  }): Promise<ApiResult<Task>>;
  update(id: string, patch: {
    title: string;
    description: string | null;
    completionMode: "manual" | "duration";
    targetDurationSec: number;
  }): Promise<ApiResult<Task>>;
  archive(id: string): Promise<ApiResult<Task>>;
  complete(occurrenceId: string): Promise<ApiResult<unknown>>;
  reopen(occurrenceId: string): Promise<ApiResult<unknown>>;
  rendererReady(ok: boolean): void;
  onChanged(callback: () => void): () => void;
}

interface ProcessBridge {
  listRules(): Promise<ApiResult<TaskProcessRule[]>>;
  setRule(input: {
    taskId: string;
    matchMode: ProcessMatchMode;
    executableName: string;
    executablePath: string | null;
  }): Promise<ApiResult<TaskProcessRule>>;
  removeRules(taskId: string): Promise<ApiResult<boolean>>;
  listRunning(): Promise<ApiResult<RunningProgram[]>>;
  pickExecutable(): Promise<ApiResult<RunningProgram | null>>;
}

interface RuntimeBridge {
  snapshot(): Promise<ApiResult<RuntimeTaskSnapshot[]>>;
  onChanged(callback: (snapshots: RuntimeTaskSnapshot[]) => void): () => void;
}

interface SettingsBridge {
  get(): Promise<ApiResult<AppSettingsSnapshot>>;
  update(input: {
    autoStart?: boolean;
    petSize?: PetSize;
    alwaysOnTop?: boolean;
    activePetKey?: string;
  }): Promise<ApiResult<AppSettingsSnapshot>>;
  openDataDirectory(): Promise<ApiResult<DataActionResult>>;
  exportBackup(): Promise<ApiResult<DataActionResult>>;
  openGitHub(): Promise<ApiResult<void>>;
  openLicenses(): Promise<ApiResult<void>>;
  onChanged(callback: (snapshot: AppSettingsSnapshot) => void): () => void;
}

interface UiBridge {
  onCommand(callback: (command: PanelCommand) => void): () => void;
}

interface TaskPetPanelWindow extends Window {
  taskPet: {
    tasks: TaskBridge;
    processes: ProcessBridge;
    runtime: RuntimeBridge;
    settings: SettingsBridge;
    ui: UiBridge;
  };
}

// ---------- DOM/IPC 边界辅助函数 ----------

function elementById<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing panel element: ${id}`);
  return element as T;
}

function unwrap<T>(result: ApiResult<T>): T {
  if (result.ok) return result.data;
  throw new Error(result.error.message);
}

function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDate(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "short"
  }).format(new Date(year ?? 0, (month ?? 1) - 1, day ?? 1));
}

function formatDuration(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  if (safeSeconds === 0) return "0 秒";
  const hours = Math.floor(safeSeconds / 3_600);
  const minutes = Math.floor((safeSeconds % 3_600) / 60);
  const remainingSeconds = safeSeconds % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours} 小时`);
  if (minutes > 0) parts.push(`${minutes} 分`);
  if (remainingSeconds > 0 || parts.length === 0) parts.push(`${remainingSeconds} 秒`);
  return parts.join(" ");
}

// ---------- preload API、DOM 引用和页面内存状态 ----------

const panelWindow = window as unknown as TaskPetPanelWindow;
const taskApi = panelWindow.taskPet.tasks;
const processApi = panelWindow.taskPet.processes;
const runtimeApi = panelWindow.taskPet.runtime;
const settingsApi = panelWindow.taskPet.settings;
const uiApi = panelWindow.taskPet.ui;
const pageTitle = elementById<HTMLHeadingElement>("pageTitle");
const todaySummary = elementById<HTMLParagraphElement>("todaySummary");
const statusMessage = elementById<HTMLParagraphElement>("statusMessage");
const todayView = elementById<HTMLElement>("todayView");
const historyView = elementById<HTMLElement>("historyView");
const settingsView = elementById<HTMLElement>("settingsView");
const todayList = elementById<HTMLDivElement>("todayList");
const historyList = elementById<HTMLDivElement>("historyList");
const addTaskButton = elementById<HTMLButtonElement>("addTaskButton");
const taskDialog = elementById<HTMLDialogElement>("taskDialog");
const taskForm = elementById<HTMLFormElement>("taskForm");
const dialogTitle = elementById<HTMLHeadingElement>("dialogTitle");
const editingTaskId = elementById<HTMLInputElement>("editingTaskId");
const taskTitle = elementById<HTMLInputElement>("taskTitle");
const taskDescription = elementById<HTMLTextAreaElement>("taskDescription");
const taskType = elementById<HTMLSelectElement>("taskType");
const taskTypeHint = elementById<HTMLElement>("taskTypeHint");
const completionMode = elementById<HTMLSelectElement>("completionMode");
const durationField = elementById<HTMLElement>("durationField");
const targetMinutes = elementById<HTMLInputElement>("targetMinutes");
const archiveTaskButton = elementById<HTMLButtonElement>("archiveTaskButton");
const programSummary = elementById<HTMLParagraphElement>("programSummary");
const clearProgramButton = elementById<HTMLButtonElement>("clearProgramButton");
const matchModeField = elementById<HTMLElement>("matchModeField");
const processMatchMode = elementById<HTMLSelectElement>("processMatchMode");
const matchModeHint = elementById<HTMLElement>("matchModeHint");
const chooseRunningButton = elementById<HTMLButtonElement>("chooseRunningButton");
const chooseExeButton = elementById<HTMLButtonElement>("chooseExeButton");
const runningProgramPicker = elementById<HTMLElement>("runningProgramPicker");
const runningProgramList = elementById<HTMLDivElement>("runningProgramList");
const autoStartToggle = elementById<HTMLInputElement>("autoStartToggle");
const autoStartHint = elementById<HTMLElement>("autoStartHint");
const petSelect = elementById<HTMLSelectElement>("petSelect");
const alwaysOnTopToggle = elementById<HTMLInputElement>("alwaysOnTopToggle");
const dataDirectoryPath = elementById<HTMLElement>("dataDirectoryPath");
const aboutAppName = elementById<HTMLElement>("aboutAppName");
const aboutVersion = elementById<HTMLElement>("aboutVersion");

let currentView: PanelView = "today";
let todayItems = new Map<string, TaskListItem>();
let rulesByTask = new Map<string, TaskProcessRule[]>();
let runtimeByOccurrence = new Map<string, RuntimeTaskSnapshot>();
let selectedProgram: RunningProgram | null = null;
let currentSettings: AppSettingsSnapshot | null = null;

// ---------- 今日任务与历史渲染 ----------

function setStatus(message = ""): void {
  statusMessage.textContent = message;
}

function taskMeta(item: TaskListItem): string {
  // active 任务优先使用 RuntimeTracker 的内存快照，因此界面能每秒变化而不查 SQLite。
  const runtime = runtimeByOccurrence.get(item.occurrence.id);
  const accumulatedSec = runtime?.accumulatedSec ?? item.occurrence.accumulatedSec;
  const pieces = [item.task.taskType === "daily" ? "每日" : "一次性"];
  if (runtime?.active) pieces.push("执行中");
  if (item.task.completionMode === "duration") {
    pieces.push(`目标 ${formatDuration(item.task.targetDurationSec)}`);
  } else {
    pieces.push("手动完成");
  }
  if (accumulatedSec > 0) pieces.push(`已累计 ${formatDuration(accumulatedSec)}`);
  const rule = rulesByTask.get(item.task.id)?.[0];
  if (rule?.executableName) pieces.push(rule.executableName);
  return pieces.join(" · ");
}

function emptyState(title: string, detail: string): HTMLElement {
  const container = document.createElement("div");
  container.className = "empty-state";
  const heading = document.createElement("strong");
  heading.textContent = title;
  const body = document.createElement("span");
  body.textContent = detail;
  container.append(heading, body);
  return container;
}

function renderToday(items: TaskListItem[]): void {
  todayItems = new Map(items.map((item) => [item.task.id, item]));
  const completedCount = items.filter((item) => item.occurrence.status === "completed").length;
  todaySummary.textContent = items.length === 0
    ? "今天还没有任务"
    : `已完成 ${completedCount} / ${items.length}`;

  if (items.length === 0) {
    todayList.replaceChildren(emptyState("今天很轻盈", "添加一个任务，让桌宠陪你开始。"));
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const item of items) {
    const completed = item.occurrence.status === "completed";
    const isActive = runtimeByOccurrence.get(item.occurrence.id)?.active === true;
    const card = document.createElement("article");
    card.className = completed
      ? "task-card completed"
      : isActive ? "task-card active" : "task-card";

    const checkbox = document.createElement("input");
    checkbox.className = "task-check";
    checkbox.type = "checkbox";
    checkbox.checked = completed;
    checkbox.setAttribute(
      "aria-label",
      completed ? `重新打开 ${item.task.title}` : `完成 ${item.task.title}`
    );
    checkbox.addEventListener("change", () => {
      checkbox.disabled = true;
      void changeCompletion(item, checkbox.checked);
    });

    const content = document.createElement("button");
    content.className = "task-content";
    content.type = "button";
    content.title = "编辑任务";
    content.addEventListener("click", () => openTaskDialog(item));

    const title = document.createElement("span");
    title.className = "task-title";
    title.textContent = item.task.title;
    const meta = document.createElement("span");
    meta.className = "task-meta";
    meta.textContent = taskMeta(item);
    content.append(title, meta);

    const editMark = document.createElement("span");
    editMark.className = "edit-mark";
    editMark.textContent = "›";
    editMark.setAttribute("aria-hidden", "true");

    card.append(checkbox, content, editMark);
    fragment.append(card);
  }
  todayList.replaceChildren(fragment);
}

function renderHistory(days: HistoryDay[]): void {
  const total = days.reduce((count, day) => count + day.entries.length, 0);
  todaySummary.textContent = total === 0
    ? "最近 30 天没有完成记录"
    : `最近 30 天完成 ${total} 项`;

  if (days.length === 0) {
    historyList.replaceChildren(emptyState("历史还是空白", "完成的任务会按日期保留在这里。"));
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const day of days) {
    const section = document.createElement("section");
    section.className = "history-day";
    const date = document.createElement("h2");
    date.className = "history-date";
    date.textContent = formatDate(day.date);
    section.append(date);

    for (const entry of day.entries) {
      const card = document.createElement("article");
      card.className = "history-entry";
      const title = document.createElement("strong");
      title.textContent = entry.task.title;
      const meta = document.createElement("span");
      meta.className = "history-meta";
      const time = entry.occurrence.completedAt
        ? new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" })
          .format(new Date(entry.occurrence.completedAt))
        : "";
      const completionLabel = entry.occurrence.completionSource === "manual"
        ? "手动完成"
        : entry.occurrence.completionSource === "duration"
          ? "时长完成"
          : "自动完成";
      const details = [
        entry.task.taskType === "daily" ? "每日" : "一次性",
        completionLabel,
        time
      ];
      if (entry.occurrence.accumulatedSec > 0) {
        details.push(`累计 ${formatDuration(entry.occurrence.accumulatedSec)}`);
      }
      if (entry.task.archivedAt) details.push("已归档");
      meta.textContent = details.filter(Boolean).join(" · ");
      card.append(title, meta);
      section.append(card);
    }
    fragment.append(section);
  }
  historyList.replaceChildren(fragment);
}

function renderSettings(snapshot: AppSettingsSnapshot): void {
  currentSettings = snapshot;
  todaySummary.textContent = "本地设置会立即生效";
  autoStartToggle.checked = snapshot.autoStart;
  autoStartToggle.disabled = !snapshot.autoStartSupported;
  autoStartHint.textContent = snapshot.autoStartSupported
    ? "登录 Windows 后启动 TaskPet"
    : "开机启动仅在 TaskPet 安装版中可用";
  alwaysOnTopToggle.checked = snapshot.alwaysOnTop;

  const options = snapshot.pets.map((pet) => {
    const option = document.createElement("option");
    option.value = pet.key;
    option.textContent = `${pet.displayName} · ${pet.sourceLabel}`;
    return option;
  });
  petSelect.replaceChildren(...options);
  petSelect.disabled = options.length === 0;
  if (snapshot.activePetKey) petSelect.value = snapshot.activePetKey;

  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-pet-size]")) {
    const active = button.dataset.petSize === snapshot.petSize;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }

  dataDirectoryPath.textContent = snapshot.dataDirectory;
  dataDirectoryPath.title = snapshot.dataDirectory;
  aboutAppName.textContent = snapshot.appName;
  aboutVersion.textContent = snapshot.version;
  elementById<HTMLButtonElement>("openGitHubButton").title = snapshot.githubUrl;
}

// ---------- 从 Main Process 刷新数据 ----------

function groupRules(rules: TaskProcessRule[]): Map<string, TaskProcessRule[]> {
  const grouped = new Map<string, TaskProcessRule[]>();
  for (const rule of rules) {
    const current = grouped.get(rule.taskId) ?? [];
    current.push(rule);
    grouped.set(rule.taskId, current);
  }
  return grouped;
}

async function refreshToday(): Promise<void> {
  // 三组相互独立的数据并行读取，最后以 taskId/occurrenceId 在页面内关联。
  setStatus();
  const [itemsResult, rulesResult, runtimeResult] = await Promise.all([
    taskApi.listToday(),
    processApi.listRules(),
    runtimeApi.snapshot()
  ]);
  rulesByTask = groupRules(unwrap(rulesResult));
  runtimeByOccurrence = new Map(
    unwrap(runtimeResult).map((snapshot) => [snapshot.occurrenceId, snapshot])
  );
  renderToday(unwrap(itemsResult));
}

async function refreshHistory(): Promise<void> {
  setStatus();
  const to = new Date();
  const from = new Date(to.getFullYear(), to.getMonth(), to.getDate() - 29);
  renderHistory(unwrap(await taskApi.history({
    fromDate: toDateKey(from),
    toDate: toDateKey(to)
  })));
}

async function refreshSettings(): Promise<void> {
  setStatus();
  renderSettings(unwrap(await settingsApi.get()));
}

async function updateSetting(input: Parameters<SettingsBridge["update"]>[0]): Promise<void> {
  try {
    setStatus();
    renderSettings(unwrap(await settingsApi.update(input)));
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "无法更新设置");
    if (currentSettings) renderSettings(currentSettings);
  }
}

async function openDataDirectory(): Promise<void> {
  try {
    setStatus();
    unwrap(await settingsApi.openDataDirectory());
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "无法打开数据目录");
  }
}

async function exportBackup(): Promise<void> {
  try {
    setStatus();
    const result = unwrap(await settingsApi.exportBackup());
    if (!result.canceled && result.filePath) setStatus(`备份已导出：${result.filePath}`);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "无法导出备份");
  }
}

async function changeCompletion(item: TaskListItem, complete: boolean): Promise<void> {
  try {
    setStatus();
    if (complete) unwrap(await taskApi.complete(item.occurrence.id));
    else unwrap(await taskApi.reopen(item.occurrence.id));
    await refreshToday();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "无法修改任务状态");
    await refreshToday().catch(() => undefined);
  }
}

// ---------- 任务表单与程序绑定 ----------

function syncDurationField(): void {
  const isDuration = completionMode.value === "duration";
  durationField.classList.toggle("hidden", !isDuration);
  targetMinutes.required = isDuration;
}

function syncProgramBinding(): void {
  const hasProgram = selectedProgram !== null;
  clearProgramButton.classList.toggle("hidden", !hasProgram);
  matchModeField.classList.toggle("hidden", !hasProgram);
  if (!selectedProgram) {
    programSummary.textContent = "尚未绑定程序";
    return;
  }

  const exactOption = processMatchMode.querySelector<HTMLOptionElement>(
    'option[value="exact_path"]'
  );
  if (exactOption) exactOption.disabled = !selectedProgram.executablePath;
  if (!selectedProgram.executablePath) processMatchMode.value = "process_name";
  matchModeHint.textContent = selectedProgram.executablePath
    ? "精确路径可避免同名程序误匹配。"
    : "系统无法读取该路径，只能按进程名匹配。";
  programSummary.textContent = selectedProgram.executablePath
    ? `${selectedProgram.executableName} · ${selectedProgram.executablePath}`
    : `${selectedProgram.executableName} · 仅进程名`;
}

function selectProgram(program: RunningProgram): void {
  selectedProgram = program;
  processMatchMode.value = program.executablePath ? "exact_path" : "process_name";
  runningProgramPicker.classList.add("hidden");
  syncProgramBinding();
}

function renderRunningPrograms(programs: RunningProgram[]): void {
  if (programs.length === 0) {
    runningProgramList.replaceChildren(
      emptyState("没有可选择的程序", "请先启动目标程序，或改用 exe 文件选择。")
    );
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const program of programs) {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "program-option";
    const name = document.createElement("strong");
    name.textContent = `${program.executableName} · ${program.pidCount} 个进程`;
    const detail = document.createElement("span");
    detail.textContent = program.executablePath ?? "路径不可读取，仅可按进程名匹配";
    option.append(name, detail);
    option.addEventListener("click", () => selectProgram(program));
    fragment.append(option);
  }
  runningProgramList.replaceChildren(fragment);
}

async function chooseRunningProgram(): Promise<void> {
  // 这里只显示一次即时快照，TaskPet 不保存未绑定程序的历史。
  try {
    runningProgramPicker.classList.remove("hidden");
    runningProgramList.replaceChildren(emptyState("正在读取", "只读取当前快照，不保存无关进程。"));
    renderRunningPrograms(unwrap(await processApi.listRunning()));
  } catch (error) {
    runningProgramPicker.classList.add("hidden");
    setStatus(error instanceof Error ? error.message : "无法读取当前程序");
  }
}

async function chooseExecutable(): Promise<void> {
  try {
    const program = unwrap(await processApi.pickExecutable());
    if (program) selectProgram(program);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "无法选择 exe 文件");
  }
}

function openTaskDialog(item?: TaskListItem): void {
  if (taskDialog.open) taskDialog.close();
  taskForm.reset();
  setStatus();
  runningProgramPicker.classList.add("hidden");
  const isEdit = Boolean(item);
  dialogTitle.textContent = isEdit ? "编辑任务" : "添加任务";
  editingTaskId.value = item?.task.id ?? "";
  taskTitle.value = item?.task.title ?? "";
  taskDescription.value = item?.task.description ?? "";
  taskType.value = item?.task.taskType ?? "daily";
  taskType.disabled = isEdit;
  taskTypeHint.classList.toggle("hidden", !isEdit);
  completionMode.value = item?.task.completionMode === "manual" ? "manual" : "duration";
  targetMinutes.value = item?.task.targetDurationSec
    ? String(Math.max(1, Math.ceil(item.task.targetDurationSec / 60)))
    : "25";
  archiveTaskButton.classList.toggle("hidden", !isEdit);

  const rule = item ? rulesByTask.get(item.task.id)?.[0] : undefined;
  selectedProgram = rule?.executableName
    ? {
      executableName: rule.executableName,
      executablePath: rule.executablePath,
      pidCount: 0
    }
    : null;
  processMatchMode.value = rule?.matchMode ?? "exact_path";
  syncDurationField();
  syncProgramBinding();
  taskDialog.showModal();
  requestAnimationFrame(() => taskTitle.focus());
}

function closeTaskDialog(): void {
  runningProgramPicker.classList.add("hidden");
  if (taskDialog.open) taskDialog.close();
}

async function saveProgramBinding(taskId: string): Promise<void> {
  const previousRule = rulesByTask.get(taskId)?.[0];
  if (!selectedProgram) {
    if (previousRule) unwrap(await processApi.removeRules(taskId));
    return;
  }
  unwrap(await processApi.setRule({
    taskId,
    matchMode: processMatchMode.value === "process_name" ? "process_name" : "exact_path",
    executableName: selectedProgram.executableName,
    executablePath: selectedProgram.executablePath
  }));
}

async function saveTask(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  const mode: "manual" | "duration" = completionMode.value === "manual"
    ? "manual"
    : "duration";
  const minutes = mode === "duration" ? Number(targetMinutes.value) : 0;
  if (mode === "duration" && (!Number.isInteger(minutes) || minutes <= 0)) {
    setStatus("目标分钟数必须是大于 0 的整数");
    return;
  }

  const payload = {
    title: taskTitle.value,
    description: taskDescription.value.trim() || null,
    completionMode: mode,
    targetDurationSec: minutes * 60
  };

  try {
    setStatus();
    let taskId = editingTaskId.value;
    if (taskId) {
      unwrap(await taskApi.update(taskId, payload));
    } else {
      const task = unwrap(await taskApi.create({
        ...payload,
        taskType: taskType.value === "one_time" ? "one_time" : "daily"
      }));
      taskId = task.id;
    }
    // Task 先保存成功，再为得到的 taskId 更新程序规则。
    await saveProgramBinding(taskId);
    closeTaskDialog();
    await refreshToday();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "无法保存任务");
  }
}

async function archiveEditingTask(): Promise<void> {
  const id = editingTaskId.value;
  const item = todayItems.get(id);
  if (!id || !item) return;
  if (!window.confirm(`归档“${item.task.title}”？历史完成记录会继续保留。`)) return;

  try {
    unwrap(await taskApi.archive(id));
    closeTaskDialog();
    await refreshToday();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "无法归档任务");
  }
}

async function switchView(view: PanelView): Promise<void> {
  currentView = view;
  pageTitle.textContent = view === "today"
    ? "今日任务"
    : view === "history" ? "完成历史" : "设置";
  todayView.classList.toggle("hidden", view !== "today");
  historyView.classList.toggle("hidden", view !== "history");
  settingsView.classList.toggle("hidden", view !== "settings");
  addTaskButton.classList.toggle("hidden", view !== "today");
  for (const tab of document.querySelectorAll<HTMLButtonElement>(".tab")) {
    const active = tab.dataset.view === view;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  }

  try {
    if (view === "today") await refreshToday();
    else if (view === "history") await refreshHistory();
    else await refreshSettings();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "无法读取页面");
  }
}

async function handlePanelCommand(command: PanelCommand): Promise<void> {
  if (command === "open-settings") {
    await switchView("settings");
    return;
  }
  await switchView("today");
  openTaskDialog();
}

// ---------- 用户事件、Main 推送订阅与初始化 ----------

addTaskButton.addEventListener("click", () => openTaskDialog());
completionMode.addEventListener("change", syncDurationField);
taskForm.addEventListener("submit", (event) => void saveTask(event));
elementById<HTMLButtonElement>("cancelTaskButton").addEventListener("click", closeTaskDialog);
elementById<HTMLButtonElement>("dismissTaskButton").addEventListener("click", closeTaskDialog);
archiveTaskButton.addEventListener("click", () => void archiveEditingTask());
chooseRunningButton.addEventListener("click", () => void chooseRunningProgram());
chooseExeButton.addEventListener("click", () => void chooseExecutable());
clearProgramButton.addEventListener("click", () => {
  selectedProgram = null;
  syncProgramBinding();
});
elementById<HTMLButtonElement>("closeRunningPickerButton").addEventListener("click", () => {
  runningProgramPicker.classList.add("hidden");
});
autoStartToggle.addEventListener("change", () => {
  void updateSetting({ autoStart: autoStartToggle.checked });
});
alwaysOnTopToggle.addEventListener("change", () => {
  void updateSetting({ alwaysOnTop: alwaysOnTopToggle.checked });
});
petSelect.addEventListener("change", () => {
  if (petSelect.value) void updateSetting({ activePetKey: petSelect.value });
});
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-pet-size]")) {
  button.addEventListener("click", () => {
    const size = button.dataset.petSize;
    if (size === "large" || size === "normal" || size === "small") {
      void updateSetting({ petSize: size });
    }
  });
}
elementById<HTMLButtonElement>("openDataDirectoryButton").addEventListener("click", () => {
  void openDataDirectory();
});
elementById<HTMLButtonElement>("exportBackupButton").addEventListener("click", () => {
  void exportBackup();
});
elementById<HTMLButtonElement>("openGitHubButton").addEventListener("click", () => {
  void settingsApi.openGitHub().then(unwrap).catch((error: unknown) => {
    setStatus(error instanceof Error ? error.message : "无法打开 GitHub");
  });
});
elementById<HTMLButtonElement>("openLicensesButton").addEventListener("click", () => {
  void settingsApi.openLicenses().then(unwrap).catch((error: unknown) => {
    setStatus(error instanceof Error ? error.message : "无法打开第三方许可证");
  });
});
for (const tab of document.querySelectorAll<HTMLButtonElement>(".tab")) {
  tab.addEventListener("click", () => {
    const view = tab.dataset.view;
    void switchView(view === "history" || view === "settings" ? view : "today");
  });
}

const unsubscribeStored = taskApi.onChanged(() => {
  const refresh = currentView === "today"
    ? refreshToday()
    : currentView === "history" ? refreshHistory() : Promise.resolve();
  void refresh.catch((error: unknown) => {
    setStatus(error instanceof Error ? error.message : "无法刷新任务");
  });
});

const unsubscribeRuntime = runtimeApi.onChanged((snapshots) => {
  // 每秒只重绘当前列表，不重新请求任务和绑定规则。
  runtimeByOccurrence = new Map(
    snapshots.map((snapshot) => [snapshot.occurrenceId, snapshot])
  );
  if (currentView === "today") renderToday([...todayItems.values()]);
});

const unsubscribeSettings = settingsApi.onChanged((snapshot) => {
  if (currentView === "settings") renderSettings(snapshot);
  else currentSettings = snapshot;
});

const unsubscribeCommands = uiApi.onCommand((command) => {
  void handlePanelCommand(command).catch((error: unknown) => {
    setStatus(error instanceof Error ? error.message : "无法执行面板操作");
  });
});

window.addEventListener("beforeunload", () => {
  unsubscribeStored();
  unsubscribeRuntime();
  unsubscribeSettings();
  unsubscribeCommands();
});

void refreshToday().then(() => {
  taskApi.rendererReady(true);
}).catch((error: unknown) => {
  setStatus(error instanceof Error ? error.message : "任务面板初始化失败");
  taskApi.rendererReady(false);
});
