# TaskPet 代码学习指南

这份文档是源码注释的总入口，面向希望继续维护 TaskPet、但还不熟悉 Electron 和 TypeScript 分层的读者。源码中的注释主要说明“为什么这样组织”，这里负责把各个文件串成一张完整地图。

## 1. 先认识三个进程边界

TaskPet 的页面不能直接读取数据库或调用 Windows API：

```text
Renderer（界面）
    ↓ window.taskPet / window.taskPetSettings
Preload（只暴露固定白名单）
    ↓ IPC
Main Process（系统能力与业务服务）
    ↓
SQLite / 文件系统 / Win32 API / Electron BrowserWindow
```

- Main Process：创建窗口和 Tray，访问 SQLite、文件、系统进程与登录启动设置。
- Preload：使用 `contextBridge` 暴露固定方法，不向页面开放 Node.js。
- Renderer：只负责 DOM、动画和表单。

桌宠、任务面板和设置窗口都保持 `contextIsolation = true`、`nodeIntegration = false`；面板和设置还启用了 `sandbox = true`。

## 2. 应用启动时发生什么

入口是 `src/main.js`：

1. Electron 读取应用名、运行参数和本地设置。
2. 从内置目录与用户桌宠目录发现宠物。
3. 创建透明桌宠窗口并注册桌宠 IPC。
4. 创建 `TaskSystem`，打开 SQLite 并组装任务、监控和计时服务。
5. 创建 Tray。
6. 任务面板与设置窗口保持懒创建，只有打开时才产生各自的 Renderer。

退出时顺序相反：先停止 timer、监控和运行会话，再解除 IPC、销毁窗口并关闭数据库。

## 3. 主要目录与文件职责

### Electron 外壳

- `src/main.js`：应用总入口；负责桌宠窗口、Tray、设置快照、宠物导入入口和生命周期。
- `src/pet-window-options.js`：透明桌宠窗口的尺寸、安全选项和多屏防丢失。
- `src/pet-window-drag.js`：使用主进程中的系统鼠标坐标计算窗口拖拽。
- `src/pet-library.js`：读取内置与用户目录中的 `pet.json`，生成安全图集 URL。
- `src/pet-state.js`：管理最终桌宠状态；拖拽结束后恢复业务状态。
- `src/app-logger.js`：低频本地日志与简单轮换，不记录完整进程快照。

### 任务数据

- `src/main/db/migrations/`：SQLite schema 版本。已有 migration 不应回写修改，新字段要新增 migration。
- `src/main/db/task-repository.ts`：`Task` / `TaskOccurrence` 的 SQL 与查询。
- `src/main/db/process-rule-repository.ts`：任务与 exe 绑定规则。
- `src/main/db/process-session-repository.ts`：实际运行会话和统计区间。
- `src/main/services/task-service.ts`：创建、编辑、归档、每日实例、完成、重开和历史规则。
- `src/shared/task-types.ts`：任务领域类型。
- `src/shared/task-schemas.ts`：进入 Main Process 前的 Zod 输入校验。

### 程序监控与计时

- `src/main/process/windows-process-provider.ts`：通过原生 Windows API 获取当前进程快照。
- `src/main/process/process-provider.ts`：按平台懒加载 provider；没有监控需求时不提前加载原生模块。
- `src/main/process/process-matcher.ts`：`exact_path` / `process_name` 匹配。
- `src/main/process/process-monitor.ts`：低频扫描、多 PID 合并和退出防抖。
- `src/main/runtime/runtime-tracker.ts`：内存计时、ProcessSession、checkpoint、恢复与跨午夜切分。
- `src/main/runtime/monitor-control.ts`：暂停时结束活动会话并清空目标，恢复时重新应用目标。
- `src/main/runtime/task-event-bus.ts`：解耦计时事件的发布和订阅。
- `src/main/runtime/pet-state-machine.ts`：把任务运行事件转换成桌宠 `working` / `done` / `idle`。
- `src/main/services/time-stats-service.ts`：把已结束会话和当前活动区间裁剪到今天或本周。

### 总协调器与 IPC

