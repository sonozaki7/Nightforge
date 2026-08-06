import { describe, expect, it } from "vitest";
import {
  cheapestInTier,
  DEFAULT_ESTIMATES,
  estimatesForContext,
  rankRoutes,
  scoreRoute,
} from "../src/router/route-cost.js";
import { createAdaptiveRouter } from "../src/router/adaptive-router.js";
import type { ModelDescriptor, ModelTier } from "../src/router/model-tiers.js";

const qwenSenior: ModelDescriptor = {
  id: "qwen3.8-max",
  tier: "senior",
  family: "qwen",
  shadowCostPerRun: 20,
};

const qwenLeaf: ModelDescriptor = {
  id: "qwen3.7-plus",
  tier: "leaf",
  family: "qwen",
  shadowCostPerRun: 5,
};

const solPrincipal: ModelDescriptor = {
  id: "gpt-5.6-sol",
  tier: "principal",
  family: "openai",
  shadowCostPerRun: 100,
};

describe("scoreRoute", () => {
  it("should price shadow cost plus expected retry cost", () => {
    // 20 + 0.2 * 20 = 24 with the default estimates
    expect(scoreRoute(qwenSenior, DEFAULT_ESTIMATES)).toBe(24);
  });

  it("should add review cost and human minutes when approval is expected", () => {
    const estimates = { ...DEFAULT_ESTIMATES, reviewProbability: 1 };
    // 20 + 0.2*20 retry + 1*20 review + 2 min * 5 = 54
    expect(scoreRoute(qwenSenior, estimates)).toBe(54);
  });

  it("should include the regression penalty", () => {
    const estimates = { ...DEFAULT_ESTIMATES, regressionPenalty: 7 };
    expect(scoreRoute(qwenLeaf, estimates)).toBe(6 + 7);
  });
});

describe("estimatesForContext", () => {
  it("should keep base estimates for low-risk tickets without failures", () => {
    const estimates = estimatesForContext({ role: "implementer", riskLevel: "low" });
    expect(estimates.retryProbability).toBe(0.2);
    expect(estimates.reviewProbability).toBe(0);
  });

  it("should raise retry probability with failure count, capped at 1", () => {
    const two = estimatesForContext({
      role: "implementer",
      riskLevel: "low",
      failureCount: 2,
    });
    expect(two.retryProbability).toBeCloseTo(0.5);

    const capped = estimatesForContext({
      role: "implementer",
      riskLevel: "low",
      failureCount: 10,
    });
    // 0.2 + min(10, 2) * 0.15 = 0.5, still under the cap
    expect(capped.retryProbability).toBeCloseTo(0.5);
  });

  it("should force a review run for high and critical risk", () => {
    const high = estimatesForContext({ role: "implementer", riskLevel: "high" });
    expect(high.reviewProbability).toBe(1);

    const critical = estimatesForContext({
      role: "implementer",
      riskLevel: "critical",
    });
    expect(critical.reviewProbability).toBe(1);
  });
});

describe("rankRoutes", () => {
  it("should order candidates by cheapest expected total cost", () => {
    const ranked = rankRoutes(
      [solPrincipal, qwenSenior, qwenLeaf],
      DEFAULT_ESTIMATES
    );
    expect(ranked.map((m) => m.id)).toEqual([
      "qwen3.7-plus",
      "qwen3.8-max",
      "gpt-5.6-sol",
    ]);
  });

  it("should not mutate the input list", () => {
    const candidates = [solPrincipal, qwenLeaf];
    rankRoutes(candidates, DEFAULT_ESTIMATES);
    expect(candidates.map((m) => m.id)).toEqual(["gpt-5.6-sol", "qwen3.7-plus"]);
  });
});

describe("cheapestInTier", () => {
  const fakeRouter = {
    modelsInTier: (_tier: ModelTier): ModelDescriptor[] => [qwenSenior, qwenLeaf],
  };

  it("should fall back to the cost score without learned samples", () => {
    const chosen = cheapestInTier(fakeRouter, qwenSenior, {
      role: "implementer",
      riskLevel: "low",
    });
    expect(chosen.id).toBe("qwen3.7-plus");
  });

  it("should prefer the learned capable model once samples exist", () => {
    const adaptive = createAdaptiveRouter({ minSamples: 5, minSuccessRate: 0.7 });
    // Senior model proven reliable; leaf has no history.
    for (let i = 0; i < 6; i += 1) {
      adaptive.recordOutcome(qwenSenior.id, "implementer", true);
    }
    const chosen = cheapestInTier(
      fakeRouter,
      qwenSenior,
      { role: "implementer", riskLevel: "low" },
      adaptive
    );
    expect(chosen.id).toBe(qwenSenior.id);
  });

  it("should never let learning override critical-work safety", () => {
    const adaptive = createAdaptiveRouter({ minSamples: 5, minSuccessRate: 0.7 });
    for (let i = 0; i < 6; i += 1) {
      adaptive.recordOutcome(qwenSenior.id, "implementer", true);
    }
    const chosen = cheapestInTier(
      fakeRouter,
      qwenSenior,
      { role: "implementer", riskLevel: "critical" },
      adaptive
    );
    // Deterministic cheapest route applies on critical work.
    expect(chosen.id).toBe("qwen3.7-plus");
  });
});
