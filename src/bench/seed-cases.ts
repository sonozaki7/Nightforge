import type { BenchmarkCase } from "./benchmark.js";

/**
 * Public seed evaluation set (Guide NIGHTFORGE-V2.1 §25.3).
 *
 * Expectations are pinned against DEFAULT_MODELS in model-tiers.ts.
 * When the roster changes, update the affected cases deliberately —
 * a failing case means routing behavior moved.
 */

export const SEED_CASES: readonly BenchmarkCase[] = [
  {
    id: "impl-routine",
    description: "Routine implementation stays on the cheapest leaf model",
    context: { role: "implementer" },
    expected: { tier: "leaf", family: "deepseek", maxShadowCost: 4 },
  },
  {
    id: "impl-escalates-after-failures",
    description: "Two consecutive failures escalate implementer to senior",
    context: { role: "implementer", failureCount: 2 },
    expected: { tier: "senior", family: "qwen", maxShadowCost: 20 },
  },
  {
    id: "impl-complex-floor",
    description: "Complex work floors the implementer at senior tier",
    context: { role: "implementer", complex: true },
    expected: { tier: "senior" },
  },
  {
    id: "review-low-risk-leaf",
    description: "Low-risk review stays leaf and avoids the author family",
    context: { role: "reviewer", riskLevel: "low", avoidFamilies: ["deepseek"] },
    expected: { tier: "leaf", notFamily: "deepseek", family: "qwen" },
  },
  {
    id: "review-high-risk-senior",
    description: "High-risk review lands on senior from a different family",
    context: { role: "reviewer", riskLevel: "high", avoidFamilies: ["qwen"] },
    expected: { tier: "senior", notFamily: "qwen", family: "glm" },
  },
  {
    id: "review-critical-principal",
    description: "Critical blast radius demands a principal reviewer",
    context: { role: "reviewer", riskLevel: "critical", avoidFamilies: ["anthropic"] },
    expected: { tier: "principal", family: "openai" },
  },
  {
    id: "planning-senior",
    description: "Epic atomization uses a senior planner",
    context: { role: "atomizer" },
    expected: { tier: "senior", family: "qwen", maxShadowCost: 20 },
  },
  {
    id: "explorer-leaf",
    description: "Repository exploration is cheap leaf work",
    context: { role: "repository_explorer" },
    expected: { tier: "leaf", maxShadowCost: 4 },
  },
  {
    id: "arbiter-principal",
    description: "Principal arbiter always routes to the principal tier",
    context: { role: "principal_arbiter" },
    expected: { tier: "principal" },
  },
  {
    id: "arbiter-diversity-dead-end",
    description: "Excluding every principal family still yields a principal",
    context: { role: "principal_arbiter", avoidFamilies: ["openai", "anthropic"] },
    expected: { tier: "principal" },
  },
  {
    id: "triage-senior",
    description: "Failure triage needs senior judgment",
    context: { role: "failure_triage" },
    expected: { tier: "senior" },
  },
];
