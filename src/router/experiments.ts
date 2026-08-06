import type { RiskLevel } from "../artifacts/schemas.js";
import type { ModelDescriptor } from "./model-tiers.js";

/**
 * Experiment and canary system (Guide ROADMAP Phase 6).
 *
 * Buckets a small share of eligible traffic onto an alternative
 * policy-eligible model so the adaptive router accumulates comparable
 * outcome samples. Hard rules: critical work never experiments,
 * experiments never widen policy eligibility (candidates come from the
 * caller), and the default configuration is fully off — a deterministic
 * fallback configuration must always exist.
 */

export interface ExperimentConfig {
  /** Share of bucketed traffic (0..1) that may receive a canary pick. */
  trafficRatio: number;
  /** Risk levels admitted into experiments (critical is always excluded). */
  allowedRisks: readonly RiskLevel[];
}

export const DEFAULT_EXPERIMENT_CONFIG: ExperimentConfig = {
  trafficRatio: 0,
  allowedRisks: [],
};

export interface ExperimentInput {
  /** Deterministic bucketing key (ticket id + attempt). */
  taskKey: string;
  riskLevel: RiskLevel;
  /** The deterministic policy pick the canary may replace. */
  baseline: ModelDescriptor;
  /** Every model policy allows for this context. */
  candidates: readonly ModelDescriptor[];
}

export interface ExperimentDecision {
  model: ModelDescriptor;
  experimentApplied: boolean;
  reason: string;
}

function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Deterministic traffic bucket in [0, 1) for a task key. */
export function experimentBucket(taskKey: string): number {
  return fnv1a(taskKey) / 0x100000000;
}

export function decideExperiment(
  input: ExperimentInput,
  config: ExperimentConfig = DEFAULT_EXPERIMENT_CONFIG
): ExperimentDecision {
  const keepBaseline = (reason: string): ExperimentDecision => ({
    model: input.baseline,
    experimentApplied: false,
    reason,
  });

  if (input.riskLevel === "critical") {
    return keepBaseline("critical work never experiments");
  }
  if (config.trafficRatio <= 0 || config.allowedRisks.length === 0) {
    return keepBaseline("experiments disabled");
  }
  if (!config.allowedRisks.includes(input.riskLevel)) {
    return keepBaseline("risk level not eligible for experiments");
  }
  if (experimentBucket(input.taskKey) >= config.trafficRatio) {
    return keepBaseline("outside experiment traffic share");
  }

  const alternatives = input.candidates
    .filter((candidate) => candidate.id !== input.baseline.id)
    .sort((a, b) => a.shadowCostPerRun - b.shadowCostPerRun);
  if (alternatives.length === 0) {
    return keepBaseline("no alternative model within policy");
  }

  const chosen = alternatives[0];
  return {
    model: chosen,
    experimentApplied: true,
    reason: `canary pick ${chosen.id}`,
  };
}
