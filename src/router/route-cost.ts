import pino from "pino";
import {
  expectedTotalCost,
  type ModelDescriptor,
  type ModelSelectionContext,
  type TieredModelRouter,
} from "./model-tiers.js";
import type { AdaptiveRouter } from "./adaptive-router.js";

const logger = pino({ name: "nightforge-route-cost" });

/**
 * Route scoring (Guide NIGHTFORGE-MODEL-ROUTING-V2.1): every candidate
 * model is scored with the expected total cost formula so routing stays a
 * money-and-time decision, not a capability guess.
 */

export interface RouteEstimates {
  /** Probability the task needs at least one retry (0-1). */
  retryProbability: number;
  /** Probability a review run is consumed (0-1). */
  reviewProbability: number;
  /** Human minutes spent when the route requires approval. */
  humanMinutesWhenReviewed: number;
  /** Cost weight of one human minute, in the same units as shadow cost. */
  humanMinuteCost: number;
  /** Extra penalty for regression-prone routes. */
  regressionPenalty: number;
}

export const DEFAULT_ESTIMATES: RouteEstimates = {
  retryProbability: 0.2,
  reviewProbability: 0,
  humanMinutesWhenReviewed: 2,
  humanMinuteCost: 5,
  regressionPenalty: 0,
};

/** Estimates that follow the ticket's risk level. */
export function estimatesForContext(
  context: ModelSelectionContext,
  base: RouteEstimates = DEFAULT_ESTIMATES
): RouteEstimates {
  const failureBoost = Math.min(context.failureCount ?? 0, 2) * 0.15;
  const needsApproval =
    context.riskLevel === "high" || context.riskLevel === "critical";
  return {
    ...base,
    retryProbability: Math.min(base.retryProbability + failureBoost, 1),
    reviewProbability: needsApproval ? 1 : base.reviewProbability,
  };
}

export function scoreRoute(
  descriptor: ModelDescriptor,
  estimates: RouteEstimates
): number {
  return expectedTotalCost({
    subscriptionShadowCost: descriptor.shadowCostPerRun,
    optionalApiCost: 0,
    expectedRetryCost: estimates.retryProbability * descriptor.shadowCostPerRun,
    expectedReviewCost: estimates.reviewProbability * descriptor.shadowCostPerRun,
    expectedHumanMinutes:
      estimates.reviewProbability > 0 ? estimates.humanMinutesWhenReviewed : 0,
    humanMinuteCost: estimates.humanMinuteCost,
    regressionPenalty: estimates.regressionPenalty,
  });
}

/** Cheapest expected-total-cost first. */
export function rankRoutes(
  candidates: readonly ModelDescriptor[],
  estimates: RouteEstimates
): ModelDescriptor[] {
  return [...candidates].sort(
    (a, b) => scoreRoute(a, estimates) - scoreRoute(b, estimates)
  );
}

/**
 * Pick the cheapest-expected-cost model in the descriptor's tier, scoring
 * every candidate with the Guide's cost formula instead of raw shadow cost.
 * When an adaptive router has enough learned samples, its cheapest capable
 * model wins; otherwise the deterministic cost score decides.
 */
export function cheapestInTier(
  router: Pick<TieredModelRouter, "modelsInTier">,
  descriptor: ModelDescriptor,
  context: ModelSelectionContext,
  adaptive?: AdaptiveRouter
): ModelDescriptor {
  const candidates = router.modelsInTier(descriptor.tier);
  if (adaptive !== undefined) {
    const learned = adaptive.selectCapable(candidates, context.role, {
      riskLevel: context.riskLevel,
    });
    if (learned !== null) return learned;
  }

  const estimates = estimatesForContext(context);
  const ranked = rankRoutes(candidates, estimates);
  const chosen = ranked.length > 0 ? ranked[0] : descriptor;
  logger.debug(
    { model: chosen.id, expectedCost: scoreRoute(chosen, estimates) },
    "Route scored by expected total cost"
  );
  return chosen;
}
