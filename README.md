# TaskPet

TaskPet is a local-first desktop task assistant that uses a small animated pet as its persistent entry point.

This branch implements P1: a local SQLite task system and task panel on top of the P0 pet shell. It still excludes process monitoring, automatic runtime tracking, reminders, Agent hooks, a local HTTP API, and automatic updates.

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
├── SQLite migrations / TaskRepository
└── TaskService + Zod IPC
       ├── pet preload → spritesheet renderer
       └── panel preload → Today / History renderer
```

System capabilities stay in the main process. Separate preloads expose the minimum API needed by each renderer; neither renderer can access the filesystem, child processes, or SQLite. Task data is stored under Electron's `userData/taskpet.sqlite3`.

P2 can add an independent main-process `ProcessMonitor` and pass its events to the existing `TaskService`; renderers, SQLite, and the pet state machine do not need direct process-list access.

## Origin and assets

TaskPet's P0 shell was derived from [yangbuyiya/desktop-pet](https://github.com/yangbuyiya/desktop-pet) under the MIT license. The inherited bundled pet art and placeholder application icon must be reviewed separately before a public TaskPet release; code licensing does not automatically grant redistribution rights for every artwork.
