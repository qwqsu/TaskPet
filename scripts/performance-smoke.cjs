/**
 * 性能 smoke 的命令行启动器。
 * 它以隔离 userData 启动 Electron，等待主进程生成 JSON 报告，并在退出后清理测试数据。
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const electronPath = require("electron");
const outputPath = path.join(root, "dist", "performance", "latest.json");

function removePerformanceUserData(userDataPath) {
  if (typeof userDataPath !== "string" || userDataPath.length === 0) return;
  const resolved = path.resolve(userDataPath);
  const expectedParent = path.resolve(os.tmpdir());
  if (
    path.dirname(resolved) !== expectedParent
    || !path.basename(resolved).startsWith("TaskPet-performance-")
  ) {
    throw new Error(`Refusing to remove unexpected performance directory: ${resolved}`);
  }
  fs.rmSync(resolved, { recursive: true, force: true });
}

async function main() {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.rmSync(outputPath, { force: true });

  const child = spawn(electronPath, [
    root,
    "--performance-smoke",
    `--performance-output=${outputPath}`
  ], {
    cwd: root,
    stdio: "inherit",
    windowsHide: true
  });

  const timeout = setTimeout(() => {
    console.error("TaskPet performance smoke timed out after 45 seconds");
    child.kill();
  }, 45_000);

  let exitCode;
  try {
    exitCode = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => resolve(code));
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!fs.existsSync(outputPath)) {
    throw new Error(`Performance report was not created (exit code ${String(exitCode)})`);
  }
  const report = JSON.parse(fs.readFileSync(outputPath, "utf8"));
  removePerformanceUserData(report.userDataPath);

  if (exitCode !== 0 || !report.passed) {
    const failures = report.checks
      .filter((check) => !check.passed)
      .map((check) => `${check.name}: ${check.actual} > ${check.limit}`)
      .join(", ");
    throw new Error(`Performance smoke failed${failures ? ` (${failures})` : ""}`);
  }

  console.log(`Performance report retained at ${outputPath}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
