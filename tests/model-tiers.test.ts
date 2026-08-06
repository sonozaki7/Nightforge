import { describe, expect, it } from "vitest";
import {
  createTieredModelRouter,
  DEFAULT_MODELS,
  expectedTotalCost,
  reviewerTierForRisk,
} from "../src/router/model-tiers.js";

describe("createTieredModelRouter", () => {
  const router = createTieredModelRouter();

  it("should route routine implementer work to the cheapest leaf model", () => {
    const model = router.select({ role: "implementer" });
    expect(model.tier).toBe("leaf");
    expect(model.id).toBe("deepseek-v4-flash");
  });

  it("should route planning roles to the cheapest senior model", () => {
    const model = router.select({ role: "dag_planner" });
    expect(model.tier).toBe("senior");
    expect(model.id).toBe("qwen3.8-max");
  });

  it("should reserve principal tier for the arbiter", () => {
    const model = router.select({ role: "principal_arbiter" });
    expect(model.tier).toBe("principal");
    expect(model.id).toBe("gpt-5.6-sol");
  });

  it("should scale reviewer tier with risk", () => {
    expect(reviewerTierForRisk("low")).toBe("leaf");
    expect(reviewerTierForRisk("medium")).toBe("senior");
    expect(reviewerTierForRisk("critical")).toBe("principal");

    const critical = router.select({ role: "reviewer", riskLevel: "critical" });
    expect(critical.tier).toBe("principal");
  });

  it("should escalate one tier after two failures", () => {
    const model = router.select({ role: "implementer", failureCount: 2 });
    expect(model.tier).toBe("senior");
  });

  it("should floor complex implementation at senior tier", () => {
    const model = router.select({ role: "implementer", complex: true });
    expect(model.tier).toBe("senior");
  });

  it("should avoid the author family when reviewing", () => {
    const model = router.select({
      role: "reviewer",
      riskLevel: "high",
      avoidFamilies: ["qwen"],
    });
    expect(model.tier).toBe("senior");
    expect(model.family).not.toBe("qwen");
  });

  it("should relax diversity rather than fail when every candidate shares a family", () => {
    const model = router.select({
      role: "reviewer",
      riskLevel: "high",
      avoidFamilies: ["qwen", "glm", "moonshot", "openai"],
    });
    expect(model.tier).toBe("senior");
  });

  it("should list models in a tier cheapest first", () => {
    const leaves = router.modelsInTier("leaf");
    expect(leaves.map((m) => m.id)).toEqual([
      "deepseek-v4-flash",
      "qwen3.7-plus",
      "gpt-5.6-luna",
    ]);
  });

  it("should throw when the registry is empty", () => {
    const empty = createTieredModelRouter([]);
    expect(() => empty.select({ role: "implementer" })).toThrow();
  });

  it("should cover every default model in exactly one tier", () => {
    const tiers = new Set(DEFAULT_MODELS.map((m) => m.tier));
    expect(tiers).toEqual(new Set(["principal", "senior", "leaf"]));
    const ids = DEFAULT_MODELS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("expectedTotalCost", () => {
  it("should weight human minutes and sum all cost components", () => {
    const cost = expectedTotalCost({
      subscriptionShadowCost: 2,
      optionalApiCost: 1,
      expectedRetryCost: 0.5,
      expectedReviewCost: 0.25,
      expectedHumanMinutes: 10,
      humanMinuteCost: 0.5,
      regressionPenalty: 1,
    });
    // 2 + 1 + 0.5 + 0.25 + (10 * 0.5) + 1 = 9.75
    expect(cost).toBeCloseTo(9.75);
  });
});
