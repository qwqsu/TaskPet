import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PET_MOUSE_BINDINGS,
  DroppedPetZipInputSchema,
  KeyboardMappingSettingsSchema,
  PET_SIZE_PRESETS,
  PET_OPACITY_STEP,
  UpdateAppSettingsInputSchema,
  normalizeKeyboardMappingSettings,
  normalizePetOpacity,
  normalizePetMouseBindings,
  normalizePetSize,
  petMouseActionForGesture
} from "../src/shared/app-settings";
import { defaultRadialSettings } from "../src/shared/radial-settings";

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

test("opacity accepts every whole percent from 20 through 100", () => {
  assert.equal(PET_OPACITY_STEP, 1);
  for (let opacity = 20; opacity <= 100; opacity += 1) {
    assert.equal(normalizePetOpacity(opacity), opacity);
    assert.equal(UpdateAppSettingsInputSchema.safeParse({ petOpacity: opacity }).success, true);
  }
  assert.equal(normalizePetOpacity(83.4), 83);
  assert.equal(normalizePetOpacity(83.5), 84);
  for (const value of [undefined, null, 0, 19, 101, NaN, Infinity, "invalid"]) {
    assert.equal(normalizePetOpacity(value), 100);
  }
  for (const value of [null, 0, 19, 101, 83.5, NaN, Infinity, "83"]) {
    assert.equal(UpdateAppSettingsInputSchema.safeParse({ petOpacity: value }).success, false);
  }
});

test("settings updates validate pet scale and the complete radial configuration", () => {
  for (const petScale of [60, 100, 137, 180]) {
    assert.equal(UpdateAppSettingsInputSchema.safeParse({ petScale }).success, true);
  }
  for (const petScale of [59, 181, 100.5, "100", null, NaN, Infinity]) {
    assert.equal(UpdateAppSettingsInputSchema.safeParse({ petScale }).success, false);
  }
  const radialMenu = defaultRadialSettings();
  assert.deepEqual(UpdateAppSettingsInputSchema.parse({ petScale: 137, radialMenu }), {
    petScale: 137, radialMenu
  });
  for (const invalid of [
    { enabled: true },
    { ...radialMenu, opacity: 39 },
    { ...radialMenu, scale: 141 },
    { ...radialMenu, items: [radialMenu.items[0], radialMenu.items[0]] },
    { ...radialMenu, execute: "arbitrary-command" }
  ]) {
    assert.equal(UpdateAppSettingsInputSchema.safeParse({ radialMenu: invalid }).success, false);
  }
});

test("keyboard mappings keep only supported unique keys and eight-character labels", () => {
  const normalized = normalizeKeyboardMappingSettings({
    enabled: true,
    mappings: [
      { key: "KeyA", label: "写代码", enabled: true },
      { key: "KeyA", label: "重复", enabled: true },
      { key: "Mouse1", label: "鼠标", enabled: true },
      { key: "F12", label: "abcdefgh", enabled: false }
    ]
  });
  assert.deepEqual(normalized, {
    enabled: true,
    mappings: [
      { key: "KeyA", label: "写代码", enabled: true },
      { key: "F12", label: "abcdefgh", enabled: false }
    ]
  });
  assert.equal(KeyboardMappingSettingsSchema.safeParse(normalized).success, true);
  assert.equal(KeyboardMappingSettingsSchema.safeParse({
    enabled: true,
    mappings: [{ key: "KeyB", label: "123456789", enabled: true }]
  }).success, false);
  assert.equal(UpdateAppSettingsInputSchema.safeParse({
    keyboardMapping: {
      enabled: true,
      mappings: [{ key: "Mouse1", label: "mouse", enabled: true }]
    }
  }).success, false);
});

test("pet mouse bindings use fixed actions and safe defaults", () => {
  assert.deepEqual(normalizePetMouseBindings(null), DEFAULT_PET_MOUSE_BINDINGS);
  assert.equal(DEFAULT_PET_MOUSE_BINDINGS.rightClick, "open-radial-menu");
  assert.deepEqual(normalizePetMouseBindings({
    leftClick: "open-panel",
    doubleClick: "toggle-monitoring",
    rightClick: "open-settings"
  }), DEFAULT_PET_MOUSE_BINDINGS, "the complete legacy default should migrate");
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
