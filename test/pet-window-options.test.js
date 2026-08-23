const test = require("node:test");
const assert = require("node:assert/strict");
const {
  MAX_ZOOM,
  MIN_ZOOM,
  clampZoom,
  createPetWindowOptions
} = require("../src/pet-window-options");

test("pet window keeps the required transparent shell flags", () => {
  const options = createPetWindowOptions({
    preloadPath: "C:\\TaskPet\\preload.js",
    icon: { placeholder: true },
    savedBounds: { x: 123.6, y: 456.4 },
    zoom: 1.25
  });

  assert.equal(options.title, "TaskPet");
  assert.equal(options.frame, false);
  assert.equal(options.transparent, true);
  assert.equal(options.alwaysOnTop, true);
  assert.equal(options.skipTaskbar, true);
  assert.equal(options.resizable, false);
  assert.equal(options.movable, true);
  assert.equal(options.x, 124);
  assert.equal(options.y, 456);
  assert.equal(options.webPreferences.contextIsolation, true);
  assert.equal(options.webPreferences.nodeIntegration, false);
  assert.equal(options.webPreferences.preload, "C:\\TaskPet\\preload.js");
});

test("pet window zoom and default coordinates are bounded", () => {
  const minimum = createPetWindowOptions({ preloadPath: "preload.js", zoom: -10 });
  const maximum = createPetWindowOptions({ preloadPath: "preload.js", zoom: 99 });
  const fallback = createPetWindowOptions({
    preloadPath: "preload.js",
    savedBounds: { x: Infinity, y: "not-a-number" },
    zoom: "not-a-number"
  });

  assert.equal(clampZoom(-10), MIN_ZOOM);
  assert.equal(clampZoom(99), MAX_ZOOM);
  assert.ok(minimum.width < maximum.width);
  assert.equal(fallback.x, 40);
  assert.equal(fallback.y, 220);
  assert.throws(() => createPetWindowOptions(), /preloadPath is required/);
});

test("pet window returns an unreachable saved position to the primary display", () => {
  const options = createPetWindowOptions({
    preloadPath: "preload.js",
    savedBounds: { x: 1424, y: -1132 },
    workAreas: [
      { x: 0, y: 0, width: 1920, height: 1040 },
      { x: -1280, y: 0, width: 1280, height: 1024 }
    ]
  });

  assert.equal(options.x, 1656);
  assert.equal(options.y, 730);
});

test("pet window keeps reachable positions on secondary displays", () => {
  const workAreas = [
    { x: 0, y: 0, width: 1920, height: 1040 },
    { x: -1280, y: 0, width: 1280, height: 1024 }
  ];
  const secondary = createPetWindowOptions({
    preloadPath: "preload.js",
    savedBounds: { x: -1200, y: 100 },
    workAreas
  });
  const partiallyVisible = createPetWindowOptions({
    preloadPath: "preload.js",
    savedBounds: { x: 1850, y: 100 },
    workAreas
  });

  assert.equal(secondary.x, -1200);
  assert.equal(secondary.y, 100);
  assert.equal(partiallyVisible.x, 1850);
  assert.equal(partiallyVisible.y, 100);
});
