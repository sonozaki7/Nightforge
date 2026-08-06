import { describe, expect, it } from "vitest";
import {
  createReleaseGate,
  createTicketWorkflow,
  type TicketWorkflowDeps,
} from "../src/queue/ticket-workflow.js";
import { createBlastRadiusClassifier } from "../src/tools/blast-radius.js";
import type { RequirementsContract } from "../src/artifacts/schemas.js";
import type { ExecutionPipeline, PipelineResult } from "../src/projects/pipeline.js";
import type { ProjectConfig } from "../src/projects/registry.js";

const project: ProjectConfig = {
  id: "my-saas",
  name: "My SaaS Product",
  path: "/srv/apps/my-saas/repository",
  deployment: {
    policy: "direct-prod",
    testCommand: "npm test",
    lintCommand: "npm run lint",
    typecheckCommand: "npx tsc --noEmit",
    buildCommand: "npm run build",
    deployCommand: "./ops/deploy.sh",
    healthcheckCommand: "./ops/healthcheck.sh",
    rollbackCommand: "./ops/rollback.sh",
  },
  concurrency: { maxWriteTasks: 1, maxReadonlyTasks: 3 },
  agent: { defaultModel: "qwen3.8", maxAttempts: 3, maxRuntimeMinutes: 90, maxTicketCostUsd: 8 },
  permissions: { allowedServices: ["github"], prohibitedActions: [] },
  risk: { approvalRequiredFor: ["billing"] },
};

function makeContract(
  overrides: Partial<RequirementsContract> = {}
): RequirementsContract {
  return {
    contractId: "c-1",
    briefId: "b-1",
    objective: "Add a retry to the webhook handler",
    acceptanceCriteria: [
      { id: "ac-1", description: "retries three times", verified: true },
      { id: "ac-2", description: "logs each attempt", verified: true },
    ],
    nonGoals: [],
    riskLevel: "low",
    createdAt: "2026-08-04T20:00:00.000Z",
    ...overrides,
  };
}

function shippedPipeline(): ExecutionPipeline {
  const result: PipelineResult = {
    success: true,
    state: "shipped",
    merge: null,
    deploy: null,
    health: null,
    durationMs: 1200,
    message: "Shipped.",
  };
  return { execute: () => Promise.resolve(result) };
}

function makeDeps(pipeline?: ExecutionPipeline): TicketWorkflowDeps {
  return {
    releaseGate: createReleaseGate(createBlastRadiusClassifier()),
    pipeline: pipeline ?? shippedPipeline(),
  };
}

describe("createReleaseGate", () => {
  const gate = createReleaseGate(createBlastRadiusClassifier());

  it("should ship reversible low-risk work direct to production", () => {
    const result = gate.evaluate(makeContract(), false);
    expect(result.path).toBe("direct-production");
    expect(result.mayShip).toBe(true);
  });

  it("should hold high-risk work for one human tap", () => {
    const result = gate.evaluate(makeContract({ riskLevel: "high" }), false);
    expect(result.path).toBe("staging-then-approval");
    expect(result.mayShip).toBe(false);

    const approved = gate.evaluate(makeContract({ riskLevel: "high" }), true);
    expect(approved.mayShip).toBe(true);
  });

  it("should detect high-risk classes from acceptance criteria text", () => {
    const contract = makeContract({
      acceptanceCriteria: [
        { id: "ac-1", description: "auth token refresh works", verified: true },
      ],
    });
    expect(gate.evaluate(contract, false).path).toBe("staging-then-approval");
  });

  it("should block critical risk contracts entirely", () => {
    const result = gate.evaluate(makeContract({ riskLevel: "critical" }), true);
    expect(result.path).toBe("blocked");
    expect(result.mayShip).toBe(false);
  });
});

describe("createTicketWorkflow", () => {
  it("should refuse release when acceptance criteria are unverified", async () => {
    const workflow = createTicketWorkflow(makeDeps());
    const contract = makeContract({
      acceptanceCriteria: [
        { id: "ac-1", description: "works", verified: false },
      ],
    });
    const outcome = await workflow.runReleaseStage(
      "T-1", contract, project, "/tmp/wt", "summary"
    );
    expect(outcome.state).toBe("verify_failed");
    expect(outcome.pipeline).toBeNull();
  });

  it("should ship verified reversible work without any human input", async () => {
    const workflow = createTicketWorkflow(makeDeps());
    const outcome = await workflow.runReleaseStage(
      "T-2", makeContract(), project, "/tmp/wt", "summary"
    );
    expect(outcome.state).toBe("shipped");
    expect(outcome.gate.path).toBe("direct-production");
    expect(outcome.criteriaVerified).toBe(2);
  });

  it("should hold unapproved high-risk work in awaiting_approval", async () => {
    const workflow = createTicketWorkflow(makeDeps());
    const outcome = await workflow.runReleaseStage(
      "T-3", makeContract({ riskLevel: "high" }), project, "/tmp/wt", "summary"
    );
    expect(outcome.state).toBe("awaiting_approval");
    expect(outcome.pipeline).toBeNull();
  });

  it("should ship high-risk work after the single human tap", async () => {
    const workflow = createTicketWorkflow(makeDeps());
    const outcome = await workflow.runReleaseStage(
      "T-4", makeContract({ riskLevel: "high" }), project, "/tmp/wt", "summary",
      { humanApproved: true }
    );
    expect(outcome.state).toBe("shipped");
  });

  it("should surface pipeline rollback as rolled_back", async () => {
    const failing: ExecutionPipeline = {
      execute: () =>
        Promise.resolve({
          success: false,
          state: "rolled_back" as const,
          merge: null,
          deploy: null,
          health: null,
          durationMs: 900,
          message: "Health check failed; rolled back",
        }),
    };
    const workflow = createTicketWorkflow(makeDeps(failing));
    const outcome = await workflow.runReleaseStage(
      "T-5", makeContract(), project, "/tmp/wt", "summary"
    );
    expect(outcome.state).toBe("rolled_back");
  });
});
