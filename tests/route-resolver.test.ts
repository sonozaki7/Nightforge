import { describe, expect, it } from "vitest";
import { createAdaptiveRouter } from "../src/router/adaptive-router.js";
import { createTieredModelRouter } from "../src/router/model-tiers.js";
import { createProviderHealth } from "../src/router/provider-health.js";
import type { ModelProviderRegistry } from "../src/router/provider-registry.js";
import { createRouteResolver } from "../src/router/route-resolver.js";
import type { ModelProvider } from "../src/workers/worker.js";

const fallback: ModelProvider = {
  generate: (): Promise<{ content: string; tokensUsed: number; costUsd: number }> =>
    Promise.resolve({ content: "fallback", tokensUsed: 0, costUsd: 0 }),
};

/** Registry that can serve any routed family. */
function openRegistry(): ModelProviderRegistry {
  return {
    resolve: (descriptor): ModelProvider | null => ({
      generate: (): Promise<{ content: string; tokensUsed: number; costUsd: number }> =>
        Promise.resolve({ content: descriptor.id, tokensUsed: 1, costUsd: 0.01 }),
    }),
    availableFamilies: (): string[] => ["qwen", "deepseek", "openai"],
  };
}

describe("createRouteResolver", () => {
  it("should resolve the deterministic cheapest route without learning", async () => {
    const resolver = createRouteResolver({
      tieredRouter: createTieredModelRouter(),
      adaptiveRouter: createAdaptiveRouter(),
      registry: openRegistry(),
      fallback,
    });

    const provider = resolver.resolve({ role: "implementer", riskLevel: "low" });
    // Leaf tier's cheapest model is deepseek-v4-flash.
    const output = await provider.generate("x");
    expect(output.content).toBe("deepseek-v4-flash");
  });

  it("should fall back when the routed family has no key", async () => {
    const resolver = createRouteResolver({
      tieredRouter: createTieredModelRouter(),
      adaptiveRouter: createAdaptiveRouter(),
      registry: { resolve: (): null => null, availableFamilies: (): string[] => [] },
      fallback,
    });

    const provider = resolver.resolve({ role: "implementer", riskLevel: "low" });
    expect((await provider.generate("x")).content).toBe("fallback");
  });

  it("should record outcomes against the same descriptor it resolves", () => {
    const adaptive = createAdaptiveRouter({ minSamples: 2, minSuccessRate: 0.6 });
    const resolver = createRouteResolver({
      tieredRouter: createTieredModelRouter(),
      adaptiveRouter: adaptive,
      registry: openRegistry(),
      fallback,
    });

    const context = { role: "implementer" as const, riskLevel: "low" as const };
    const target = resolver.descriptorFor(context).id;
    resolver.record(context, true);
    resolver.record(context, true);
    resolver.record(context, false);

    expect(adaptive.statsFor(target, "implementer")).toEqual({
      attempts: 3,
      successes: 2,
    });

    // Enough samples with estimate 3/5 = 0.6: learning now drives the pick,
    // and the learned pick matches what recording targets.
    expect(resolver.descriptorFor(context).id).toBe(target);
  });

  it("should canary onto the cheapest alternative when experiments apply", () => {
    const resolver = createRouteResolver({
      tieredRouter: createTieredModelRouter(),
      adaptiveRouter: createAdaptiveRouter(),
      registry: openRegistry(),
      fallback,
      experiments: { trafficRatio: 1, allowedRisks: ["low"] },
    });

    const descriptor = resolver.descriptorFor({
      role: "implementer",
      riskLevel: "low",
      taskKey: "T-1::0",
    });
    expect(descriptor.id).toBe("qwen3.7-plus");

    // Same key buckets identically: resolve and record stay consistent.
    const repeated = resolver.descriptorFor({
      role: "implementer",
      riskLevel: "low",
      taskKey: "T-1::0",
    });
    expect(repeated.id).toBe(descriptor.id);
  });

  it("should keep the baseline without a task key or on critical work", () => {
    const resolver = createRouteResolver({
      tieredRouter: createTieredModelRouter(),
      adaptiveRouter: createAdaptiveRouter(),
      registry: openRegistry(),
      fallback,
      experiments: { trafficRatio: 1, allowedRisks: ["low", "critical"] },
    });

    const noKey = resolver.descriptorFor({ role: "implementer", riskLevel: "low" });
    expect(noKey.id).toBe("deepseek-v4-flash");

    const critical = resolver.descriptorFor({
      role: "reviewer",
      riskLevel: "critical",
      taskKey: "T-2::0",
    });
    expect(critical.tier).toBe("principal");
  });

  it("should avoid unhealthy families and record health outcomes", () => {
    const health = createProviderHealth({ windowMs: 60000, failureThreshold: 2 });
    const resolver = createRouteResolver({
      tieredRouter: createTieredModelRouter(),
      adaptiveRouter: createAdaptiveRouter(),
      registry: openRegistry(),
      fallback,
      health,
    });

    const context = { role: "implementer" as const, riskLevel: "low" as const };
    expect(resolver.descriptorFor(context).family).toBe("deepseek");

    // Two recorded failures mark the deepseek family unhealthy.
    resolver.record(context, false);
    resolver.record(context, false);
    expect(health.isHealthy("deepseek")).toBe(false);
    expect(resolver.descriptorFor(context).family).not.toBe("deepseek");

    // A success on the replacement heals routing back over time;
    // here we verify the avoided pick is still policy-eligible (leaf).
    expect(resolver.descriptorFor(context).tier).toBe("leaf");
  });
});
