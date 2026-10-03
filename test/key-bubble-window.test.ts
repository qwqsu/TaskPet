import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  createKeyBubbleWindowOptions,
  keyBubbleBoundsForPet
} from "../src/main/windows/key-bubble-window";

test("key bubbles use a non-focusable, isolated, click-through-capable window", () => {
  const options = createKeyBubbleWindowOptions({ preloadPath: "C:\\TaskPet\\bubbles.js" });
  assert.equal(options.frame, false);
  assert.equal(options.transparent, true);
  assert.equal(options.focusable, false);
  assert.equal(options.alwaysOnTop, true);
  assert.equal(options.skipTaskbar, true);
  assert.equal(options.webPreferences?.contextIsolation, true);
  assert.equal(options.webPreferences?.nodeIntegration, false);
  assert.equal(options.webPreferences?.sandbox, true);
});

test("key bubble overlay follows above the pet and clamps to the active work area", () => {
  assert.deepEqual(keyBubbleBoundsForPet(
    { x: 940, y: 500, width: 120, height: 143 },
    { x: 0, y: 0, width: 1920, height: 1040 }
  ), { x: 860, y: 406, width: 280, height: 86 });
  assert.equal(keyBubbleBoundsForPet(
    { x: 0, y: 2, width: 60, height: 72 },
    { x: 0, y: 0, width: 800, height: 600 }
  ).y, 8);
});

test("bubble renderer caps visible labels at three and expires them near one second", () => {
  const root = path.join(__dirname, "..", "..");
  const source = fs.readFileSync(
    path.join(root, "src", "renderer", "key-bubbles", "key-bubbles.ts"),
    "utf8"
  );
  assert.match(source, /MAX_VISIBLE_BUBBLES = 3/);
  assert.match(source, /BUBBLE_LIFETIME_MS = 1_050/);
  assert.match(source, /slice\(0, 8\)/);
  assert.doesNotMatch(source, /localStorage|fetch\(|XMLHttpRequest/);
});

