import { describe, expect, it } from "vitest";
import {
  decideExperiment,
  experimentBucket,
  DEFAULT_EXPERIMENT_CONFIG,
  type ExperimentConfig,
  type ExperimentInput,
} from "../src/router/experiments.js";
import type { ModelDescriptor } from "../src/router/model-tiers.js";

const baseline: ModelDescriptor = {
  id: "deepseek-v4-flash",
  tier: "leaf",
  family: "deepseek",
  shadowCostPerRun: 4,
};
const alternative: ModelDescriptor = {
  id: "qwen3.7-plus",
  tier: "leaf",
  family: "qwen",
  shadowCostPerRun: 5,
};
const pricier: ModelDescriptor = {
  id: "gpt-5.6-luna",
  tier: "leaf",
  family: "openai",
  shadowCostPerRun: 6,
};

function buildInput(overrides: Partial<ExperimentInput> = {}): ExperimentInput {
  return {
    taskKey: "T-1::0",
    riskLevel: "low",
    baseline,
    candidates: [baseline, alternative, pricier],
    ...overrides,
  };
}

const fullTraffic: ExperimentConfig = {
  trafficRatio: 1,
  allowedRisks: ["low", "medium", "high"],
};

describe("decideExperiment", () => {
  it("stays on the baseline when experiments are disabled", () => {
    const decision = decideExperiment(buildInput(), DEFAULT_EXPERIMENT_CONFIG);
    expect(decision.experimentApplied).toBe(false);
    expect(decision.model.id).toBe(baseline.id);
    expect(decision.reason).toBe("experiments disabled");
  });

  it("never experiments on critical work", () => {
    const decision = decideExperiment(buildInput({ riskLevel: "critical" }), fullTraffic);
    expect(decision.experimentApplied).toBe(false);
    expect(decision.reason).toBe("critical work never experiments");
  });

  it("respects the allowed risk levels", () => {
    const decision = decideExperiment(buildInput({ riskLevel: "high" }), {
      trafficRatio: 1,
      allowedRisks: ["low"],
    });
    expect(decision.experimentApplied).toBe(false);
    expect(decision.reason).toBe("risk level not eligible for experiments");
  });

  it("picks the cheapest alternative within policy when bucketed in", () => {
    const decision = decideExperiment(buildInput(), fullTraffic);
    expect(decision.experimentApplied).toBe(true);
    expect(decision.model.id).toBe(alternative.id);
    expect(decision.reason).toBe("canary pick qwen3.7-plus");
  });

  it("keeps the baseline when no alternative exists", () => {
    const decision = decideExperiment(
      buildInput({ candidates: [baseline] }),
      fullTraffic
    );
    expect(decision.experimentApplied).toBe(false);
    expect(decision.reason).toBe("no alternative model within policy");
  });

  it("keeps the baseline outside the traffic share", () => {
    const decision = decideExperiment(buildInput(), {
      trafficRatio: 0.000001,
      allowedRisks: ["low"],
    });
    expect(decision.experimentApplied).toBe(false);
    expect(decision.reason).toBe("outside experiment traffic share");
  });
});

describe("experimentBucket", () => {
  it("is deterministic for the same key", () => {
    expect(experimentBucket("T-1::0")).toBe(experimentBucket("T-1::0"));
  });

  it("stays inside [0, 1)", () => {
    for (let index = 0; index < 200; index += 1) {
      const bucket = experimentBucket(`T-${String(index)}::0`);
      expect(bucket).toBeGreaterThanOrEqual(0);
      expect(bucket).toBeLessThan(1);
    }
  });

  it("spreads keys across the traffic range", () => {
    let below = 0;
    const total = 400;
    for (let index = 0; index < total; index += 1) {
      if (experimentBucket(`spread-${String(index)}`) < 0.5) {
        below += 1;
      }
    }
    // Loose uniformity guard: neither tail should be empty.
    expect(below).toBeGreaterThan(total * 0.2);
    expect(below).toBeLessThan(total * 0.8);
  });
});
