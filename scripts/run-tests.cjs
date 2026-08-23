/**
 * 测试启动器：同时收集 JavaScript 原始测试和 TypeScript 编译后的测试，
 * 再让 Electron 以 Node test runner 模式执行，确保 native 依赖 ABI 与应用一致。
 */
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.join(__dirname, "..");

function findTests(directory) {
  if (!fs.existsSync(directory)) return [];

  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return findTests(target);
    return entry.isFile() && entry.name.endsWith(".test.js") ? [target] : [];
  });
}

const testFiles = [
  ...findTests(path.join(root, "test")),
  ...findTests(path.join(root, ".test-build", "test"))
];

if (testFiles.length === 0) {
  console.error("No TaskPet tests were found.");
  process.exit(1);
}

const electronPath = require("electron");
const result = spawnSync(electronPath, ["--test", ...testFiles], {
  cwd: root,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  stdio: "inherit"
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
