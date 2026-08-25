import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PET_MOUSE_BINDINGS,
  DroppedPetZipInputSchema,
  PET_SIZE_PRESETS,
  UpdateAppSettingsInputSchema,
  normalizePetMouseBindings,
  normalizePetSize,
  petMouseActionForGesture
} from "../src/shared/app-settings";

test("pet size exposes one complete source of truth for all three presets", () => {
  assert.deepEqual(PET_SIZE_PRESETS, {
    small: {
      scale: 0.25,
      petWidth: 48,
      petHeight: 52,
      windowWidth: 60,
      windowHeight: 72,
      petTop: 0,
      statusGap: 2,
      statusSideMargin: 6,
      statusPaddingX: 2,
      statusPaddingY: 0,
      idleFontSize: 8,
      statusMessageFontSize: 5,
      statusDetailFontSize: 7
    },
    normal: {
      scale: 0.5,
      petWidth: 96,
      petHeight: 104,
      windowWidth: 120,
      windowHeight: 143,
      petTop: 0,
      statusGap: 5,
      statusSideMargin: 12,
      statusPaddingX: 5,
      statusPaddingY: 2,
      idleFontSize: 13,
      statusMessageFontSize: 10,
      statusDetailFontSize: 13
    },
    large: {
      scale: 0.55,
      petWidth: 105,
      petHeight: 115,
      windowWidth: 132,
      windowHeight: 157,
      petTop: 0,
      statusGap: 5,
      statusSideMargin: 12,
      statusPaddingX: 6,
      statusPaddingY: 2,
      idleFontSize: 14,
      statusMessageFontSize: 10,
      statusDetailFontSize: 14
    }
  });
});

test("legacy zoom is read only when a named size has not already been saved", () => {
  assert.equal(normalizePetSize("large", 0.5), "large");
  assert.equal(normalizePetSize("normal", 0.5), "normal");
  assert.equal(normalizePetSize("small", 1.25), "small");
  assert.equal(normalizePetSize("unknown", 1.24), "large");
  assert.equal(normalizePetSize("unknown", 1), "large");
  assert.equal(normalizePetSize("unknown", 0.5), "normal");
  assert.equal(normalizePetSize("unknown", 0.25), "small");
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

test("dropped pet ZIP input accepts bounded bytes without exposing a file path", () => {
  assert.equal(DroppedPetZipInputSchema.safeParse({
    fileName: "my-pet.zip",
    bytes: new Uint8Array([0x50, 0x4b])
  }).success, true);
  assert.equal(DroppedPetZipInputSchema.safeParse({
    fileName: "my-pet.webp",
    bytes: new Uint8Array([1])
  }).success, false);
  assert.equal(DroppedPetZipInputSchema.safeParse({
    fileName: "my-pet.zip",
    bytes: new Uint8Array(),
    filePath: "C:\\arbitrary.zip"
  }).success, false);
});
