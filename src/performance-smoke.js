/**
 * 显式 --performance-smoke 模式使用的轻量性能采样器。
 * 正式启动不会加载本模块，也不会创建这里的 timer 或 renderer 探针。
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const WARMUP_MS = 2_500;
const SAMPLE_INTERVAL_MS = 1_000;
const SAMPLE_COUNT = 8;

const DEFAULT_THRESHOLDS = Object.freeze({
  maxProcessCount: 4,
  averageCpuPercent: 8,
  maxWorkingSetMb: 650,
  maxPrivateMemoryMb: 350,
  p95MainTimerDriftMs: 120,
  p95RendererFrameMs: 50,
  maxRendererFrameMs: 250
});

function delay(durationMs) {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

function round(value, digits = 2) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function average(values) {
  return values.length === 0
    ? 0
    : values.reduce((total, value) => total + value, 0) / values.length;
}

function percentile(values, percentileValue) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * percentileValue) - 1)
  );
  return sorted[index];
}

function metricSample(app) {
  const metrics = app.getAppMetrics();
  const processTypes = {};
  let cpuPercent = 0;
  let workingSetKb = 0;
  let privateMemoryKb = 0;

  for (const metric of metrics) {
    const type = metric.type || "Unknown";
    processTypes[type] = (processTypes[type] || 0) + 1;
    cpuPercent += Number(metric.cpu?.percentCPUUsage) || 0;
    workingSetKb += Number(metric.memory?.workingSetSize) || 0;
    privateMemoryKb += Number(metric.memory?.privateBytes) || 0;
  }

  return {
    capturedAt: new Date().toISOString(),
    processCount: metrics.length,
    processTypes,
    cpuPercent: round(cpuPercent, 3),
    workingSetMb: round(workingSetKb / 1_024),
    privateMemoryMb: round(privateMemoryKb / 1_024)
  };
}

async function measureRendererFrames(webContents, durationMs) {
  return webContents.executeJavaScript(`
    new Promise((resolve) => {
      const intervals = [];
      let startedAt = null;
      let previous = null;
      function sample(now) {
        if (startedAt === null) startedAt = now;
        if (previous !== null) intervals.push(now - previous);
        previous = now;
        if (now - startedAt >= ${durationMs}) {
          resolve(intervals);
          return;
        }
        requestAnimationFrame(sample);
      }
      requestAnimationFrame(sample);
    })
  `, true);
}

function summarizePerformanceSamples({
  samples,
  mainTimerDriftMs,
  rendererFrameIntervalsMs,
  rendererReadyMs
}) {
  const processCounts = samples.map((sample) => sample.processCount);
  const cpuValues = samples.map((sample) => sample.cpuPercent);
  const workingSetValues = samples.map((sample) => sample.workingSetMb);
  const privateMemoryValues = samples.map((sample) => sample.privateMemoryMb);

  return {
    rendererReadyMs: round(rendererReadyMs),
    process: {
      maxCount: Math.max(0, ...processCounts),
      types: samples.at(-1)?.processTypes || {}
    },
    cpu: {
      averagePercent: round(average(cpuValues), 3),
      maxPercent: round(Math.max(0, ...cpuValues), 3)
    },
    memory: {
      averageWorkingSetMb: round(average(workingSetValues)),
      maxWorkingSetMb: round(Math.max(0, ...workingSetValues)),
      averagePrivateMemoryMb: round(average(privateMemoryValues)),
      maxPrivateMemoryMb: round(Math.max(0, ...privateMemoryValues))
    },
    responsiveness: {
      mainTimerP95DriftMs: round(percentile(mainTimerDriftMs, 0.95)),
      mainTimerMaxDriftMs: round(Math.max(0, ...mainTimerDriftMs)),
      rendererFrameCount: rendererFrameIntervalsMs.length,
      rendererFrameAverageMs: round(average(rendererFrameIntervalsMs)),
      rendererFrameP95Ms: round(percentile(rendererFrameIntervalsMs, 0.95)),
      rendererFrameMaxMs: round(Math.max(0, ...rendererFrameIntervalsMs))
    }
  };
}

function evaluatePerformanceSummary(summary, thresholds = DEFAULT_THRESHOLDS) {
  const checks = [
    {
      name: "idle process count",
      actual: summary.process.maxCount,
      limit: thresholds.maxProcessCount
    },
    {
      name: "average CPU",
      actual: summary.cpu.averagePercent,
      limit: thresholds.averageCpuPercent
    },
    {
      name: "working set",
      actual: summary.memory.maxWorkingSetMb,
      limit: thresholds.maxWorkingSetMb
    },
    {
      name: "private memory",
      actual: summary.memory.maxPrivateMemoryMb,
      limit: thresholds.maxPrivateMemoryMb
    },
    {
      name: "main timer p95 drift",
      actual: summary.responsiveness.mainTimerP95DriftMs,
      limit: thresholds.p95MainTimerDriftMs
    },
    {
      name: "renderer frame p95",
      actual: summary.responsiveness.rendererFrameP95Ms,
      limit: thresholds.p95RendererFrameMs
    },
    {
      name: "renderer frame max",
      actual: summary.responsiveness.rendererFrameMaxMs,
      limit: thresholds.maxRendererFrameMs
    }
  ].map((check) => ({ ...check, passed: check.actual <= check.limit }));

  return {
    passed: checks.every((check) => check.passed),
    checks
  };
}

async function runPerformanceSmoke({
  app,
  petWebContents,
  outputPath,
  userDataPath,
  startedAtMs
}) {
  const rendererReadyMs = Date.now() - startedAtMs;
  await delay(WARMUP_MS);

  const rendererFramesPromise = measureRendererFrames(
    petWebContents,
    SAMPLE_INTERVAL_MS * SAMPLE_COUNT
  );
  const samples = [];
  const mainTimerDriftMs = [];

  // 第一次调用建立 CPU 采样基点；正式样本按固定节拍读取。
  app.getAppMetrics();
  let expectedAt = Date.now() + SAMPLE_INTERVAL_MS;
  for (let index = 0; index < SAMPLE_COUNT; index += 1) {
    await delay(Math.max(0, expectedAt - Date.now()));
    const capturedAt = Date.now();
    mainTimerDriftMs.push(Math.max(0, capturedAt - expectedAt));
    samples.push(metricSample(app));
    expectedAt += SAMPLE_INTERVAL_MS;
  }

  const rendererFrameIntervalsMs = await rendererFramesPromise;
  const summary = summarizePerformanceSamples({
    samples,
    mainTimerDriftMs,
    rendererFrameIntervalsMs,
    rendererReadyMs
  });
  const evaluation = evaluatePerformanceSummary(summary);
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    logicalProcessorCount: os.cpus().length,
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron,
    userDataPath,
    sample: {
      warmupMs: WARMUP_MS,
      intervalMs: SAMPLE_INTERVAL_MS,
      count: SAMPLE_COUNT
    },
    thresholds: DEFAULT_THRESHOLDS,
    summary,
    checks: evaluation.checks,
    passed: evaluation.passed,
    samples
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(
    `TaskPet performance smoke ${report.passed ? "passed" : "failed"}`
    + ` processes=${summary.process.maxCount}`
    + ` cpu=${summary.cpu.averagePercent}%`
    + ` workingSet=${summary.memory.averageWorkingSetMb}MB`
    + ` rendererP95=${summary.responsiveness.rendererFrameP95Ms}ms`
    + ` report=${outputPath}`
  );
  return report;
}

module.exports = {
  DEFAULT_THRESHOLDS,
  evaluatePerformanceSummary,
  runPerformanceSmoke,
  summarizePerformanceSamples
};
