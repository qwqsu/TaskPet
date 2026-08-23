# TaskPet

TaskPet is a local-first desktop task assistant that uses a small animated pet as its persistent entry point.

This branch implements the Windows process-monitoring and duration-runtime stages on top of the P1 task system. It still excludes foreground-window tracking, general process history, reminders, Agent hooks, a local HTTP API, and automatic updates.

## Current capabilities

- Transparent, frameless Electron pet window
- Always on top and hidden from the regular taskbar
- Pointer dragging with persisted position
- Resize handle with persisted zoom
- System tray controls for show/hide, pet selection, pet reload, and quit
- Bundled and `~/.codex/pets` Codex-compatible spritesheets
- Six TaskPet states: `idle`, `working`, `done`, `attention`, `drag-left`, and `drag-right`
- Isolated renderer with `contextIsolation: true` and `nodeIntegration: false`
- Open the Today panel by clicking the pet or using the tray
- Create, edit, and archive `daily` and `one_time` tasks
- Lazy daily occurrences and one permanent occurrence per one-time task
- Manual complete/reopen and a simple 30-day history
- Main-process SQLite migrations, TaskService, and Zod-validated IPC
- Bind a task by exact Windows exe path or process name
- Choose from a one-time snapshot of running programs or a Windows `.exe` file picker
- Low-frequency native process scans with multi-PID wall-clock deduplication and exit debounce
- Persistent process sessions, 30-second checkpoints, crash recovery, and local-midnight daily splitting
- Duration completion with in-memory one-second UI updates and `working` / `done` pet feedback

## Development

```bash
npm install
npm test
npm run smoke
npm run build:unpack
```

The smoke command initializes the pet renderer, task-panel renderer, and SQLite without showing a window, then exits automatically.

## Pet packages

TaskPet discovers bundled pets and compatible packages under:

```text
~/.codex/pets/<pet-id>/
├── pet.json
└── spritesheet.webp
```

Minimal manifest:

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

TaskPet uses rows 0, 1, 2, 3, 4, and 7 for its six states. Missing frame metadata defaults to the Codex-compatible 192×208, 8×9 layout.

## Architecture

```text
Electron main
├── pet window, tray, pet library, and PetStateController
├── SQLite migrations / task, process-rule, and session repositories
├── TaskService + Zod IPC
├── WindowsProcessProvider → ProcessMatcher → ProcessMonitor
├── RuntimeTracker → TaskEventBus → PetStateMachine
└── isolated preloads
    ├── pet preload → spritesheet renderer
    └── panel preload → Today / History renderer
```

System capabilities stay in the main process. Separate preloads expose fixed, validated APIs; neither renderer can access the filesystem, child processes, native process APIs, or SQLite. Full process snapshots remain in memory and are discarded after matching. Task rules and matching sessions are stored under Electron's `userData/taskpet.sqlite3`.

## Origin and assets

TaskPet's P0 shell was derived from [yangbuyiya/desktop-pet](https://github.com/yangbuyiya/desktop-pet) under the MIT license. The inherited bundled pet art and placeholder application icon must be reviewed separately before a public TaskPet release; code licensing does not automatically grant redistribution rights for every artwork.
