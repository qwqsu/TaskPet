import test from "node:test";
import assert from "node:assert/strict";
import {
  PET_SIZE_ZOOMS,
  UpdateAppSettingsInputSchema,
  normalizePetSize,
  petSizeFromZoom
} from "../src/shared/app-settings";

test("pet size exposes only the 125%, 100%, and 50% presets", () => {
  assert.deepEqual(PET_SIZE_ZOOMS, {
    large: 1.25,
    normal: 1,
    small: 0.5
  });
  assert.equal(normalizePetSize("large"), "large");
  assert.equal(normalizePetSize("unknown", 0.66), "small");
  assert.equal(petSizeFromZoom(1.12), "normal");
  assert.equal(petSizeFromZoom(1.24), "large");
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

