import type {
  RequirementsContract,
  TaskCapsule,
} from "../artifacts/schemas.js";
import type { ExplorationResult } from "./repository-explorer.js";

/**
 * Task Capsule builder (Guide NIGHTFORGE-V2.1 §9.3).
 *
 * A worker never receives the entire repository or all project memory —
 * only the capsule assembled here: objective, acceptance criteria,
 * exploration findings, path bounds, and validation commands.
 */

export interface CapsuleProjectInfo {
  testCommand: string;
  lintCommand: string;
  typecheckCommand: string;
  buildCommand: string;
  budgetUsd: number;
  prohibitedPaths: string[];
}

export interface CapsuleInput {
  contract: RequirementsContract;
  exploration: ExplorationResult | null;
  project: CapsuleProjectInfo;
  /** Regions from exploration to allow writes in. Empty = whole repo. */
  maxTargetRegions?: number;
}

export function buildTaskCapsule(input: CapsuleInput): TaskCapsule {
  const { contract, exploration, project } = input;
  const maxRegions = input.maxTargetRegions ?? 5;

  const targetRegions =
    exploration === null
      ? []
      : exploration.regions
          .slice(0, maxRegions)
          .map((region) => region.path);

  const interfaceBriefs =
    exploration === null
      ? []
      : exploration.regions
          .slice(0, maxRegions)
          .map((region) => `${region.path} — ${region.reason}`);

  const allowedPaths = targetRegions.length > 0 ? targetRegions : [];

  return {
    task: {
      id: contract.contractId,
      objective: contract.objective,
      acceptanceCriteria: contract.acceptanceCriteria.map((c) => c.description),
      nonGoals: contract.nonGoals,
      risk: contract.riskLevel,
      budgetUsd: project.budgetUsd,
      stopConditions: [
        "three failed repair loops on the same error",
        "budget exhausted",
        "a required change falls outside allowed paths",
      ],
    },
    context: {
      architectureFragment: "",
      targetRegions,
      interfaceBriefs,
      relevantTests: [],
      relevantMemory: [],
      previousAttempts: [],
    },
    execution: {
      allowedPaths,
      prohibitedPaths: project.prohibitedPaths,
      allowedTools: ["shell", "file-read", "file-write", "code-search"],
      validationCommands: [
        project.lintCommand,
        project.typecheckCommand,
        project.testCommand,
        project.buildCommand,
      ],
    },
  };
}