- `src/main/task-system.ts`：把数据库、Service、Monitor、Runtime、IPC 和两个普通窗口组装起来。
- `src/main/ipc/register-task-ipc.ts`：任务 CRUD、历史和统计频道。
- `src/main/ipc/register-process-ipc.ts`：绑定程序、读取当前程序和启动已绑定 exe。
- `src/main/ipc/register-settings-ipc.ts`：设置、数据、关于和桌宠导入动作。
- `src/preload.js`：桌宠窗口安全桥。
- `src/preload/panel-preload.ts`：任务面板安全桥。
- `src/preload/settings-preload.ts`：设置窗口安全桥。

### Renderer

- `src/renderer/renderer.js`：桌宠图集动画、颜文字、状态文字、点击和拖拽事件。
- `src/renderer/styles.css`：透明桌宠窗口样式。
- `src/renderer/panel/panel.ts`：今日任务、历史、总计时、表单和程序选择。
- `src/renderer/panel/panel.css`：任务面板样式。
- `src/renderer/settings/settings.ts`：独立设置页的数据读取、保存、提示与宠物导入。
- `src/renderer/settings/settings.css`：设置页现有布局与视觉样式。

### 设置、数据与发布

- `src/shared/app-settings.ts`：三档桌宠尺寸、鼠标动作与设置 IPC 契约的唯一来源。
- `src/main/services/login-item-service.ts`：Electron 官方登录启动 API 的查询、写入和复核。
- `src/main/services/data-service.ts`：打开数据目录和 SQLite Online Backup 导出。
- `src/main/services/custom-pet-service.ts`：安全解析/校验 ZIP 或文件夹并原子安装宠物。
- `electron-builder.yml`：asar、原生模块、Windows NSIS 和发布文件范围。
- `scripts/`：测试启动、性能 smoke 与用户宠物包 smoke。

## 4. Task 与 TaskOccurrence

`Task` 是长期规则，例如“每天写代码 40 分钟”。

`TaskOccurrence` 是某一天或某一次的实例，例如“2026-08-25 写代码，累计 40 分钟，已完成”。

每日任务使用惰性生成：读取今天的任务时，如果当天实例不存在才创建。一次性任务保留同一个实例。因此不要通过把旧 occurrence 的 `completed` 改回 false 来实现新的一天。

## 5. duration 的计时闭环

```text
绑定程序出现
→ pending 变为 active
→ 创建或续接 ProcessSession
→ UI 每秒从内存快照更新

绑定程序第一次消失
→ 冻结当前累计点
→ 等待退出防抖

确认全部匹配进程退出
→ 结束 Session
→ active 变回 pending
→ accumulatedSec 保留

累计达到目标
→ completed（只发生一次）
→ 停止继续累计
```

同一程序的多个 PID 只代表“程序仍存在”，不能把时间乘以 PID 数量。

## 6. 三种不同频率

- Process scan：默认约 2500 ms，只判断绑定程序是否存在。
- Runtime UI tick：默认约 1000 ms，只更新内存快照和界面。
- SQLite checkpoint：默认约 30000 ms，保存崩溃恢复点。
- Exit debounce：默认约 4000 ms，确认进程是否真的退出。

它们是不同职责。界面每秒变化不代表每秒扫描系统进程或写 SQLite。没有待监控任务或监控暂停时，`ProcessMonitor` 会移除扫描 timer。

## 7. 用户数据和桌宠分别在哪里

### 任务数据

`src/main.js` 的 `getDataPaths()` 以 `app.getPath("userData")` 为根目录。Windows 默认是：

```text
C:\Users\<用户名>\AppData\Roaming\TaskPet\
├── taskpet.sqlite3
├── settings.json
├── logs\
└── backups\
```

设置页显示的“数据目录”就是主进程快照中的这个路径。

### 用户导入的桌宠

`src/main.js` 中 `CODEX_HOME` 默认是 `path.join(os.homedir(), ".codex")`，`getPetStorageInfo()` 再交给 `src/pet-library.js` 拼出 `pets`：

```text
C:\Users\<用户名>\.codex\pets\<pet-id>\
```

如设置环境变量 `CODEX_HOME`，根目录会随之改变。导入服务先写 `.taskpet-import-*` 临时目录，校验成功后再原子重命名为 `<pet-id>`；失败会清理临时目录。

