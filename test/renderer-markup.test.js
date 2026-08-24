const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { PET_STATES } = require("../src/pet-state");

const rendererRoot = path.join(__dirname, "..", "src", "renderer");

test("pet renderer markup keeps the visible stage mounted", () => {
  const html = fs.readFileSync(path.join(rendererRoot, "index.html"), "utf8");

  assert.match(html, /<title>TaskPet<\/title>/);
  assert.match(html, /<main class="stage"[^>]*>/);
  assert.match(html, /id="pet"/);
  assert.match(html, /id="sprite"/);
  assert.match(html, /id="petStatusMessage"/);
  assert.match(html, /id="petStatusDetail"/);
  assert.doesNotMatch(html, /resizeHandle|resize-handle/);
  assert.doesNotMatch(html, /bubble|settings/i);
});

test("pet renderer places a 13px task line above an emphasized 18px runtime", () => {
  const source = fs.readFileSync(path.join(rendererRoot, "renderer.js"), "utf8");
  const styles = fs.readFileSync(path.join(rendererRoot, "styles.css"), "utf8");
  const messageFontSize = styles.match(
    /\.pet-status-message\s*\{[^}]*font-size:\s*([^;]+);/s
  )?.[1];
  const detailFontSize = styles.match(
    /\.pet-status-detail\s*\{[^}]*font-size:\s*([^;]+);/s
  )?.[1];

  assert.match(source, /petStatusMessage\.textContent = message/);
  assert.match(source, /petStatusDetail\.textContent = detail/);
  assert.match(source, /payload\?\.detail/);
  assert.match(styles, /\.pet\s*\{[^}]*top: var\(--pet-top\)/s);
  assert.match(styles, /\.pet-status-message\s*\{[^}]*text-overflow: ellipsis/s);
  assert.match(styles, /\.pet-status-detail\s*\{[^}]*font-variant-numeric: tabular-nums/s);
  assert.equal(messageFontSize, "13px");
  assert.equal(detailFontSize, "18px");
});

test("idle pet shows only kaomoji without the white rounded status frame", () => {
  const html = fs.readFileSync(path.join(rendererRoot, "index.html"), "utf8");
  const source = fs.readFileSync(path.join(rendererRoot, "renderer.js"), "utf8");
  const styles = fs.readFileSync(path.join(rendererRoot, "styles.css"), "utf8");

  assert.match(html, /id="petStatus"[^>]*hidden/);
  assert.match(styles, /\.pet-status\[hidden\]\s*\{[^}]*display:\s*none/s);
  assert.match(styles, /\.pet-status\.idle-text\s*\{[^}]*border:\s*0/s);
  assert.match(styles, /\.pet-status\.idle-text\s*\{[^}]*background:\s*transparent/s);
  assert.match(styles, /\.pet-status\.idle-text\s*\{[^}]*box-shadow:\s*none/s);
  assert.match(source, /renderPetStatus\(message, "", true\)/);
  assert.match(source, /setTimeout\(showNextIdleMessage, IDLE_MESSAGE_INTERVAL_MS\)/);
  assert.match(source, /updatePetStatus\(nextState, message, detail\)/);
});

test("pet visual presets use exact independent width and height scaling", () => {
  const source = fs.readFileSync(path.join(rendererRoot, "renderer.js"), "utf8");
  const styles = fs.readFileSync(path.join(rendererRoot, "styles.css"), "utf8");

  assert.match(styles, /--pet-width:\s*96px/);
  assert.match(styles, /--pet-height:\s*104px/);
  assert.match(source, /DEFAULT_VISUAL_SIZE = Object\.freeze\(\{ width: 96, height: 104 \}\)/);
  assert.match(source, /--pet-width", `\$\{visualSize\.width\}px`/);
  assert.match(source, /--pet-height", `\$\{visualSize\.height\}px`/);
  assert.match(source, /x: visualSize\.width \/ frame\.width/);
  assert.match(source, /y: visualSize\.height \/ frame\.height/);
});

test("pet click, double click, and right click use fixed mouse-action IPC", () => {
  const source = fs.readFileSync(path.join(rendererRoot, "renderer.js"), "utf8");
  const preload = fs.readFileSync(path.join(__dirname, "..", "src", "preload.js"), "utf8");

  assert.match(source, /performMouseAction\("left"\)/);
  assert.match(source, /performMouseAction\("double"\)/);
  assert.match(source, /performMouseAction\("right"\)/);
  assert.match(source, /event\.preventDefault\(\)/);
  assert.match(source, /event\.type === "pointerup" && dragStart\.moved/);
  assert.match(preload, /taskpet:pet-mouse-action/);
});

test("renderer uses only the six TaskPet states", () => {
  const source = fs.readFileSync(path.join(rendererRoot, "renderer.js"), "utf8");
  for (const state of PET_STATES) {
    assert.match(source, new RegExp(`"${state}"`));
  }

  for (const removedState of [
    "running-right",
    "running-left",
    "waving",
    "jumping",
    "failed",
    "waiting",
    "review",
    "thinking",
    "sleeping"
  ]) {
    assert.doesNotMatch(source, new RegExp(`"${removedState}"`));
  }
  assert.match(source, /window\.taskPet/);
  assert.doesNotMatch(source, /window\.desktopPet/);
});

test("pet bounds visualization is enabled only by the explicit debug flag", () => {
  const main = fs.readFileSync(path.join(__dirname, "..", "src", "main.js"), "utf8");
  const source = fs.readFileSync(path.join(rendererRoot, "renderer.js"), "utf8");
  const styles = fs.readFileSync(path.join(rendererRoot, "styles.css"), "utf8");

  assert.match(main, /process\.argv\.includes\("--debug-pet-bounds"\)/);
  assert.match(main, /debugPetBounds: IS_DEBUG_PET_BOUNDS/);
  assert.match(source, /classList\.toggle\("debug-pet-bounds", Boolean\(enabled\)\)/);
  assert.match(styles, /\.debug-pet-bounds \.stage/);
  assert.match(styles, /\.debug-pet-bounds \.pet/);
  assert.match(styles, /\.debug-pet-bounds \.sprite/);
  assert.doesNotMatch(styles, /^\.stage\s*\{[^}]*background:/ms);
});

test("pet dragging keeps native cursor coordinates and window bounds in the main process", () => {
  const main = fs.readFileSync(path.join(__dirname, "..", "src", "main.js"), "utf8");
  const preload = fs.readFileSync(path.join(__dirname, "..", "src", "preload.js"), "utf8");
  const source = fs.readFileSync(path.join(rendererRoot, "renderer.js"), "utf8");

  assert.match(main, /screen\.getCursorScreenPoint\(\)/);
  assert.match(main, /petWindow\.setBounds\(petBoundsForCursor/);
  assert.match(preload, /startWindowDrag: \(\) => ipcRenderer\.send\("taskpet:start-window-drag"\)/);
  assert.match(preload, /moveWindow: \(\) => ipcRenderer\.send\("taskpet:move-window"\)/);
  assert.doesNotMatch(source, /windowX: bounds\.x|windowY: bounds\.y/);
  assert.doesNotMatch(main, /petWindow\.setPosition\(/);
  assert.doesNotMatch(preload, /resize-window|getWindowBounds|resizeWindow/);
});
