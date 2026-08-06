import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runTicketFlow, classifyRiskFromLabels, classifyWorkerFailure, extractQuestions, type TicketFlowDeps } from "../src/queue/ticket-flow.js";
import { withRepairContext } from "../src/queue/repair-context.js";
import { createArtifactStore } from "../src/artifacts/store.js";
import { createFailureTriage } from "../src/policy/failure-triage.js";
import { createAskOncePolicy } from "../src/policy/ask-once.js";
import { createReviewer } from "../src/queue/reviewer.js";
import type { RepositoryExplorer } from "../src/context/repository-explorer.js";
import type { TicketWorkflow, TicketOutcome } from "../src/queue/ticket-workflow.js";
import type { WorkerPool } from "../src/workers/pool.js";
import type { ModelProvider, WorkerResult } from "../src/workers/worker.js";
import type { TicketJob } from "../src/queue/scheduler.js";
import type { RiskLevel } from "../src/artifacts/schemas.js";
import type { ProjectConfig } from "../src/projects/registry.js";
import { buildDefaultProjectConfig } from "../src/projects/default-config.js";

const job: TicketJob = {
  ticketId: "T-100",
  projectId: "my-saas",
  title: "Add webhook retry",
  description: "Retry failed webhook deliveries three times",
  labels: [],
  priority: 1,
  attempt: 1,
};

function fakeWorkerPool(...successes: boolean[]): WorkerPool {
  let call = 0;
  const resultFor = (success: boolean): WorkerResult => ({
    success,
    summary: success ? "Implemented retry" : "Tests failed",
    filesChanged: success ? ["src/webhook.ts"] : [],
    testResults: success ? "12 passed" : "1 failed",
    tokensUsed: 500,
    costUsd: 0.12,
  });
  return {
    processTicket: (): Promise<WorkerResult> => {
      const success = successes[Math.min(call, successes.length - 1)];
      call += 1;
      return Promise.resolve(resultFor(success));
    },
    processAgenticTicket: () => Promise.reject(new Error("not used")),
    processAcpTicket: () => Promise.reject(new Error("not used")),
    releaseTicket: () => Promise.resolve(),
    getActiveWorkers: () => 0,
    shutdown: () => Promise.resolve(),
  };
}

function fakeWorkflow(state: TicketOutcome["state"]): {
  workflow: TicketWorkflow;
  calls: number[];
} {
  const calls: number[] = [];
  const workflow: TicketWorkflow = {
    runReleaseStage: (ticketId) => {
      calls.push(ticketId.length);
      return Promise.resolve({
        ticketId,
        state,
        gate: {
          path: "direct-production",
          radius: "low",
          reason: "test",
          mayShip: true,
        },
        pipeline: null,
        criteriaVerified: 4,
        criteriaTotal: 4,
        message: "ok",
      });
    },
  };
  return { workflow, calls };
}

const noopExplorer: RepositoryExplorer = {
  explore: () =>
    Promise.resolve({ regions: [], filesRead: 0, linesRead: 0, budgetExhausted: false }),
};

describe("classifyRiskFromLabels", () => {
  it("should default to low risk", () => {
    expect(classifyRiskFromLabels([])).toBe("low");
    expect(classifyRiskFromLabels(["enhancement"])).toBe("low");
  });

  it("should escalate on high-risk labels", () => {
    expect(classifyRiskFromLabels(["security"])).toBe("high");
    expect(classifyRiskFromLabels(["Billing"])).toBe("high");
    expect(classifyRiskFromLabels(["migration"])).toBe("high");
  });

  it("should honor critical and medium labels", () => {
    expect(classifyRiskFromLabels(["critical"])).toBe("critical");
    expect(classifyRiskFromLabels(["medium"])).toBe("medium");
  });
});

describe("classifyWorkerFailure", () => {
  it("should map failing tests to unit-behavior", () => {
    const failed: WorkerResult = {
      success: false,
      summary: "x",
      filesChanged: [],
      testResults: "3 failed, 9 passed",
      tokensUsed: 0,
      costUsd: 0,
    };
    expect(classifyWorkerFailure(failed)).toBe("unit-behavior");
  });

  it("should default to compile-type when tests did not fail", () => {
    const failed: WorkerResult = {
      success: false,
      summary: "x",
      filesChanged: [],
      testResults: "not run",
      tokensUsed: 0,
      costUsd: 0,
    };
    expect(classifyWorkerFailure(failed)).toBe("compile-type");
  });
});

