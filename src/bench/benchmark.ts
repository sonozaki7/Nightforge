import type {
  ModelSelectionContext,
  ModelTier,
  TieredModelRouter,
} from "../router/model-tiers.js";

/**
 * Public benchmark harness (Roadmap Phase 7).
 *
 * A benchmark case pins a routing context and the expected selection
 * properties. The runner is deterministic and offline: it exercises the
 * tiered router, never live providers, so CI can re-run it after any
 * model/prompt/orchestration change (Guide NIGHTFORGE-V2.1 §25.3).
 */

export interface BenchmarkExpectation {
  /** Selected model must sit in this tier. */
  tier?: ModelTier;
  /** Selected model must belong to this family. */
  family?: string;
  /** Family-diversity guard: selected model must NOT belong to this family. */
  notFamily?: string;
  /** Selected shadow cost must not exceed this bound. */
  maxShadowCost?: number;
}

export interface BenchmarkCase {
  id: string;
  description: string;
  context: ModelSelectionContext;
  expected: BenchmarkExpectation;
}

export interface BenchmarkResult {
  caseId: string;
  description: string;
  passed: boolean;
  reasons: string[];
  selectedModelId: string;
  selectedTier: ModelTier;
  selectedFamily: string;
  selectedShadowCost: number;
}

export interface BenchmarkReport {
  results: BenchmarkResult[];
  passed: number;
  failed: number;
}

export function runBenchmark(
  cases: readonly BenchmarkCase[],
  router: TieredModelRouter
): BenchmarkReport {
  const results: BenchmarkResult[] = cases.map((benchmarkCase) => {
    const selection = router.select(benchmarkCase.context);
    const reasons: string[] = [];
    const expected = benchmarkCase.expected;

    if (expected.tier !== undefined && selection.tier !== expected.tier) {
      reasons.push(`tier ${selection.tier}, expected ${expected.tier}`);
    }
    if (expected.family !== undefined && selection.family !== expected.family) {
      reasons.push(`family ${selection.family}, expected ${expected.family}`);
    }
    if (expected.notFamily !== undefined && selection.family === expected.notFamily) {
      reasons.push(`family ${selection.family} should have been avoided`);
    }
    if (
      expected.maxShadowCost !== undefined &&
      selection.shadowCostPerRun > expected.maxShadowCost
    ) {
      reasons.push(
        `shadow cost ${String(selection.shadowCostPerRun)} exceeds bound ${String(expected.maxShadowCost)}`
      );
    }

    return {
      caseId: benchmarkCase.id,
      description: benchmarkCase.description,
      passed: reasons.length === 0,
      reasons,
      selectedModelId: selection.id,
      selectedTier: selection.tier,
      selectedFamily: selection.family,
      selectedShadowCost: selection.shadowCostPerRun,
    };
  });

  return {
    results,
    passed: results.filter((r) => r.passed).length,
    failed: results.filter((r) => !r.passed).length,
  };
}

export function formatReport(report: BenchmarkReport): string {
  const lines = report.results.map((result) => {
    const status = result.passed ? "[pass]" : "[fail]";
    const detail = `${result.selectedModelId} (${result.selectedTier}/${result.selectedFamily})`;
    if (result.passed) {
      return `${status} ${result.caseId}: ${detail}`;
    }
    return `${status} ${result.caseId}: ${detail} — ${result.reasons.join("; ")}`;
  });
  lines.push("");
  lines.push(`${String(report.passed)}/${String(report.results.length)} benchmark cases passed`);
  return lines.join("\n");
}
