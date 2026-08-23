# TaskPet

TaskPet 是一个本地优先的桌面任务助手，以常驻桌宠作为低打扰交互入口。

当前分支实现到 P1：在 P0 桌宠 Shell 上加入本地 SQLite 任务系统和任务面板。仍不包含进程监控、运行时自动计时、提醒、Agent Hook、本地 HTTP API 或自动更新。

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
├── SQLite migration / TaskRepository
└── TaskService + Zod IPC
       ├── 桌宠 Preload → spritesheet Renderer
       └── 面板 Preload → 今日任务 / 历史 Renderer
```

系统能力只存在于 Main Process。两个 Preload 分别暴露最小 API，Renderer 不直接访问文件系统、子进程或本地数据库。任务数据库位于 Electron `userData/taskpet.sqlite3`。

P2 可以在 Main Process 新增独立 `ProcessMonitor`，把进程事件交给现有 `TaskService`；Renderer、SQLite 和桌宠状态机都不需要直接访问系统进程列表。

## 来源与资源说明

TaskPet P0 Shell 基于 MIT 许可的 [yangbuyiya/desktop-pet](https://github.com/yangbuyiya/desktop-pet) 精简。继承的内置宠物美术和临时应用图标在公开发布前仍需分别确认再分发权；代码许可证不自动代表所有美术资源都可重新分发。
