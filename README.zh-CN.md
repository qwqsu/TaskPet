# TaskPet

TaskPet 是一个本地优先的桌面任务助手，以常驻桌宠作为低打扰交互入口。

当前分支已在 P1 任务系统上实现 Windows 程序监控与 duration 运行时阶段。仍不包含前台窗口计时、完整进程历史、提醒、Agent Hook、本地 HTTP API 或自动更新。

## 当前能力

- Electron 透明、无边框桌宠窗口
- 始终置顶，并跳过普通任务栏
- 鼠标拖拽与窗口位置保存
- 拖动缩放手柄与缩放比例保存
- tray 显示/隐藏、宠物切换、重新加载与退出
- 内置宠物和 `~/.codex/pets` 下的 Codex-compatible spritesheet
- 六个状态：`idle`、`working`、`done`、`attention`、`drag-left`、`drag-right`
- `contextIsolation: true`、`nodeIntegration: false`
- 单击桌宠或使用 tray 打开今日任务面板
- `daily` / `one_time` 任务的创建、编辑和归档
- 每日 occurrence 惰性生成，一次性任务使用永久 occurrence
- 手动完成、取消完成，以及最近 30 天的简单历史
- Main Process 中的 SQLite migration、TaskService 和 Zod IPC 校验
- 按 Windows exe 精确路径或进程名绑定任务
- 从一次性“正在运行的程序”快照或 Windows `.exe` 文件选择器绑定
- 原生低频进程扫描、多 PID wall-clock 去重和退出防抖
- 持久化 Process Session、30 秒 checkpoint、崩溃恢复和 daily 本地午夜切分
- duration 自动完成、内存每秒 UI 计时，以及桌宠 `working` / `done` 联动

## 本地开发

```bash
npm install
npm test
npm run smoke
npm run build:unpack
```

`npm run smoke` 会实际初始化桌宠 Renderer、任务面板 Renderer 和 SQLite，但不显示窗口；三者加载成功后自动退出。

## 宠物包格式

TaskPet 会发现内置宠物，以及以下标准目录中的兼容宠物：

```text
~/.codex/pets/<pet-id>/
├── pet.json
└── spritesheet.webp
```

最小 manifest：

```json
{
  "id": "example",
  "displayName": "Example Pet",
  "spritesheetPath": "spritesheet.webp",
  "frame": {
    "width": 192,
    "height": 208,
    "columns": 8,
    "rows": 9
  }
}
```

TaskPet 使用图集第 0、1、2、3、4、7 行分别承载六个状态。未声明 `frame` 时默认采用 Codex-compatible 的 192×208 单帧、8×9 图集。

## 当前架构

```text
Electron Main
├── 桌宠窗口、tray、宠物资源与 PetStateController
├── SQLite migration / Task、ProcessRule、ProcessSession Repository
├── TaskService + Zod IPC
├── WindowsProcessProvider → ProcessMatcher → ProcessMonitor
├── RuntimeTracker → TaskEventBus → PetStateMachine
└── 隔离 Preload
    ├── 桌宠 Preload → spritesheet Renderer
    └── 面板 Preload → 今日任务 / 历史 Renderer
```

系统能力只存在于 Main Process。两个 Preload 只暴露固定且经过校验的 API，Renderer 不直接访问文件系统、子进程、原生进程 API 或 SQLite。完整进程快照仅在内存中完成匹配后丢弃；任务规则与匹配任务的 Session 保存在 Electron `userData/taskpet.sqlite3`。

## 来源与资源说明

TaskPet P0 Shell 基于 MIT 许可的 [yangbuyiya/desktop-pet](https://github.com/yangbuyiya/desktop-pet) 精简。继承的内置宠物美术和临时应用图标在公开发布前仍需分别确认再分发权；代码许可证不自动代表所有美术资源都可重新分发。
