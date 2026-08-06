import { describe, expect, it } from "vitest";
import { buildTaskCapsule } from "../src/context/capsule-builder.js";
import type { RequirementsContract } from "../src/artifacts/schemas.js";
import type { ExplorationResult } from "../src/context/repository-explorer.js";

const contract: RequirementsContract = {
  contractId: "c-9",
  briefId: "b-9",
  objective: "Add webhook retry",
  acceptanceCriteria: [
    { id: "ac-1", description: "retries three times", verified: false },
    { id: "ac-2", description: "logs attempts", verified: false },
  ],
  nonGoals: ["no schema changes"],
  riskLevel: "low",
  createdAt: "2026-08-04T20:00:00.000Z",
};

const project = {
  testCommand: "npm test",
  lintCommand: "npm run lint",
  typecheckCommand: "npx tsc --noEmit",
  buildCommand: "npm run build",
  budgetUsd: 5,
  prohibitedPaths: ["src/config.ts"],
};

const exploration: ExplorationResult = {
  regions: [
    { path: "src/integrations", score: 30, reason: "content matches: webhook" },
    { path: "src/queue", score: 12, reason: "path matches query terms" },
  ],
  filesRead: 4,
  linesRead: 220,
  budgetExhausted: false,
};

describe("buildTaskCapsule", () => {
  it("should carry contract data into the capsule", () => {
    const capsule = buildTaskCapsule({ contract, exploration, project });
    expect(capsule.task.objective).toBe("Add webhook retry");
    expect(capsule.task.acceptanceCriteria).toEqual([
      "retries three times",
      "logs attempts",
    ]);
    expect(capsule.task.nonGoals).toEqual(["no schema changes"]);
    expect(capsule.task.risk).toBe("low");
    expect(capsule.task.budgetUsd).toBe(5);
  });

  it("should bound writes to explored regions", () => {
    const capsule = buildTaskCapsule({ contract, exploration, project });
    expect(capsule.context.targetRegions).toEqual([
      "src/integrations",
      "src/queue",
    ]);
    expect(capsule.execution.allowedPaths).toEqual([
      "src/integrations",
      "src/queue",
    ]);
    expect(capsule.execution.prohibitedPaths).toEqual(["src/config.ts"]);
  });

  it("should include all validation commands", () => {
    const capsule = buildTaskCapsule({ contract, exploration, project });
    expect(capsule.execution.validationCommands).toContain("npm test");
    expect(capsule.execution.validationCommands).toContain("npm run lint");
    expect(capsule.execution.validationCommands).toContain("npm run build");
  });

  it("should degrade gracefully without exploration results", () => {
    const capsule = buildTaskCapsule({ contract, exploration: null, project });
    expect(capsule.context.targetRegions).toEqual([]);
    expect(capsule.execution.allowedPaths).toEqual([]);
  });

  it("should limit the number of target regions", () => {
    const many: ExplorationResult = {
      regions: Array.from({ length: 12 }, (_, i) => ({
        path: `src/region-${String(i)}`,
        score: 100 - i,
        reason: "test",
      })),
      filesRead: 12,
      linesRead: 100,
      budgetExhausted: false,
    };
    const capsule = buildTaskCapsule({
      contract,
      exploration: many,
      project,
      maxTargetRegions: 3,
    });
    expect(capsule.context.targetRegions).toHaveLength(3);
  });

  it("should always include stop conditions", () => {
    const capsule = buildTaskCapsule({ contract, exploration, project });
    expect(capsule.task.stopConditions.length).toBeGreaterThan(0);
    expect(capsule.task.stopConditions.join(" ")).toContain("repair loops");
  });
});
