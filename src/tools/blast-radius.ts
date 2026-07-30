import pino from "pino";
import type { PermissionTier } from "./types.js";

const logger = pino({ name: "nightforge-blast-radius" });

/**
 * Blast radius classification determines autonomy level per-ACTION (not per-ticket).
 * - zero: Fully autonomous. Reversible, no external impact. Auto-execute.
 * - low: Auto-execute + notify after. Minor external impact, easily undone.
 * - high: Requires Telegram approval (one tap). Significant or hard-to-reverse.
 * - irreversible: Forbidden or multi-confirm. Cannot be undone.
 */
export type BlastRadius = "zero" | "low" | "high" | "irreversible";

export interface BlastRadiusRule {
  /** Pattern: "service:action" or "service:*" for all actions on a service */
  pattern: string;
  radius: BlastRadius;
  /** Human-readable reason for this classification */
  reason: string;
}

export interface BlastRadiusClassifier {
  /** Classify an action by service + action name */
  classify(service: string, action: string): BlastRadius;
  /** Map blast radius to the existing permission tier system */
  toPermissionTier(radius: BlastRadius): PermissionTier;
  /** Whether this action can proceed without human input */
  isAutonomous(radius: BlastRadius): boolean;
}

/**
 * Default classification rules.
 * Ordered: first match wins. More specific patterns first.
 */
const DEFAULT_RULES: BlastRadiusRule[] = [
  // IRREVERSIBLE — never auto-execute
  { pattern: "stripe:refund", radius: "irreversible", reason: "Money leaves the account permanently" },
  { pattern: "stripe:delete_customer", radius: "irreversible", reason: "Customer data destroyed" },
  { pattern: "database:drop", radius: "irreversible", reason: "Data destruction" },
  { pattern: "database:delete_production", radius: "irreversible", reason: "Production data loss" },
  { pattern: "email:send_bulk", radius: "irreversible", reason: "Cannot unsend emails to customers" },
  { pattern: "dns:delete_zone", radius: "irreversible", reason: "Entire domain goes offline" },

  // HIGH — one-tap Telegram approval
  { pattern: "stripe:charge", radius: "high", reason: "Financial transaction" },
  { pattern: "stripe:create_payment", radius: "high", reason: "Financial transaction" },
  { pattern: "cloudflare:update_dns", radius: "high", reason: "Affects live traffic routing" },
  { pattern: "cloudflare:purge_cache", radius: "high", reason: "Affects all users temporarily" },
  { pattern: "email:send", radius: "high", reason: "External communication, cannot unsend" },
  { pattern: "deploy:production", radius: "high", reason: "Affects all live users" },
  { pattern: "auth:modify", radius: "high", reason: "Security-critical change" },
  { pattern: "billing:*", radius: "high", reason: "Financial impact" },

  // LOW — auto + notify after
  { pattern: "deploy:staging", radius: "low", reason: "Staging only, no user impact" },
  { pattern: "cloudflare:list_*", radius: "low", reason: "Read-only with minor state" },
  { pattern: "github:create_branch", radius: "low", reason: "Easily deleted" },
  { pattern: "github:create_issue", radius: "low", reason: "Can be closed" },
  { pattern: "crawl:*", radius: "low", reason: "External read, no mutation" },
  { pattern: "search:*", radius: "low", reason: "Read-only operation" },

  // ZERO — fully autonomous, no notification needed
  { pattern: "git:*", radius: "zero", reason: "Local, fully reversible" },
  { pattern: "file:*", radius: "zero", reason: "Local filesystem, reversible via git" },
  { pattern: "test:*", radius: "zero", reason: "No side effects" },
  { pattern: "lint:*", radius: "zero", reason: "No side effects" },
  { pattern: "build:*", radius: "zero", reason: "No side effects" },
  { pattern: "read:*", radius: "zero", reason: "Read-only" },
  { pattern: "github:read", radius: "zero", reason: "Read-only" },
  { pattern: "stripe:list", radius: "zero", reason: "Read-only" },
  { pattern: "cloudflare:read", radius: "zero", reason: "Read-only" },
];

export function createBlastRadiusClassifier(
  customRules?: BlastRadiusRule[]
): BlastRadiusClassifier {
  const rules = [...(customRules ?? []), ...DEFAULT_RULES];

  function matchPattern(pattern: string, service: string, action: string): boolean {
    const [patternService, patternAction] = pattern.split(":");
    if (!patternService || !patternAction) return false;

    const serviceMatch =
      patternService === "*" || patternService === service;
    const actionMatch =
      patternAction === "*" ||
      patternAction === action ||
      (patternAction.endsWith("*") &&
        action.startsWith(patternAction.slice(0, -1)));

    return serviceMatch && actionMatch;
  }

  return {
    classify(service: string, action: string): BlastRadius {
      for (const rule of rules) {
        if (matchPattern(rule.pattern, service, action)) {
          logger.debug(
            { service, action, radius: rule.radius, reason: rule.reason },
            "Blast radius classified"
          );
          return rule.radius;
        }
      }

      // Default: unknown actions are "high" (conservative for safety)
      logger.info(
        { service, action },
        "Unknown action, defaulting to high blast radius"
      );
      return "high";
    },

    toPermissionTier(radius: BlastRadius): PermissionTier {
      switch (radius) {
        case "zero":
        case "low":
          return "auto";
        case "high":
          return "approve";
        case "irreversible":
          return "forbidden";
      }
    },

    isAutonomous(radius: BlastRadius): boolean {
      return radius === "zero" || radius === "low";
    },
  };
}

/** Convenience: get the default rules for inspection/dashboard display */
export function getDefaultRules(): readonly BlastRadiusRule[] {
  return DEFAULT_RULES;
}
