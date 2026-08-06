/**
 * Provider health tracking (Guide ROADMAP Phase 6).
 *
 * Counts consecutive failures per model family inside a time window.
 * A family above the failure threshold is reported unhealthy so routing
 * can avoid it; any success resets the streak, and old failures decay
 * out of the window automatically. Pure and deterministic for tests.
 */

export interface ProviderHealthConfig {
  /** Failures older than this no longer count against the family. */
  windowMs: number;
  /** Consecutive failures that mark a family unhealthy. */
  failureThreshold: number;
}

export const DEFAULT_PROVIDER_HEALTH_CONFIG: ProviderHealthConfig = {
  windowMs: 15 * 60 * 1000,
  failureThreshold: 3,
};

export interface ProviderHealth {
  recordOutcome(family: string, success: boolean, timestamp?: number): void;
  isHealthy(family: string, now?: number): boolean;
  /** Families currently marked unhealthy (for routing avoidance). */
  unhealthyFamilies(now?: number): string[];
}

interface FamilyState {
  streak: number;
  lastFailureAt: number;
}

export function createProviderHealth(
  config: ProviderHealthConfig = DEFAULT_PROVIDER_HEALTH_CONFIG
): ProviderHealth {
  const states = new Map<string, FamilyState>();

  function effectiveStreak(family: string, now: number): number {
    const state = states.get(family);
    if (state === undefined || state.streak === 0) {
      return 0;
    }
    if (now - state.lastFailureAt >= config.windowMs) {
      // Failures decayed out of the window.
      return 0;
    }
    return state.streak;
  }

  return {
    recordOutcome(family, success, timestamp = Date.now()): void {
      if (success) {
        states.delete(family);
        return;
      }
      const current = states.get(family) ?? { streak: 0, lastFailureAt: timestamp };
      states.set(family, {
        streak: current.streak + 1,
        lastFailureAt: timestamp,
      });
    },

    isHealthy(family, now = Date.now()): boolean {
      return effectiveStreak(family, now) < config.failureThreshold;
    },

    unhealthyFamilies(now = Date.now()): string[] {
      return [...states.keys()].filter(
        (family) => !this.isHealthy(family, now)
      );
    },
  };
}
