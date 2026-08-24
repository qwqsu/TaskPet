const test = require("node:test");
const assert = require("node:assert/strict");
const { PET_SIZE_PRESETS } = require("../.test-build/src/shared/app-settings");
const {
  createPetWindowOptions,
  getCenteredPetBounds,
  getPetWindowSize
} = require("../src/pet-window-options");

test("pet window keeps the required transparent shell flags", () => {
  const options = createPetWindowOptions({
    preloadPath: "C:\\TaskPet\\preload.js",
    icon: { placeholder: true },
    savedBounds: { x: 123.6, y: 456.4 },
    preset: PET_SIZE_PRESETS.large
  });

  assert.equal(options.title, "TaskPet");
  assert.equal(options.frame, false);
  assert.equal(options.thickFrame, false);
  assert.equal(options.transparent, true);
  assert.equal(options.alwaysOnTop, true);
  assert.equal(options.skipTaskbar, true);
  assert.equal(options.resizable, false);
  assert.equal(options.movable, true);
  assert.equal(options.width, 132);
  assert.equal(options.height, 157);
  assert.equal(options.useContentSize, true);
  assert.equal(options.x, 124);
  assert.equal(options.y, 456);
  assert.equal(options.webPreferences.contextIsolation, true);
  assert.equal(options.webPreferences.nodeIntegration, false);
  assert.equal(options.webPreferences.preload, "C:\\TaskPet\\preload.js");

  const notOnTop = createPetWindowOptions({
    preloadPath: "preload.js",
    preset: PET_SIZE_PRESETS.normal,
    alwaysOnTop: false
  });
  assert.equal(notOnTop.alwaysOnTop, false);
});

test("pet window requires a named preset and bounds invalid saved coordinates", () => {
  const fallback = createPetWindowOptions({
    preloadPath: "preload.js",
    preset: PET_SIZE_PRESETS.small,
    savedBounds: { x: Infinity, y: "not-a-number" }
  });

  assert.equal(fallback.x, 40);
  assert.equal(fallback.y, 220);
  assert.throws(() => createPetWindowOptions(), /preloadPath is required/);
  assert.throws(
    () => createPetWindowOptions({ preloadPath: "preload.js" }),
    /preset\.windowWidth must be a positive number/
  );
});

test("pet window size comes directly from the same three presets", () => {
  assert.deepEqual(getPetWindowSize(PET_SIZE_PRESETS.small), {
    width: 60,
    height: 72
  });
  assert.deepEqual(getPetWindowSize(PET_SIZE_PRESETS.normal), {
    width: 120,
    height: 143
  });
  assert.deepEqual(getPetWindowSize(PET_SIZE_PRESETS.large), {
    width: 132,
    height: 157
  });
});

test("recall bounds center the current preset on the primary work area", () => {
  assert.deepEqual(
    getCenteredPetBounds(
      { x: 0, y: 0, width: 1920, height: 1040 },
      PET_SIZE_PRESETS.large
    ),
    { x: 894, y: 442, width: 132, height: 157 }
  );
});

test("pet window returns an unreachable saved position to the primary display", () => {
  const options = createPetWindowOptions({
    preloadPath: "preload.js",
    preset: PET_SIZE_PRESETS.normal,
    savedBounds: { x: 1424, y: -1132 },
    workAreas: [
      { x: 0, y: 0, width: 1920, height: 1040 },
      { x: -1280, y: 0, width: 1280, height: 1024 }
    ]
  });

  assert.equal(options.x, 1776);
  assert.equal(options.y, 873);
});

test("pet window keeps reachable positions on secondary displays", () => {
  const workAreas = [
    { x: 0, y: 0, width: 1920, height: 1040 },
    { x: -1280, y: 0, width: 1280, height: 1024 }
  ];
  const secondary = createPetWindowOptions({
    preloadPath: "preload.js",
    preset: PET_SIZE_PRESETS.small,
    savedBounds: { x: -1200, y: 100 },
    workAreas
  });
  const partiallyVisible = createPetWindowOptions({
    preloadPath: "preload.js",
    preset: PET_SIZE_PRESETS.large,
    savedBounds: { x: 1850, y: 100 },
    workAreas
  });

  assert.equal(secondary.x, -1200);
  assert.equal(secondary.y, 100);
  assert.equal(partiallyVisible.x, 1850);
  assert.equal(partiallyVisible.y, 100);
});
