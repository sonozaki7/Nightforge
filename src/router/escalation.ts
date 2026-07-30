import pino from "pino";
import type { Provider } from "./providers/base.js";

const logger = pino({ name: "nightforge-escalation" });

export interface EscalationTier {
  name: string;
  provider: Provider;
}

export interface EscalationManager {
  getProviderForAttempt(
    attempt: number,
    baseProvider: Provider
  ): Provider;
  getEscalationPath(baseProviderName: string): string[];
  shouldEscalate(attempt: number, maxAttemptsPerTier: number): boolean;
}

const ESCALATION_LADDER = ["qwen", "claude"];

export function createEscalationManager(providers: {
  qwen: Provider;
  claude: Provider;
}): EscalationManager {
  const providerMap = new Map<string, Provider>([
    ["qwen", providers.qwen],
    ["claude", providers.claude],
  ]);

  return {
    getProviderForAttempt(
      attempt: number,
      baseProvider: Provider
    ): Provider {
      const maxAttemptsPerTier = 2;
      const tierIndex = Math.min(
        Math.floor((attempt - 1) / maxAttemptsPerTier),
        ESCALATION_LADDER.length - 1
      );

      const baseIndex = ESCALATION_LADDER.indexOf(baseProvider.name);
      const effectiveIndex = Math.min(
        baseIndex + tierIndex,
        ESCALATION_LADDER.length - 1
      );

      const tierName = ESCALATION_LADDER[effectiveIndex];
      const provider = tierName ? providerMap.get(tierName) : undefined;

      if (!provider) {
        logger.warn(
          { tierName },
          "Unknown tier, falling back to base provider"
        );
        return baseProvider;
      }

      if (provider.name !== baseProvider.name) {
        logger.info(
          {
            from: baseProvider.name,
            to: provider.name,
            attempt,
          },
          "Escalating to stronger model"
        );
      }

      return provider;
    },

    getEscalationPath(baseProviderName: string): string[] {
      const baseIndex = ESCALATION_LADDER.indexOf(baseProviderName);
      if (baseIndex === -1) {
        return ESCALATION_LADDER;
      }
      return ESCALATION_LADDER.slice(baseIndex);
    },

    shouldEscalate(attempt: number, maxAttemptsPerTier: number): boolean {
      return attempt > 1 && (attempt - 1) % maxAttemptsPerTier === 0;
    },
  };
}
