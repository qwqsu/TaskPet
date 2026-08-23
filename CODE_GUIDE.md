# TaskPet 代码学习指南

这份文档是源码注释的总入口。建议先阅读这里，再按照“推荐阅读顺序”进入具体文件。

## 1. 整体数据流

```text
任务面板 Renderer
    ↓ window.taskPet（preload 暴露的白名单 API）
IPC Handler（校验发送窗口 + Zod 校验输入）
    ↓
TaskService / ProcessRuleService
    ↓
Repository
    ↓
SQLite
```

程序运行联动的数据流：

```text
WindowsProcessProvider 获取当前进程快照
    ↓
ProcessMonitor 只匹配用户绑定的程序
    ↓
RuntimeTracker 创建/累计/结束 ProcessSession
    ↓
TaskEventBus
    ├─→ PetStateMachine → 桌宠 working / done / idle
    └─→ TaskSystem → 刷新任务面板运行时间
```

## 2. Electron 三层安全边界

- Main Process：可以访问 SQLite、文件系统、系统进程和 Electron 窗口 API。
- Preload：只把固定的方法通过 `contextBridge` 暴露给页面。
- Renderer：只处理界面，不能直接访问 Node.js、SQLite 或系统进程。

桌宠和任务面板均保持：

```text
contextIsolation = true
nodeIntegration = false
```

任务面板额外启用了 `sandbox = true`。新增系统能力时，应继续沿用：

```text
Renderer → Preload → IPC → Main Process
```

## 3. 目录与职责

### 应用外壳

- `src/main.js`：Electron 入口，创建桌宠、托盘、TaskSystem，并注册桌宠 IPC。
- `src/pet-window-options.js`：透明窗口尺寸、安全选项和多屏位置恢复。
- `src/pet-window-drag.js`：根据系统鼠标坐标计算拖拽后的固定窗口边界。
- `src/pet-library.js`：发现内置和 Codex-compatible 宠物包。
- `src/pet-state.js`：保存最终发送给桌宠 Renderer 的状态。

### 任务数据

- `src/main/db/migrations/`：数据库版本和表结构。
- `src/main/db/task-repository.ts`：Task / TaskOccurrence 的 SQL。
- `src/main/services/task-service.ts`：创建、编辑、归档、每日实例、完成和历史规则。
- `src/shared/task-schemas.ts`：IPC 输入的 Zod 校验。
- `src/shared/task-types.ts`：任务领域类型。

### 程序监控与计时

- `src/main/process/windows-process-provider.ts`：使用 Win32 API 读取当前进程。
- `src/main/process/process-matcher.ts`：`exact_path` / `process_name` 匹配。
- `src/main/process/process-monitor.ts`：低频扫描、启动识别和退出防抖。
- `src/main/runtime/runtime-tracker.ts`：内存计时、Session、checkpoint、崩溃恢复和跨午夜。
- `src/main/runtime/pet-state-machine.ts`：把任务事件转换为桌宠状态和显示文字。
- `src/main/task-system.ts`：把任务、监控、计时、IPC、面板和桌宠串起来。

### 界面

- `src/renderer/renderer.js`：桌宠 sprite 动画、拖拽、缩放和状态显示。
- `src/renderer/styles.css`：桌宠、任务文字和计时文字的位置与外观。
- `src/renderer/panel/panel.ts`：今日任务、历史、编辑窗口和程序选择。
- `src/renderer/panel/panel.css`：任务面板样式。

## 4. Task 与 TaskOccurrence

`Task` 是长期规则，例如“每天写代码 40 分钟”。

`TaskOccurrence` 是某一天或某次的实际实例，例如“2026-08-24 写代码，累计 40 分钟，已完成”。

每日任务使用 lazy materialization：打开应用或读取今日任务时，如果当天实例不存在才创建。一次性任务只创建一个长期实例。

## 5. 三种不同频率

以下三个频率不能合并：

- 进程扫描：默认 2.5 秒，判断绑定程序是否存在。
- UI tick：默认 1 秒，只更新内存快照和界面计时。
- SQLite checkpoint：默认 30 秒，保存崩溃恢复点。

因此“界面每秒变化”不等于“每秒扫描进程或写数据库”。

## 6. duration 任务的核心状态

```text
程序出现：pending → active，创建 ProcessSession
程序持续：按 wall-clock 累计，不按 PID 数量叠加
程序消失：冻结计时，等待 3~5 秒防抖
确认退出：Session 结束，active → pending，累计值保留
再次出现：从 accumulatedSec 继续累计
达到目标：只完成一次，结束 Session，并停止继续累计
```

每日任务跨本地午夜时，旧 occurrence 和 Session 在午夜结束，新一天创建新的 occurrence 和 Session。

## 7. 常见修改入口

| 想修改的内容 | 文件或常量 |
| --- | --- |
| 桌宠任务文字/计时字号 | `src/renderer/styles.css` 的 `.pet-status-message` / `.pet-status-detail` |
| 桌宠、文字纵向位置 | `src/renderer/renderer.js` 的 `--pet-top` / `--status-top` |
| 桌宠窗口基础大小 | `src/pet-window-options.js` 的 `BASE_WINDOW_WIDTH/HEIGHT` |
| 宠物动画行和帧间隔 | `src/pet-state.js` 的 `PET_STATE_DEFINITIONS` |
| 多任务文字轮播间隔 | `PetStateMachineOptions.taskRotationMs`，默认 3000ms |
| 完成动画显示时间 | `PetStateMachineOptions.doneDurationMs`，默认 2500ms |
| 进程扫描间隔 | `ProcessMonitorOptions.scanIntervalMs`，默认 2500ms |
| 程序退出防抖 | `ProcessMonitorOptions.exitDebounceMs`，默认 4000ms |
| UI 计时刷新 | `RuntimeTrackerOptions.uiTickMs`，默认 1000ms |
| SQLite checkpoint | `RuntimeTrackerOptions.checkpointMs`，默认 30000ms |
| 任务标题和输入限制 | `src/shared/task-schemas.ts` |
| 今日任务卡片 | `src/renderer/panel/panel.ts` 的 `renderToday` |
| 面板颜色和尺寸 | `src/renderer/panel/panel.css` |
| 新数据库字段 | 新增 migration，不要直接修改用户已经执行过的 migration |

## 8. 推荐阅读顺序

1. `src/shared/task-types.ts`
2. `src/shared/task-schemas.ts`
3. `src/main/services/task-service.ts`
4. `src/main/process/process-monitor.ts`
5. `src/main/runtime/runtime-tracker.ts`
6. `src/main/runtime/pet-state-machine.ts`
7. `src/main/task-system.ts`
8. `src/main.js`
9. 两个 Renderer

## 9. 本地验证命令

```bash
npm test
npm run compile
npm run smoke
npm run dev
npm run dev:bounds
npm run build:unpack
```

`dev:bounds` 会显示红色窗口范围、绿色宠物区域和蓝色图片帧，适合调整桌宠位置与大小。

