const test = require("node:test");
const assert = require("node:assert/strict");
const {
  evaluatePerformanceSummary,
  summarizePerformanceSamples
} = require("../src/performance-smoke");

function sample(cpuPercent, workingSetMb, privateMemoryMb) {
  return {
    processCount: 4,
    processTypes: { Browser: 1, GPU: 1, Tab: 1, Utility: 1 },
    cpuPercent,
    workingSetMb,
    privateMemoryMb
  };
}

test("performance smoke summarizes process, memory, CPU and responsiveness samples", () => {
  const summary = summarizePerformanceSamples({
    samples: [sample(1, 300, 180), sample(3, 320, 190)],
    mainTimerDriftMs: [1, 4, 2],
    rendererFrameIntervalsMs: [16, 17, 18, 20],
    rendererReadyMs: 480
  });

  assert.equal(summary.process.maxCount, 4);
  assert.equal(summary.cpu.averagePercent, 2);
  assert.equal(summary.memory.maxWorkingSetMb, 320);
  assert.equal(summary.responsiveness.mainTimerP95DriftMs, 4);
  assert.equal(summary.responsiveness.rendererFrameP95Ms, 20);
  assert.equal(evaluatePerformanceSummary(summary).passed, true);
});

test("performance smoke reports a failed resource guard without hiding the metric", () => {
  const summary = summarizePerformanceSamples({
    samples: [{ ...sample(1, 300, 180), processCount: 5 }],
    mainTimerDriftMs: [1],
    rendererFrameIntervalsMs: [16],
    rendererReadyMs: 400
  });
  const evaluation = evaluatePerformanceSummary(summary);

  assert.equal(evaluation.passed, false);
  assert.deepEqual(
    evaluation.checks.find((check) => check.name === "idle process count"),
    { name: "idle process count", actual: 5, limit: 4, passed: false }
  );
});
