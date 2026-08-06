import pino from "pino";
import type { RiskLevel } from "../artifacts/schemas.js";

const logger = pino({ name: "nightforge-model-tiers" });

/**
 * Hierarchical model roles (Guide NIGHTFORGE-V2.1 §13, MODEL-ROUTING-V2.1).
 *
 * Leaf models do most work, senior models handle engineering judgment,
 * principal models are reserved for rare high-stakes decisions.
 */

export type ModelTier = "principal" | "senior" | "leaf";

export interface ModelDescriptor {
  id: string;
  tier: ModelTier;
  /** Model family for diversity rules (author/reviewer separation). */
  family: string;
  /** Normalized shadow cost per run (relative units, lower is cheaper). */
  shadowCostPerRun: number;
}

export type AgentRole =
  | "intake_compiler"
  | "decision_curator"
  | "atomizer"
  | "dag_planner"
  | "architect_candidate"
  | "design_judge"
  | "repository_explorer"
  | "implementer"
  | "test_designer"
  | "failure_triage"
  | "reviewer"
  | "integrator"
  | "release_verifier"
  | "memory_curator"
  | "progress_summarizer"
  | "principal_arbiter";

/** Default registry from the Guide's v2.1 model roster. */
export const DEFAULT_MODELS: readonly ModelDescriptor[] = [
  { id: "gpt-5.6-sol", tier: "principal", family: "openai", shadowCostPerRun: 100 },
  { id: "claude-opus-5", tier: "principal", family: "anthropic", shadowCostPerRun: 110 },
  { id: "gpt-5.6-terra", tier: "senior", family: "openai", shadowCostPerRun: 30 },
  { id: "qwen3.8-max", tier: "senior", family: "qwen", shadowCostPerRun: 20 },
  { id: "glm-5.2", tier: "senior", family: "glm", shadowCostPerRun: 22 },
  { id: "kimi-k3", tier: "senior", family: "moonshot", shadowCostPerRun: 25 },
  { id: "deepseek-v4-flash", tier: "leaf", family: "deepseek", shadowCostPerRun: 4 },
  { id: "gpt-5.6-luna", tier: "leaf", family: "openai", shadowCostPerRun: 6 },
  { id: "qwen3.7-plus", tier: "leaf", family: "qwen", shadowCostPerRun: 5 },
];

/** Base tier per role before escalation. Reviewer is resolved by risk. */
const ROLE_BASE_TIER: Record<AgentRole, ModelTier> = {
  intake_compiler: "senior",
  decision_curator: "leaf",
  atomizer: "senior",
  dag_planner: "senior",
  architect_candidate: "senior",
  design_judge: "senior",
  repository_explorer: "leaf",
  implementer: "leaf",
  test_designer: "leaf",
  failure_triage: "senior",
  reviewer: "leaf",
  integrator: "senior",
  release_verifier: "senior",
  memory_curator: "leaf",
  progress_summarizer: "leaf",
  principal_arbiter: "principal",
};

const TIER_ORDER: Record<ModelTier, number> = { leaf: 0, senior: 1, principal: 2 };

function escalate(tier: ModelTier): ModelTier {
  if (tier === "leaf") return "senior";
  if (tier === "senior") return "principal";
  return "principal";
}

/** Reviewer tier follows blast radius (Guide AGENT-PROMPTS override table). */
export function reviewerTierForRisk(risk: RiskLevel): ModelTier {
  if (risk === "low") return "leaf";
  if (risk === "medium" || risk === "high") return "senior";
  return "principal";
}

export interface ModelSelectionContext {
  role: AgentRole;
  riskLevel?: RiskLevel;
  /** Consecutive failures on this task; >= 2 escalates one tier. */
  failureCount?: number;
  /** Model families to exclude (e.g. the author's family for reviews). */
  avoidFamilies?: string[];
  /** Treat the change as complex → floor at senior tier. */
  complex?: boolean;
  /** Deterministic experiment bucket key (ticket id + attempt). */
  taskKey?: string;
}

export interface TieredModelRouter {
  /** Pick the cheapest eligible model for a role; never returns undefined. */
  select(context: ModelSelectionContext): ModelDescriptor;
  /** Models available at a tier, cheapest first. */
  modelsInTier(tier: ModelTier): ModelDescriptor[];
}

export function createTieredModelRouter(
  models: readonly ModelDescriptor[] = DEFAULT_MODELS
): TieredModelRouter {
  function eligible(context: ModelSelectionContext): ModelDescriptor[] {
    let tier = ROLE_BASE_TIER[context.role];

    if (context.role === "reviewer" && context.riskLevel !== undefined) {
      tier = reviewerTierForRisk(context.riskLevel);
    }
    if (context.complex === true && TIER_ORDER[tier] < TIER_ORDER.senior) {
      tier = "senior";
    }
    if ((context.failureCount ?? 0) >= 2) {
      tier = escalate(tier);
    }

    const avoid = new Set(context.avoidFamilies ?? []);
    const inTier = models.filter((m) => m.tier === tier && !avoid.has(m.family));
    if (inTier.length > 0) return inTier;

    // Family-diversity dead end: relax the family constraint before escalating.
    const relaxed = models.filter((m) => m.tier === tier);
    if (relaxed.length > 0) {
      logger.warn(
        { role: context.role, tier, avoid: [...avoid] },
        "No family-diverse model available; relaxing diversity constraint"
      );
      return relaxed;
    }

    // Empty tier (e.g. principal excluded entirely): fall back to any model.
    return [...models];
  }

  return {
    select(context): ModelDescriptor {
      const candidates = eligible(context).sort(
        (a, b) => a.shadowCostPerRun - b.shadowCostPerRun
      );
      if (candidates.length === 0) {
        // Registry is empty — a configuration error, not a recoverable state.
        throw new Error("Model registry is empty; cannot route any role");
      }
      const chosen = candidates[0];
      logger.debug(
        { role: context.role, model: chosen.id, tier: chosen.tier },
        "Model selected"
      );
      return chosen;
    },

    modelsInTier(tier): ModelDescriptor[] {
      return models
        .filter((m) => m.tier === tier)
        .sort((a, b) => a.shadowCostPerRun - b.shadowCostPerRun);
    },
  };
}

/**
 * Routing score (Guide NIGHTFORGE-MODEL-ROUTING-V2.1):
 * expected_total_cost = subscription_shadow_cost + optional_api_cost
 *   + expected_retry_cost + expected_review_cost
 *   + expected_human_minutes + regression_penalty
 */
export interface RoutingCostInputs {
  subscriptionShadowCost: number;
  optionalApiCost: number;
  expectedRetryCost: number;
  expectedReviewCost: number;
  expectedHumanMinutes: number;
  /** Cost weight of one human minute in the same units as money costs. */
  humanMinuteCost: number;
  regressionPenalty: number;
}

export function expectedTotalCost(inputs: RoutingCostInputs): number {
  return (
    inputs.subscriptionShadowCost +
    inputs.optionalApiCost +
    inputs.expectedRetryCost +
    inputs.expectedReviewCost +
    inputs.expectedHumanMinutes * inputs.humanMinuteCost +
    inputs.regressionPenalty
  );
}
