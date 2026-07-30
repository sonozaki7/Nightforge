/**
 * Execution effort levels for Nightforge.
 * Inspired by OpenAI Codex reasoning effort scale (high → xhigh → max).
 *
 * Effort is mode-aware:
 * - ticket:     Big tasks. Parallel sub-agents, swarm-style, fast + correct.
 * - automation: Routine work. Correct + safe, parallelizable at higher efforts.
 *
 * Primary model: Qwen 3.8 (cheap, fast). Budgets are safety rails.
 */

import type { TicketMode } from "../tools/types.js";

export type EffortLevel = "high" | "xhigh" | "max";

export interface EffortConfig {
  level: EffortLevel;
  mode: TicketMode;
  /** Maximum agentic loop iterations */
  maxIterations: number;
  /** Maximum sub-agents spawned for decomposition */
  maxSubAgents: number;
  /** Token budget cap in USD (safety rail, not expected cost) */
  tokenBudgetUsd: number;
  /** How many times to verify each action result */
  verificationPasses: number;
  /** Whether to gather extensive context before acting */
  gatherContextFirst: boolean;
  /** Context compaction threshold (messages before summarizing) */
  compactionThreshold: number;
  /** System prompt modifier appended to base orchestrator prompt */
  promptModifier: string;
}

// ---------------------------------------------------------------------------
// AUTOMATION effort: routine work, correct + safe, parallelizable at higher efforts
// ---------------------------------------------------------------------------

const AUTOMATION_EFFORT: Record<EffortLevel, EffortConfig> = {
  high: {
    level: "high",
    mode: "automation",
    maxIterations: 20,
    maxSubAgents: 0,
    tokenBudgetUsd: 0.15,
    verificationPasses: 1,
    gatherContextFirst: false,
    compactionThreshold: 30,
    promptModifier: `EFFORT: HIGH | MODE: AUTOMATION (routine execution)
- Execute the routine directly. No exploration needed.
- Verify the action completed successfully (one check).
- If a step fails, retry once, then report failure.
- Keep it fast. This is a known procedure.`,
  },

  xhigh: {
    level: "xhigh",
    mode: "automation",
    maxIterations: 35,
    maxSubAgents: 2,
    tokenBudgetUsd: 0.30,
    verificationPasses: 2,
    gatherContextFirst: true,
    compactionThreshold: 40,
    promptModifier: `EFFORT: XHIGH | MODE: AUTOMATION (careful + parallel routine)
- Before executing, check current state (system healthy? prerequisites met?).
- If the routine has INDEPENDENT steps, run them in PARALLEL via sub-agents for speed.
- After each action, verify: (1) it succeeded, (2) no unexpected side effects.
- If something looks off, stop and report rather than continuing blindly.
- After completion, confirm the end state matches expectations.`,
  },

  max: {
    level: "max",
    mode: "automation",
    maxIterations: 50,
    maxSubAgents: 3,
    tokenBudgetUsd: 0.60,
    verificationPasses: 3,
    gatherContextFirst: true,
    compactionThreshold: 50,
    promptModifier: `EFFORT: MAX | MODE: AUTOMATION (full audit + parallel execution)
- PRE-CHECK: Verify system state, prerequisites, and dependencies before starting.
- Decompose the routine into independent chunks. Run them in PARALLEL for speed.
- TRIPLE VERIFY each step: (1) success confirmed, (2) no side effects, (3) related systems unaffected.
- POST-CHECK: After completion, verify nothing else broke. Check related services/endpoints.
- If any verification fails, ROLL BACK if possible, then report.
- Produce a full execution log as the summary.`,
  },
};

// ---------------------------------------------------------------------------
// TICKET effort: big tasks, parallel swarm work, fast + zero regressions
// ---------------------------------------------------------------------------

const TICKET_EFFORT: Record<EffortLevel, EffortConfig> = {
  high: {
    level: "high",
    mode: "ticket",
    maxIterations: 40,
    maxSubAgents: 2,
    tokenBudgetUsd: 0.25,
    verificationPasses: 1,
    gatherContextFirst: false,
    compactionThreshold: 40,
    promptModifier: `EFFORT: HIGH | MODE: TICKET (solve fast, don't break stuff)
- Read the ticket. Identify independent parts that can run in PARALLEL.
- Spawn sub-agents for independent work streams. Coordinate results.
- After changes, verify the fix works and nothing regressed.
- Prefer the simplest correct solution. Speed matters.
- If stuck after 3 attempts on the same step, stop and report.`,
  },

  xhigh: {
    level: "xhigh",
    mode: "ticket",
    maxIterations: 70,
    maxSubAgents: 4,
    tokenBudgetUsd: 0.50,
    verificationPasses: 2,
    gatherContextFirst: true,
    compactionThreshold: 60,
    promptModifier: `EFFORT: XHIGH | MODE: TICKET (swarm execution, thorough verification)
- GATHER CONTEXT first: read related code, understand the system.
- DECOMPOSE into independent sub-tasks. Run them CONCURRENTLY via sub-agents.
- For dependent steps, sequence them. For independent steps, PARALLELIZE aggressively.
- After changes, verify: (1) the fix works, (2) existing tests pass, (3) nothing regressed.
- Explore alternative approaches if the first attempt fails.
- After all sub-agents finish, do a final integration review.
- If stuck after 5 attempts, stop and report.`,
  },

  max: {
    level: "max",
    mode: "ticket",
    maxIterations: 120,
    maxSubAgents: 8,
    tokenBudgetUsd: 1.00,
    verificationPasses: 3,
    gatherContextFirst: true,
    compactionThreshold: 80,
    promptModifier: `EFFORT: MAX | MODE: TICKET (full swarm, zero regressions, maximum speed)
- PLAN FIRST: Analyze the problem. Identify ALL independent work streams.
- SWARM: Decompose aggressively. Spawn sub-agents for every independent chunk.
  Maximize parallelism. The goal is fastest correct completion.
- RESEARCH in parallel: multiple sub-agents can read different parts of the system simultaneously.
- IMPLEMENT in parallel: independent code changes run concurrently.
- TRIPLE VERIFY: (1) solves the problem, (2) no side effects, (3) related functionality intact.
- REGRESSION CHECK: After all changes, verify nothing broke. Run tests, check endpoints.
- EXPLORE ALTERNATIVES: If any step fails, try at least 2 different approaches.
- DOCUMENT: Summarize what was done, why, and what was verified.
- If stuck after 7 attempts with different approaches, stop and report.`,
  },
};

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/** Resolve effort level from ticket labels */
export function resolveEffortLevel(labels: string[]): EffortLevel {
  const lower = labels.map((l) => l.toLowerCase());
  if (lower.includes("max") || lower.includes("max-effort")) return "max";
  if (lower.includes("xhigh") || lower.includes("extra-high")) return "xhigh";
  return "high";
}

/** Get the full config for a mode + effort combination */
export function getEffortConfig(mode: TicketMode, level: EffortLevel): EffortConfig {
  if (mode === "automation") return AUTOMATION_EFFORT[level];
  return TICKET_EFFORT[level];
}

/** All effort configs for a given mode (useful for dashboards) */
export function getEffortTable(mode: TicketMode): Record<EffortLevel, EffortConfig> {
  return mode === "automation" ? AUTOMATION_EFFORT : TICKET_EFFORT;
}
