import { describe, expect, it } from "vitest";
import {
  formatReport,
  runBenchmark,
  type BenchmarkCase,
  type BenchmarkReport,
} from "../src/bench/benchmark.js";
import { SEED_CASES } from "../src/bench/seed-cases.js";
import { createTieredModelRouter } from "../src/router/model-tiers.js";

describe("runBenchmark", () => {
  it("passes the full seed set against the default roster", () => {
    const report = runBenchmark(SEED_CASES, createTieredModelRouter());
    expect(report.failed).toBe(0);
    expect(report.passed).toBe(SEED_CASES.length);
  });

  it("keeps seed case ids unique", () => {
    const ids = SEED_CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("reports a tier mismatch with a reason", () => {
    const cases: BenchmarkCase[] = [
      {
        id: "wrong-tier",
        description: "expects principal for leaf work",
        context: { role: "implementer" },
        expected: { tier: "principal" },
      },
    ];
    const report = runBenchmark(cases, createTieredModelRouter());
    expect(report.failed).toBe(1);
    const result = report.results[0];
    expect(result.passed).toBe(false);
    expect(result.reasons[0]).toContain("tier leaf, expected principal");
  });

  it("reports a family-diversity violation", () => {
    const cases: BenchmarkCase[] = [
      {
        id: "same-family",
        description: "reviewer must not share the author family",
        context: { role: "reviewer", riskLevel: "low" },
        expected: { notFamily: "deepseek" },
      },
    ];
    const report = runBenchmark(cases, createTieredModelRouter());
    expect(report.failed).toBe(1);
    expect(report.results[0].reasons[0]).toContain("should have been avoided");
  });

  it("reports a shadow cost bound violation", () => {
    const cases: BenchmarkCase[] = [
      {
        id: "too-expensive",
        description: "leaf work must stay under an impossible bound",
        context: { role: "implementer" },
        expected: { maxShadowCost: 1 },
      },
    ];
    const report = runBenchmark(cases, createTieredModelRouter());
    expect(report.failed).toBe(1);
    expect(report.results[0].reasons[0]).toContain("exceeds bound 1");
  });

  it("records selection details on every result", () => {
    const report = runBenchmark(SEED_CASES, createTieredModelRouter());
    for (const result of report.results) {
      expect(result.selectedModelId).not.toBe("");
      expect(result.selectedShadowCost).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("formatReport", () => {
  it("renders pass lines and the summary", () => {
    const report = runBenchmark(SEED_CASES, createTieredModelRouter());
    const text = formatReport(report);
    expect(text).toContain(`[pass] impl-routine:`);
    expect(text).toContain(
      `${String(SEED_CASES.length)}/${String(SEED_CASES.length)} benchmark cases passed`
    );
  });

  it("renders fail lines with reasons", () => {
    const failing: BenchmarkReport = {
      results: [
        {
          caseId: "x",
          description: "broken",
          passed: false,
          reasons: ["tier leaf, expected senior"],
          selectedModelId: "deepseek-v4-flash",
          selectedTier: "leaf",
          selectedFamily: "deepseek",
          selectedShadowCost: 4,
        },
      ],
      passed: 0,
      failed: 1,
    };
    const text = formatReport(failing);
    expect(text).toContain("[fail] x: deepseek-v4-flash (leaf/deepseek) — tier leaf, expected senior");
    expect(text).toContain("0/1 benchmark cases passed");
  });
});
