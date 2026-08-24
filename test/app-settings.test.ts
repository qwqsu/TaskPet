import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PET_MOUSE_BINDINGS,
  PET_VISUAL_SIZES,
  PET_SIZE_ZOOMS,
  UpdateAppSettingsInputSchema,
  normalizePetMouseBindings,
  normalizePetSize,
  petMouseActionForGesture,
  petSizeFromZoom
} from "../src/shared/app-settings";

test("pet size exposes three exact visual presets and compact window scales", () => {
  assert.deepEqual(PET_VISUAL_SIZES, {
    large: { width: 105, height: 114 },
    normal: { width: 96, height: 104 },
    small: { width: 43, height: 52 }
  });
  assert.deepEqual(PET_SIZE_ZOOMS, {
    large: 0.55,
    normal: 0.5,
    small: 0.25
  });
  assert.equal(normalizePetSize("large"), "large");
  assert.equal(normalizePetSize("unknown", 1.24), "large");
  assert.equal(normalizePetSize("unknown", 1), "normal");
  assert.equal(normalizePetSize("unknown", 0.66), "small");
  assert.equal(petSizeFromZoom(0.55), "large");
  assert.equal(petSizeFromZoom(0.5), "normal");
  assert.equal(petSizeFromZoom(0.25), "small");
});

test("settings schema rejects internal monitor parameters and unknown controls", () => {
  assert.equal(UpdateAppSettingsInputSchema.safeParse({ petSize: "small" }).success, true);
  assert.equal(UpdateAppSettingsInputSchema.safeParse({ alwaysOnTop: false }).success, true);
  assert.equal(UpdateAppSettingsInputSchema.safeParse({}).success, false);
  assert.equal(UpdateAppSettingsInputSchema.safeParse({ petSize: "medium" }).success, false);
  assert.equal(UpdateAppSettingsInputSchema.safeParse({
    processScanIntervalMs: 1_000
  }).success, false);
  assert.equal(UpdateAppSettingsInputSchema.safeParse({
    showStatusBubble: false
  }).success, false);
});

test("pet mouse bindings use fixed actions and safe defaults", () => {
  assert.deepEqual(normalizePetMouseBindings(null), DEFAULT_PET_MOUSE_BINDINGS);
  const bindings = normalizePetMouseBindings({
    leftClick: "quick-add",
    doubleClick: "toggle-monitoring",
    rightClick: "quit"
  });
  assert.equal(petMouseActionForGesture(bindings, "left"), "quick-add");
  assert.equal(petMouseActionForGesture(bindings, "double"), "toggle-monitoring");
  assert.equal(petMouseActionForGesture(bindings, "right"), "quit");
  assert.equal(petMouseActionForGesture(bindings, "middle"), null);
  assert.equal(UpdateAppSettingsInputSchema.safeParse({ mouseBindings: bindings }).success, true);
  assert.equal(UpdateAppSettingsInputSchema.safeParse({
    mouseBindings: { ...bindings, rightClick: "run-shell" }
  }).success, false);
});
