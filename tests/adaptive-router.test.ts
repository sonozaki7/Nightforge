import { describe, expect, it } from "vitest";
import { createAdaptiveRouter } from "../src/router/adaptive-router.js";
import type { ModelDescriptor } from "../src/router/model-tiers.js";

const cheap: ModelDescriptor = {
  id: "deepseek-v4-flash",
  tier: "leaf",
  family: "deepseek",
  shadowCostPerRun: 4,
};

const pricey: ModelDescriptor = {
  id: "gpt-5.6-luna",
  tier: "leaf",
  family: "openai",
  shadowCostPerRun: 6,
};

function seed(router: ReturnType<typeof createAdaptiveRouter>, modelId: string, successes: number, failures: number): void {
  for (let i = 0; i < successes; i += 1) {
    router.recordOutcome(modelId, "implementer", true);
  }
  for (let i = 0; i < failures; i += 1) {
    router.recordOutcome(modelId, "implementer", false);
  }
}

describe("createAdaptiveRouter", () => {
  it("should keep per-role outcome statistics", () => {
    const router = createAdaptiveRouter();
    router.recordOutcome("m1", "implementer", true);
    router.recordOutcome("m1", "implementer", false);
    router.recordOutcome("m1", "reviewer", true);

    expect(router.statsFor("m1", "implementer")).toEqual({ attempts: 2, successes: 1 });
    expect(router.statsFor("m1", "reviewer")).toEqual({ attempts: 1, successes: 1 });
  });

  it("should produce conservative Laplace estimates with few samples", () => {
    const router = createAdaptiveRouter();
    // No data: prior pulls the estimate to 1/2, not 0 or 1.
    expect(router.successEstimate("m1", "implementer")).toBe(0.5);

    router.recordOutcome("m1", "implementer", true);
    // (1 + 1) / (1 + 2)
    expect(router.successEstimate("m1", "implementer")).toBeCloseTo(2 / 3);
  });

  it("should not adapt before enough samples are collected", () => {
    const router = createAdaptiveRouter({ minSamples: 10, minSuccessRate: 0.7 });
    seed(router, cheap.id, 5, 0);
    expect(router.selectCapable([cheap, pricey], "implementer")).toBeNull();
  });

  it("should pick the cheapest model that clears the capability floor", () => {
    const router = createAdaptiveRouter({ minSamples: 10, minSuccessRate: 0.7 });
    seed(router, cheap.id, 9, 1); // 10 attempts, estimate 10/12 ≈ 0.83
    seed(router, pricey.id, 10, 0); // estimate 11/12 ≈ 0.92

    const chosen = router.selectCapable([pricey, cheap], "implementer");
    expect(chosen?.id).toBe(cheap.id);
  });

  it("should fall back to the deterministic route when nothing is capable", () => {
    const router = createAdaptiveRouter({ minSamples: 10, minSuccessRate: 0.7 });
    seed(router, cheap.id, 4, 6); // estimate 5/12 ≈ 0.42
    seed(router, pricey.id, 3, 7); // estimate 4/12 ≈ 0.33

    expect(router.selectCapable([cheap, pricey], "implementer")).toBeNull();
  });

  it("should never adapt on critical production work", () => {
    const router = createAdaptiveRouter({ minSamples: 10, minSuccessRate: 0.7 });
    seed(router, cheap.id, 10, 0);

    expect(
      router.selectCapable([cheap], "implementer", { riskLevel: "critical" })
    ).toBeNull();
    expect(
      router.selectCapable([cheap], "implementer", { riskLevel: "high" })?.id
    ).toBe(cheap.id);
  });
});
