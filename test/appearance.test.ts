import test from "node:test";
import assert from "node:assert/strict";
import { normalizeAppearance, resolveTheme, THEME_IDS } from "../src/shared/appearance";
import { UpdateAppSettingsInputSchema } from "../src/shared/app-settings";

test("old or invalid appearance settings preserve the warm default", () => {
  for (const value of [null, undefined, {}, {themeId: "remote-url", themeMode: "manual"}]) {
    assert.deepEqual(normalizeAppearance(value), {themeMode: "manual", themeId: "classic-warm"});
  }
});
test("five manual themes persist and system mode resolves Windows light/dark preference", () => {
  for (const themeId of THEME_IDS) {
    const appearance = {themeMode: "manual" as const, themeId};
    assert.deepEqual(UpdateAppSettingsInputSchema.parse({appearance}), {appearance});
    assert.equal(resolveTheme(appearance, true), themeId);
  }
  const system = {themeMode: "system" as const, themeId: "sakura" as const};
  assert.equal(resolveTheme(system, true), "midnight-blue");
  assert.equal(resolveTheme(system, false), "classic-warm");
});
