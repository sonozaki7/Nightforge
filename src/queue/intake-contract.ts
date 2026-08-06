import { randomUUID } from "node:crypto";
import type { IntakeBrief, RequirementsContract } from "../artifacts/schemas.js";
import type { ProjectConfig } from "../projects/registry.js";

/**
 * Compile the intake brief into a requirements contract (Guide §10.3
 * stage 3): every acceptance criterion maps to a deterministic command
 * that can prove it.
 */
export function buildContract(
  brief: IntakeBrief,
  config: ProjectConfig,
  now: Date
): RequirementsContract {
  const d = config.deployment;
  const criteria = [
    { id: "ac-lint", description: `lint passes (${d.lintCommand})`, verificationCommand: d.lintCommand },
    { id: "ac-types", description: `typecheck passes (${d.typecheckCommand})`, verificationCommand: d.typecheckCommand },
    { id: "ac-tests", description: `tests pass (${d.testCommand})`, verificationCommand: d.testCommand },
    { id: "ac-build", description: `build passes (${d.buildCommand})`, verificationCommand: d.buildCommand },
  ];
  return {
    contractId: `contract-${randomUUID()}`,
    briefId: brief.briefId,
    objective: brief.goal,
    acceptanceCriteria: criteria.map((c) => ({ ...c, verified: false })),
    nonGoals: ["no changes outside the ticket scope"],
    riskLevel: brief.riskLevel,
    createdAt: now.toISOString(),
  };
}
