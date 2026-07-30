import pino from "pino";
import type { Provider } from "./providers/base.js";

const logger = pino({ name: "nightforge-router" });

export interface RoutingContext {
  labels: string[];
  failureCount: number;
  currentHour: number;
  timezone: string;
}

export interface RoutingDecision {
  provider: Provider;
  reason: string;
}

const FRONTIER_LABELS = ["architecture", "security", "billing"];
const URGENT_LABELS = ["urgent"];
const PERMISSIVE_LABELS = ["permissive"];
const UNCENSORED_LABELS = ["uncensored"];
const UNRESTRICTED_LABELS = ["unrestricted"];

const OVERNIGHT_START = 21;
const OVERNIGHT_END = 7;

export interface ModelRouter {
  route(context: RoutingContext): RoutingDecision;
}

export function createModelRouter(providers: {
  qwen: Provider;
  claude: Provider;
  hermes: Provider;
  deepseek: Provider;
  hermes405b: Provider;
}): ModelRouter {
  return {
    route(context: RoutingContext): RoutingDecision {
      const { labels, failureCount, currentHour } = context;

      const lowerLabels = labels.map((l) => l.toLowerCase());

      // Rule 1a: Unrestricted -> Hermes 405B (zero censorship, max capability)
      const hasUnrestrictedLabel = lowerLabels.some((l) =>
        UNRESTRICTED_LABELS.includes(l)
      );
      if (hasUnrestrictedLabel) {
        logger.info(
          { labels },
          "Routing to Hermes 405B (unrestricted label detected)"
        );
        return {
          provider: providers.hermes405b,
          reason: "Unrestricted task (zero censorship, max capability)",
        };
      }

      // Rule 1b: Uncensored -> Hermes 70B (zero censorship, affordable)
      const hasUncensoredLabel = lowerLabels.some((l) =>
        UNCENSORED_LABELS.includes(l)
      );
      if (hasUncensoredLabel) {
        logger.info(
          { labels },
          "Routing to Hermes 70B (uncensored label detected)"
        );
        return {
          provider: providers.hermes,
          reason: "Uncensored task (zero censorship)",
        };
      }

      // Rule 1c: Permissive -> DeepSeek V3.2 (permissive, best code quality per $)
      const hasPermissiveLabel = lowerLabels.some((l) =>
        PERMISSIVE_LABELS.includes(l)
      );
      if (hasPermissiveLabel) {
        logger.info(
          { labels },
          "Routing to DeepSeek (permissive label detected)"
        );
        return {
          provider: providers.deepseek,
          reason: "Permissive task (flexible content policy)",
        };
      }

      // Rule 2: Frontier labels -> Claude
      const hasFrontierLabel = lowerLabels.some((l) =>
        FRONTIER_LABELS.includes(l)
      );
      if (hasFrontierLabel) {
        logger.info(
          { labels },
          "Routing to Claude (frontier label detected)"
        );
        return {
          provider: providers.claude,
          reason: "Frontier label (architecture/security/billing)",
        };
      }

      // Rule 3: Urgent -> Claude for reliability
      const hasUrgentLabel = lowerLabels.some((l) => URGENT_LABELS.includes(l));
      if (hasUrgentLabel) {
        logger.info({ labels }, "Routing to Claude (urgent)");
        return {
          provider: providers.claude,
          reason: "Urgent ticket",
        };
      }

      // Rule 4: Escalation after failures
      if (failureCount >= 2) {
        logger.info(
          { failureCount },
          "Routing to Claude (escalation after failures)"
        );
        return {
          provider: providers.claude,
          reason: `Escalation after ${String(failureCount)} failures`,
        };
      }

      // Rule 5: Overnight -> Qwen (cheapest)
      const isOvernight =
        currentHour >= OVERNIGHT_START || currentHour < OVERNIGHT_END;
      if (isOvernight) {
        logger.info({ currentHour }, "Routing to Qwen (overnight batch)");
        return {
          provider: providers.qwen,
          reason: "Overnight batch (cheapest)",
        };
      }

      // Rule 6: Default -> Qwen (cost optimization)
      logger.info("Routing to Qwen (default)");
      return {
        provider: providers.qwen,
        reason: "Default routing (cost-optimized)",
      };
    },
  };
}
