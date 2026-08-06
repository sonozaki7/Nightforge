import type { ModelProvider } from "../workers/worker.js";
import { cheapestInTier } from "./route-cost.js";
import { decideExperiment, type ExperimentConfig } from "./experiments.js";
import type { ProviderHealth } from "./provider-health.js";
import type { AdaptiveRouter } from "./adaptive-router.js";
import type {
  ModelDescriptor,
  ModelSelectionContext,
  TieredModelRouter,
} from "./model-tiers.js";
import type { ModelProviderRegistry } from "./provider-registry.js";

/**
 * Route resolution + learning seam (Guide ROADMAP Phase 6). Selection and
 * outcome recording must use the same route derivation, otherwise learned
 * statistics describe a model that never ran.
 */

export interface RouteResolver {
  /** Pick the route for a context and resolve it to a live provider. */
  resolve(context: ModelSelectionContext): ModelProvider;
  /** The descriptor the resolver would pick — what learning targets. */
  descriptorFor(context: ModelSelectionContext): ModelDescriptor;
  /** Record whether the chosen route succeeded for this context. */
  record(context: ModelSelectionContext, success: boolean): void;
}

export interface RouteResolverDeps {
  tieredRouter: TieredModelRouter;
  adaptiveRouter: AdaptiveRouter;
  registry: ModelProviderRegistry;
  /** Provider used when the routed family has no configured API key. */
  fallback: ModelProvider;
  /** Optional canary system; off unless configured. */
  experiments?: ExperimentConfig;
  /** Optional provider health tracker; unhealthy families are avoided. */
  health?: ProviderHealth;
}

export function createRouteResolver(deps: RouteResolverDeps): RouteResolver {
  function descriptorFor(context: ModelSelectionContext): ModelDescriptor {
    const unhealthy = deps.health?.unhealthyFamilies() ?? [];
    const avoidFamilies =
      unhealthy.length === 0
        ? context.avoidFamilies
        : [...(context.avoidFamilies ?? []), ...unhealthy];
    const descriptor = deps.tieredRouter.select({ ...context, avoidFamilies });
    const scored = cheapestInTier(
      deps.tieredRouter,
      descriptor,
      context,
      deps.adaptiveRouter
    );
    // Cost scoring ignores family avoidance; fall back to the avoid-aware
    // pick when the scored winner belongs to an unhealthy family.
    const baseline =
      deps.health !== undefined && !deps.health.isHealthy(scored.family)
        ? descriptor
        : scored;
    if (
      deps.experiments === undefined ||
      context.taskKey === undefined ||
      context.riskLevel === undefined
    ) {
      return baseline;
    }
    const candidates = deps.tieredRouter
      .modelsInTier(baseline.tier)
      .filter(
        (candidate) =>
          deps.health === undefined || deps.health.isHealthy(candidate.family)
      );
    return decideExperiment(
      {
        taskKey: context.taskKey,
        riskLevel: context.riskLevel,
        baseline,
        candidates,
      },
      deps.experiments
    ).model;
  }

  return {
    descriptorFor,

    resolve(context): ModelProvider {
      const primary = descriptorFor(context);
      const resolved = deps.registry.resolve(primary);
      if (resolved !== null) {
        return resolved;
      }
      // Routed family has no configured key: stay in the same tier and use
      // the first family that does, so repair attempts run on a real model
      // instead of degrading to the fallback.
      for (const candidate of deps.tieredRouter.modelsInTier(primary.tier)) {
        const alternative = deps.registry.resolve(candidate);
        if (alternative !== null) {
          return alternative;
        }
      }
      return deps.fallback;
    },

    record(context, success): void {
      const descriptor = descriptorFor(context);
      deps.adaptiveRouter.recordOutcome(descriptor.id, context.role, success);
      deps.health?.recordOutcome(descriptor.family, success);
    },
  };
}
