/**
 * 无外部依赖的低频文件日志。
 * 只记录应用生命周期、migration、匹配任务事件和错误，不记录完整进程快照。
 */
const fs = require("node:fs");
const path = require("node:path");

function singleLine(value) {
  return String(value ?? "").replace(/[\r\n]+/g, " ").trim();
}

function errorText(error) {
  if (!error) return "";
  if (error instanceof Error) return singleLine(error.stack || error.message);
  return singleLine(error);
}

function createFileLogger(options) {
  const logsDirectory = path.resolve(options.logsDirectory);
  const logPath = path.join(logsDirectory, "taskpet.log");
  const maxBytes = Number.isFinite(options.maxBytes) ? options.maxBytes : 1_000_000;
  const now = typeof options.now === "function" ? options.now : () => new Date();
  fs.mkdirSync(logsDirectory, { recursive: true });

  function rotateIfNeeded() {
    try {
      if (fs.statSync(logPath).size < maxBytes) return;
      const stamp = now().toISOString().replace(/[:.]/g, "-");
      fs.renameSync(logPath, path.join(logsDirectory, `taskpet-${stamp}.log`));
    } catch (error) {
      if (error?.code !== "ENOENT") console.warn(`TaskPet log rotation failed: ${errorText(error)}`);
    }
  }

  function write(level, message, error) {
    try {
      rotateIfNeeded();
      const suffix = error ? ` | ${errorText(error)}` : "";
      fs.appendFileSync(
        logPath,
        `${now().toISOString()} [${level}] ${singleLine(message)}${suffix}\n`,
        "utf8"
      );
    } catch (writeError) {
      console.warn(`TaskPet log write failed: ${errorText(writeError)}`);
    }
  }

  return Object.freeze({
    logPath,
    info: (message) => write("INFO", message),
    warn: (message, error) => write("WARN", message, error),
    error: (message, error) => write("ERROR", message, error)
  });
}

module.exports = { createFileLogger };

