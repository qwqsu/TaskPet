const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");

test("package and builder use the temporary TaskPet identity", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const builder = fs.readFileSync(path.join(root, "electron-builder.yml"), "utf8");

  assert.equal(packageJson.name, "taskpet");
  assert.equal(packageJson.version, "0.2.0-p1");
  assert.deepEqual(Object.keys(packageJson.dependencies).sort(), ["better-sqlite3", "zod"]);
  assert.equal(packageJson.scripts.smoke, "npm run compile && electron . --smoke-test");
  assert.equal(Object.keys(packageJson.scripts).some((name) => name.startsWith("hooks:")), false);
  assert.match(builder, /^appId: com\.taskpet\.shell$/m);
  assert.match(builder, /^productName: TaskPet$/m);
  assert.match(builder, /^  signAndEditExecutable: false$/m);
  assert.match(builder, /^  - build\/\*\*$/m);
  assert.match(builder, /^asarUnpack:/m);
  assert.match(builder, /^npmRebuild: true$/m);
  assert.doesNotMatch(builder, /^publish:/m);
  assert.doesNotMatch(builder, /yangbuyiya\/desktop-pet/);
});

test("P0 source has no Agent runtime, local API, reminder, bubble, or updater entrypoint", () => {
  const main = fs.readFileSync(path.join(root, "src", "main.js"), "utf8");
  const preload = fs.readFileSync(path.join(root, "src", "preload.js"), "utf8");

  for (const pattern of [
    /electron-updater/,
    /createServer/,
    /hook-installer/,
    /session-manager/,
    /reminder-manager/,
    /bubble\.html/
  ]) {
    assert.doesNotMatch(main, pattern);
  }

  assert.match(preload, /exposeInMainWorld\("taskPet"/);
  assert.doesNotMatch(preload, /hook|reminder|bubble|update|desktopPet/i);

  for (const removedFile of [
    "src/agent-events.js",
    "src/hook-bridge.js",
    "src/hook-installer.js",
    "src/session-manager.js",
    "src/reminder-manager.js",
    "src/renderer/bubble.html",
    "src/renderer/settings.html",
    "dev-app-update.yml"
  ]) {
    assert.equal(fs.existsSync(path.join(root, removedFile)), false, removedFile);
  }
});