内置桌宠位于 `src/assets/pets/`，打包后在应用资源内，只读且不等同于用户导入目录。

## 8. aboutVersion 为什么会显示版本

完整传递链如下：

```text
package.json
  "version": "1.0.0"
        ↓ Electron 读取应用版本
src/main.js
  appSettingsSnapshot().version = app.getVersion()
        ↓ Settings IPC / settings-preload
src/renderer/settings/settings.ts
  aboutVersion.textContent = `v${snapshot.version}`
        ↓
设置页显示 v1.0.0
```

因此修改设置页显示版本时，不要直接改 HTML 中的 `id="aboutVersion"`。发布新版本只改根目录 `package.json` 的 `version`，并同步 `package-lock.json`；开发态、打包后的 exe 元数据、安装包文件名和关于页就会使用同一个值。

## 9. 自定义桌宠导入为什么不直接解压

`custom-pet-service.ts` 只接受 PetDex 兼容的 `pet.json + PNG/WebP`：

1. 限制 ZIP 大小、条目数和解压后总大小。
2. 拒绝 ZIP64、加密、分卷、符号链接和路径穿越。
3. 校验 `pet.json` 的 id、显示名、图集路径和帧结构。
4. 校验 PNG/WebP 文件头、图集尺寸和透明背景。
5. 只复制清单与图集到临时目录。
6. 全部成功后再改名为正式目录。

这样 Renderer 不需要拿到用户文件路径，失败导入也不会产生可被宠物库误加载的半成品。

## 10. 常见修改入口

| 想修改的内容 | 文件或入口 |
| --- | --- |
| 应用版本 | `package.json` 的 `version`（同步 lockfile） |
| 桌宠三档视觉/窗口尺寸 | `src/shared/app-settings.ts` 的 `PET_SIZE_PRESETS` |
| 设置页展示的尺寸文案 | `src/renderer/settings/index.html` 的三张 size option |
| idle 颜文字和轮换间隔 | `src/renderer/renderer.js` 的 `IDLE_MESSAGES` / `IDLE_MESSAGE_INTERVAL_MS` |
| 桌宠状态框样式 | `src/renderer/styles.css` 的 `.pet-status` |
| 动画行与每帧时长 | `src/pet-state.js` 的 `PET_STATE_DEFINITIONS` |
| 完成动画时长/任务文字轮播 | `PetStateMachineOptions` |
| 进程扫描与退出防抖 | `ProcessMonitorOptions` |
| UI tick 与 SQLite checkpoint | `RuntimeTrackerOptions` |
| 今日任务卡片与启动按钮 | `src/renderer/panel/panel.ts` 的 `renderToday` |
| 今日/周统计边界 | `src/main/services/time-stats-service.ts` |
| 设置页逻辑 | `src/renderer/settings/settings.ts` |
| 设置页现有布局 | `src/renderer/settings/index.html` / `settings.css` |
| 新数据库字段 | 在 `src/main/db/migrations/` 新增 migration |
| Windows 安装包 | `electron-builder.yml` |

`build/` 是 TypeScript 编译产物，`dist/` 是发布产物；不要把它们当作源码修改入口。

## 11. 推荐阅读顺序

1. `src/shared/task-types.ts`
2. `src/shared/task-schemas.ts`
3. `src/main/services/task-service.ts`
4. `src/main/process/process-monitor.ts`
5. `src/main/runtime/runtime-tracker.ts`
6. `src/main/runtime/pet-state-machine.ts`
7. `src/main/task-system.ts`
8. `src/main.js`
9. 三个 Preload
10. 桌宠、面板、设置三个 Renderer

## 12. 验证与发布命令

```bash
npm test                 # TypeScript 测试编译 + 全量测试
npm run compile          # 正式 TypeScript 检查/编译
npm run smoke            # Electron + Renderer + SQLite 启动闭环
npm run perf:smoke       # CPU、内存、进程数和响应性基线
npm run smoke:pet-zip -- <pet.zip>
npm run build:unpack     # 只生成 unpacked 应用
npm run build:win        # 生成 Windows NSIS 安装包
```

发布前还应运行 `dist\win-unpacked\TaskPet.exe --smoke-test`，确认 asar、Preload、SQLite native module、宠物资源和图标在 packaged app 中都能正常加载。
