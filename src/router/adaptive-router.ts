import pino from "pino";
import type { RiskLevel } from "../artifacts/schemas.js";
import type { AgentRole, ModelDescriptor } from "./model-tiers.js";

const logger = pino({ name: "nightforge-adaptive-router" });

/**
 * Adaptive model routing (Guide ROADMAP Phase 6).
 *
 * Learns per-role outcome statistics and prefers the cheapest model whose
 * conservative success estimate clears the capability floor. Hard rules:
 * no adaptation before enough samples, never on critical work, never
 * overriding policy eligibility (it only ranks caller-provided candidates),
 * and a deterministic fallback when nothing qualifies.
 */

export interface OutcomeStats {
  attempts: number;
  successes: number;
}

export interface AdaptiveRoutingConfig {
  /** Minimum samples before a learned estimate is trusted. */
  minSamples: number;
  /** Conservative success floor for a model to count as capable. */
  minSuccessRate: number;
}

export const DEFAULT_ADAPTIVE_CONFIG: AdaptiveRoutingConfig = {
  minSamples: 10,
  minSuccessRate: 0.7,
};

export interface AdaptiveSelectionContext {
  riskLevel?: RiskLevel;
}

export interface AdaptiveRouter {
  recordOutcome(modelId: string, role: AgentRole, success: boolean): void;
  statsFor(modelId: string, role: AgentRole): OutcomeStats;
  /** Laplace-smoothed success estimate; conservative with few samples. */
  successEstimate(modelId: string, role: AgentRole): number;
  /**
   * Cheapest candidate whose learned success estimate clears the floor.
   * Returns null when adaptation must not apply (critical risk, missing
   * samples, or no capable model) — the caller keeps its deterministic pick.
   */
  selectCapable(
    candidates: readonly ModelDescriptor[],
    role: AgentRole,
    context?: AdaptiveSelectionContext
  ): ModelDescriptor | null;
}

function statsKey(modelId: string, role: AgentRole): string {
  return `${modelId}::${role}`;
}

export function createAdaptiveRouter(
  config: AdaptiveRoutingConfig = DEFAULT_ADAPTIVE_CONFIG
): AdaptiveRouter {
  const stats = new Map<string, OutcomeStats>();

  function statsFor(modelId: string, role: AgentRole): OutcomeStats {
    return stats.get(statsKey(modelId, role)) ?? { attempts: 0, successes: 0 };
  }

  return {
    recordOutcome(modelId, role, success): void {
      const key = statsKey(modelId, role);
      const current = stats.get(key) ?? { attempts: 0, successes: 0 };
      stats.set(key, {
        attempts: current.attempts + 1,
        successes: current.successes + (success ? 1 : 0),
      });
    },

    statsFor,

    successEstimate(modelId, role): number {
      // Laplace smoothing keeps small-sample estimates conservative.
      const s = statsFor(modelId, role);
      return (s.successes + 1) / (s.attempts + 2);
    },

    selectCapable(candidates, role, context = {}): ModelDescriptor | null {
      if (context.riskLevel === "critical") {
        // Never explore models on critical production work.
        return null;
      }

      const learned = candidates.filter(
        (m) => statsFor(m.id, role).attempts >= config.minSamples
      );
      if (learned.length === 0) {
        logger.debug(
          { role, minSamples: config.minSamples },
          "Not enough samples; keeping deterministic route"
        );
        return null;
      }

      const capable = learned
        .filter((m) => this.successEstimate(m.id, role) >= config.minSuccessRate)
        .sort((a, b) => a.shadowCostPerRun - b.shadowCostPerRun);

      if (capable.length === 0) {
        logger.debug(
          { role, minSuccessRate: config.minSuccessRate },
          "No learned model clears the capability floor"
        );
        return null;
      }
      const chosen = capable[0];
      logger.debug(
        { role, model: chosen.id, estimate: this.successEstimate(chosen.id, role) },
        "Adaptive route selected"
      );
      return chosen;
    },
  };
}