describe("extractQuestions", () => {
  it("should pull questions out of a description", () => {
    expect(
      extractQuestions("Retry webhooks. Should we cap at 3? Use backoff.")
    ).toEqual(["Should we cap at 3?"]);
  });

  it("should return nothing when there are no questions", () => {
    expect(extractQuestions("Retry failed webhook deliveries three times")).toEqual([]);
    expect(extractQuestions("No questions here.")).toEqual([]);
  });

  it("should handle multiple questions across lines", () => {
    const text = "Use Redis?\nAlso, cap the retries?";
    expect(extractQuestions(text)).toEqual(["Use Redis?", "Also, cap the retries?"]);
  });
});

describe("runTicketFlow", () => {
  let dir: string;
  let config: ProjectConfig;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "nightforge-flow-"));
    config = buildDefaultProjectConfig("my-saas", dir);
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function makeDeps(workflow: TicketWorkflow): TicketFlowDeps {
    return {
      artifactStore: createArtifactStore(join(dir, "artifacts")),
      explorer: noopExplorer,
      workflow,
      repoPathForProject: (): string => dir,
      worktreeForJob: (j: TicketJob): string => join(dir, j.ticketId),
    };
  }

  it("should persist brief, contract, and capsule artifacts", async () => {
    const { workflow } = fakeWorkflow("shipped");
    const deps = makeDeps(workflow);
    const result = await runTicketFlow(
      job, config, { generate: () => Promise.resolve({ content: "", tokensUsed: 0, costUsd: 0 }) },
      fakeWorkerPool(true), deps
    );

    expect(result.outcome?.state).toBe("shipped");
    const briefs = await deps.artifactStore.list("intake-brief", "my-saas");
    const contracts = await deps.artifactStore.list("requirements", "my-saas");
    const capsules = await deps.artifactStore.list("task-capsule", "my-saas");
    expect(briefs).toHaveLength(1);
    expect(contracts).toHaveLength(1);
    expect(capsules).toHaveLength(1);
  });

  it("should mark criteria verified before the release stage", async () => {
    const { workflow } = fakeWorkflow("shipped");
    const deps = makeDeps(workflow);
    const result = await runTicketFlow(
      job, config, { generate: () => Promise.resolve({ content: "", tokensUsed: 0, costUsd: 0 }) },
      fakeWorkerPool(true), deps
    );
    expect(result.contract.acceptanceCriteria.every((c) => c.verified)).toBe(true);
  });

  it("should stop before release when the worker fails", async () => {
    const { workflow, calls } = fakeWorkflow("shipped");
    const deps = makeDeps(workflow);
    const result = await runTicketFlow(
      job, config, { generate: () => Promise.resolve({ content: "", tokensUsed: 0, costUsd: 0 }) },
      fakeWorkerPool(false), deps
    );
    expect(result.outcome).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("should survive explorer failure and still ship", async () => {
    const { workflow } = fakeWorkflow("shipped");
    const deps = makeDeps(workflow);
    const failingExplorer: RepositoryExplorer = {
      explore: () => Promise.reject(new Error("repo unreadable")),
    };
    const result = await runTicketFlow(
      job, config, { generate: () => Promise.resolve({ content: "", tokensUsed: 0, costUsd: 0 }) },
      fakeWorkerPool(true), { ...deps, explorer: failingExplorer }
    );
    expect(result.outcome?.state).toBe("shipped");
    expect(result.capsule.context.targetRegions).toEqual([]);
  });

  it("should hold high-risk tickets for approval", async () => {
    const { workflow } = fakeWorkflow("awaiting_approval");
    const deps = makeDeps(workflow);
    const riskyJob: TicketJob = { ...job, labels: ["billing"] };
    const result = await runTicketFlow(
      riskyJob, config, { generate: () => Promise.resolve({ content: "", tokensUsed: 0, costUsd: 0 }) },
      fakeWorkerPool(true), deps
    );
    expect(result.outcome?.state).toBe("awaiting_approval");
    expect(result.brief.riskLevel).toBe("high");
  });

  it("should run an independent review for high-risk tickets and hold for approval", async () => {
    const { workflow } = fakeWorkflow("awaiting_approval");
    const deps: TicketFlowDeps = { ...makeDeps(workflow), reviewer: createReviewer() };
    const riskyJob: TicketJob = { ...job, labels: ["billing"] };
    const result = await runTicketFlow(
      riskyJob, config, { generate: () => Promise.resolve({ content: "", tokensUsed: 0, costUsd: 0 }) },
      fakeWorkerPool(true), deps
    );
    expect(result.review?.approved).toBe(true);
    expect(result.outcome?.state).toBe("awaiting_approval");
  });

  it("should block the release when the reviewer finds a blocker", async () => {
    const { workflow, calls } = fakeWorkflow("shipped");
    const deps: TicketFlowDeps = { ...makeDeps(workflow), reviewer: createReviewer() };
    const riskyJob: TicketJob = { ...job, labels: ["billing"] };
    // Worker claims success but its validation suite failed.
    const dirtyPool: WorkerPool = {
      processTicket: (): Promise<WorkerResult> => Promise.resolve({
        success: true,
        summary: "Done",
        filesChanged: ["src/billing.ts"],
        testResults: "1 failed",
        tokensUsed: 10,
        costUsd: 0.01,
      }),
      processAgenticTicket: () => Promise.reject(new Error("not used")),
      processAcpTicket: () => Promise.reject(new Error("not used")),
      releaseTicket: () => Promise.resolve(),
      getActiveWorkers: () => 0,
      shutdown: () => Promise.resolve(),
    };
    const result = await runTicketFlow(
      riskyJob, config, { generate: () => Promise.resolve({ content: "", tokensUsed: 0, costUsd: 0 }) },
      dirtyPool, deps
    );
    expect(result.review?.approved).toBe(false);
    expect(result.outcome).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("should skip review entirely for low-risk tickets", async () => {
    const { workflow } = fakeWorkflow("shipped");
    const deps: TicketFlowDeps = { ...makeDeps(workflow), reviewer: createReviewer() };
    const result = await runTicketFlow(
      job, config, { generate: () => Promise.resolve({ content: "", tokensUsed: 0, costUsd: 0 }) },
      fakeWorkerPool(true), deps
    );
    expect(result.review).toBeNull();
    expect(result.outcome?.state).toBe("shipped");
  });

  it("should retry through the triage repair loop and ship", async () => {
    const { workflow } = fakeWorkflow("shipped");
    const deps: TicketFlowDeps = {
      ...makeDeps(workflow),
      triage: createFailureTriage(createArtifactStore(join(dir, "triage-ok"))),
    };
    const result = await runTicketFlow(
      job, config, { generate: () => Promise.resolve({ content: "", tokensUsed: 0, costUsd: 0 }) },
      fakeWorkerPool(false, true), deps
    );
    expect(result.outcome?.state).toBe("shipped");
    expect(result.attempts).toBe(2);
    expect(result.triageActions).toEqual(["repair"]);
  });

  it("should exhaust the repair budget without releasing", async () => {
    const { workflow, calls } = fakeWorkflow("shipped");
    const deps: TicketFlowDeps = {
      ...makeDeps(workflow),
      triage: createFailureTriage(createArtifactStore(join(dir, "triage-fail"))),
    };
    const result = await runTicketFlow(
      job, config, { generate: () => Promise.resolve({ content: "", tokensUsed: 0, costUsd: 0 }) },
      fakeWorkerPool(false), deps
    );
    expect(result.outcome).toBeNull();
    expect(result.attempts).toBe(3);
    expect(result.triageActions).toEqual(["repair", "repair_diverse"]);
    expect(calls).toHaveLength(0);
  });

  it("should route model selection with rising failure counts", async () => {
    const { workflow } = fakeWorkflow("shipped");
    const seenFailureCounts: number[] = [];
    const seenRisk: RiskLevel[] = [];
    const stub: ModelProvider = {
      generate: () => Promise.resolve({ content: "", tokensUsed: 0, costUsd: 0 }),
    };
    const deps: TicketFlowDeps = {
      ...makeDeps(workflow),
      triage: createFailureTriage(createArtifactStore(join(dir, "triage-route"))),
      resolveModel: (ctx): ModelProvider => {
        seenFailureCounts.push(ctx.failureCount);
        seenRisk.push(ctx.riskLevel);
        return stub;
      },
    };
    const result = await runTicketFlow(
      job, config, stub, fakeWorkerPool(false, true), deps
    );
    expect(result.outcome?.state).toBe("shipped");
    expect(seenFailureCounts).toEqual([0, 1]);
    expect(seenRisk).toEqual(["low", "low"]);
  });

  it("should report each attempt's route outcome for learning", async () => {
    const { workflow } = fakeWorkflow("shipped");
    const outcomes: Array<{ failureCount: number; success: boolean }> = [];
    const deps: TicketFlowDeps = {
      ...makeDeps(workflow),
      triage: createFailureTriage(createArtifactStore(join(dir, "triage-learn"))),
      recordRouteOutcome: (ctx): void => {
        outcomes.push({ failureCount: ctx.failureCount, success: ctx.success });
      },
    };
    await runTicketFlow(
      job, config,
      { generate: () => Promise.resolve({ content: "", tokensUsed: 0, costUsd: 0 }) },
      fakeWorkerPool(false, true), deps
    );
    expect(outcomes).toEqual([
      { failureCount: 0, success: false },
      { failureCount: 1, success: true },
    ]);
  });

  it("should record intake questions as recommended decisions", async () => {
    const { workflow } = fakeWorkflow("shipped");
    const askOnceStore = createArtifactStore(join(dir, "askonce"));
    const deps: TicketFlowDeps = {
      ...makeDeps(workflow),
      askOnce: createAskOncePolicy(askOnceStore),
    };
    const questioning: TicketJob = {
      ...job,
      description: "Retry webhooks. Should we cap retries at 3?",
    };
    const result = await runTicketFlow(
      questioning, config, { generate: () => Promise.resolve({ content: "", tokensUsed: 0, costUsd: 0 }) },
      fakeWorkerPool(true), deps
    );

    expect(result.brief.knownUnknowns).toEqual(["Should we cap retries at 3?"]);
    expect(result.outcome?.state).toBe("shipped");
    // Reversible + material unknowns are recommended and recorded, not asked.
    const decisions = await askOnceStore.list("decision-log", "my-saas");
    expect(decisions).toHaveLength(1);
  });

  it("should skip packet building when there are no unknowns", async () => {
    const { workflow } = fakeWorkflow("shipped");
    const askOnceStore = createArtifactStore(join(dir, "askonce-none"));
    const deps: TicketFlowDeps = {
      ...makeDeps(workflow),
      askOnce: createAskOncePolicy(askOnceStore),
    };
    const result = await runTicketFlow(
      job, config, { generate: () => Promise.resolve({ content: "", tokensUsed: 0, costUsd: 0 }) },
      fakeWorkerPool(true), deps
    );
    expect(result.outcome?.state).toBe("shipped");
    const packets = await askOnceStore.list("decision-packet", "my-saas");
    expect(packets).toHaveLength(0);
  });

  it("should ask in a stored packet when a high-risk ticket has unknowns", async () => {
    const { workflow } = fakeWorkflow("awaiting_approval");
    const askOnceStore = createArtifactStore(join(dir, "askonce-risky"));
    const deps: TicketFlowDeps = {
      ...makeDeps(workflow),
      askOnce: createAskOncePolicy(askOnceStore),
    };
    const questioning: TicketJob = {
      ...job,
      labels: ["billing"],
      description: "Change billing rounding. Which currency precision?",
    };
    const result = await runTicketFlow(
      questioning, config, { generate: () => Promise.resolve({ content: "", tokensUsed: 0, costUsd: 0 }) },
      fakeWorkerPool(true), deps
    );

    expect(result.brief.riskLevel).toBe("high");
    const packets = await askOnceStore.list("decision-packet", "my-saas");
    expect(packets).toHaveLength(1);
  });
});

describe("withRepairContext", () => {
  it("appends the previous failure, strategy, and validation output", () => {
    const previous: WorkerResult = {
      success: false,
      summary: "Validation failed: lint failed",
      filesChanged: [],
      testResults: "[lint] FAIL\nerror: Unsafe member access",
      tokensUsed: 100,
      costUsd: 0,
    };
    const repaired = withRepairContext(job, previous, "Try a different approach");

    expect(repaired.ticketId).toBe(job.ticketId);
    expect(repaired.description).toContain(job.description);
    expect(repaired.description).toContain("Validation failed: lint failed");
    expect(repaired.description).toContain("Try a different approach");
    expect(repaired.description).toContain("Unsafe member access");
  });

  it("caps huge validation output", () => {
    const previous: WorkerResult = {
      success: false,
      summary: "Validation failed: test failed",
      filesChanged: [],
      testResults: "x".repeat(5000),
      tokensUsed: 100,
      costUsd: 0,
    };
    const repaired = withRepairContext(job, previous, "strategy");

    expect(repaired.description.length).toBeLessThan(job.description.length + 3200);
  });
});
