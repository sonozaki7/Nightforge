import pino from "pino";
import type { TicketJob } from "./scheduler.js";
import type { RiskLevel } from "../artifacts/schemas.js";

const logger = pino({ name: "nightforge-execution-mode" });

export type ExecutionMode = "agentic" | "plain";

export interface ExecutionModeConfig {
  /**
   * When true, tickets are routed by a complexity heuristic — no label or
   * human decision needed. The `agentic` label still forces it on, and
   * `plain` forces it off.
   */
  autoRoute: boolean;
  /** Minimum complexity score for the agentic path (default 3). */
  agenticThreshold: number;
}

export const DEFAULT_EXECUTION_MODE_CONFIG: ExecutionModeConfig = {
  autoRoute: true,
  agenticThreshold: 3,
};

/** Keywords that signal a task needs iterative tool use to complete. */
const COMPLEXITY_KEYWORDS = [
  "migration",
  "refactor",
  "architecture",
  "multi-file",
  "multiple files",
  "across the codebase",
  "end-to-end",
  "integration",
  "breaking change",
  "api change",
  "database schema",
  "auth",
  "authentication",
  "security",
  "billing",
  "concurrency",
  "performance",
  "regression",
  "test suite",
  "new feature spanning",
  "legacy",
];

const HIGH_RISK_LABELS = new Set([
  "security",
  "billing",
  "auth",
  "authentication",
  "architecture",
  "migration",
  "critical",
]);

/**
 * Deterministic complexity score for a ticket. Higher = more likely to need
 * the agentic (tool-use) worker. Signals: size, explicit acceptance
 * criteria, open questions, risk keywords, and risk labels.
 */
export function complexityScore(job: TicketJob): number {
  const text = `${job.title}\n${job.description}`.toLowerCase();
  let score = 0;

  // Size: longer descriptions usually mean more work.
  if (job.description.length > 400) score += 1;
  if (job.description.length > 1200) score += 1;

  // Explicit acceptance criteria make the task verifiable and multi-step.
  const criteriaMarkers = (job.description.match(/acceptance|criteria|given |when |then /gi) ?? []).length;
  if (criteriaMarkers >= 2) score += 1;

  // Open questions mean unknowns the agent must resolve by exploring.
  const questions = (job.description.match(/\?/g) ?? []).length;
  if (questions >= 2) score += 1;

  // Semantic signals.
  const keywordHits = COMPLEXITY_KEYWORDS.filter((k) => text.includes(k)).length;
  if (keywordHits >= 2) score += 1;
  if (keywordHits >= 4) score += 1;

  // Risk labels route straight to the more careful path.
  const lower = job.labels.map((l) => l.toLowerCase());
  if (lower.some((l) => HIGH_RISK_LABELS.has(l))) score += 2;

  return score;
}

/**
 * Decide how a ticket executes. Autonomous by default — no human label
 * required. Explicit labels override the heuristic:
 *   "agentic" forces the agentic path, "plain" forces the plain path.
 */
export function resolveExecutionMode(
  job: TicketJob,
  config: ExecutionModeConfig = DEFAULT_EXECUTION_MODE_CONFIG
): ExecutionMode {
  const lower = job.labels.map((l) => l.toLowerCase());

  if (lower.includes("agentic")) {
    logger.info({ ticketId: job.ticketId }, "Label 'agentic' forces tool-use path");
    return "agentic";
  }
  if (lower.includes("plain")) {
    logger.info({ ticketId: job.ticketId }, "Label 'plain' forces simple path");
    return "plain";
  }

  if (!config.autoRoute) {
    return "plain";
  }

  const score = complexityScore(job);
  const mode: ExecutionMode = score >= config.agenticThreshold ? "agentic" : "plain";
  logger.info(
    { ticketId: job.ticketId, score, threshold: config.agenticThreshold, mode },
    "Autonomous execution-mode decision"
  );
  return mode;
}

/** Adapter from labels to the risk classifier used elsewhere in the flow. */
export function classicRiskFromLabels(labels: string[]): RiskLevel {
  const lower = labels.map((l) => l.toLowerCase());
  if (lower.includes("critical")) return "critical";
  if (lower.some((l) => HIGH_RISK_LABELS.has(l))) return "high";
  if (lower.includes("medium")) return "medium";
  return "low";
}