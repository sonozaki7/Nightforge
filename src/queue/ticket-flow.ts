import { randomUUID } from "node:crypto";
import pino from "pino";
import type { ArtifactStore } from "../artifacts/store.js";
import type {
  DecisionPacket,
  FailureRecord,
  IntakeBrief,
  RequirementsContract,
  RiskLevel,
  TaskCapsule,
} from "../artifacts/schemas.js";
import type { RepositoryExplorer } from "../context/repository-explorer.js";
import { buildTaskCapsule } from "../context/capsule-builder.js";
import type { FailureTriage, TriageAction } from "../policy/failure-triage.js";
import type { AskOncePolicy } from "../policy/ask-once.js";
import type { TicketWorkflow, TicketOutcome } from "./ticket-workflow.js";
import type { Reviewer, ReviewVerdict } from "./reviewer.js";
import { buildContract } from "./intake-contract.js";
import { withRepairContext } from "./repair-context.js";
import type { TicketJob } from "./scheduler.js";
import type { ProjectConfig } from "../projects/registry.js";
import type { WorkerPool } from "../workers/pool.js";
import type { ModelProvider, WorkerResult } from "../workers/worker.js";
import type { EpicAtomizer, EpicBriefInput } from "../epic/atomizer.js";
import type { EpicOrchestrator } from "../epic/epic-orchestrator.js";
import { resolveExecutionMode, DEFAULT_EXECUTION_MODE_CONFIG } from "./execution-mode.js";

const logger = pino({ name: "nightforge-ticket-flow" });

/**
 * Full v2.1 ticket lifecycle (Guide §10.3):
 *   classify → explore → capsule → implement → validate → gated release.
 * Deterministic stages run without models; only implementation uses one.
 */

const HIGH_RISK_LABELS = new Set([
  "security",
  "billing",
  "auth",
  "authentication",
  "architecture",
  "migration",
]);

/** Guide §20.3: maximum ordinary repair loops is three. */
const MAX_ATTEMPTS = 3;

/** Deterministic failure categorization for triage (Guide §20.1). */
export function classifyWorkerFailure(result: WorkerResult): FailureRecord["category"] {
  if (/fail/i.test(result.testResults)) return "unit-behavior";
  return "compile-type";
}

/** Questions embedded in a ticket description are known unknowns. */
export function extractQuestions(text: string): string[] {
  const matches = text.match(/[^.!?\n]*\?/g) ?? [];
  return matches
    .map((m) => m.trim())
    .filter((m) => m.length > 1);
}

export function classifyRiskFromLabels(labels: string[]): RiskLevel {
  const lower = labels.map((l) => l.toLowerCase());
  if (lower.includes("critical")) return "critical";
  if (lower.some((l) => HIGH_RISK_LABELS.has(l))) return "high";
  if (lower.includes("medium")) return "medium";
  return "low";
}

export interface TicketFlowDeps {
  artifactStore: ArtifactStore;
  explorer: RepositoryExplorer;
  workflow: TicketWorkflow;
  /** Optional model-backed atomizer: decomposes complex tickets into sub-tasks. */
  atomizer?: EpicAtomizer;
  /** Optional epic orchestrator: runs decomposed sub-tasks in dependency waves. */
  orchestrator?: EpicOrchestrator;
  /** Optional repair loop: triage failures and retry within budget. */
  triage?: FailureTriage;
  /**
   * Optional tier-aware model selection (Guide §13). Called per attempt;
   * failureCount lets the router escalate tiers after repeated failures.
   */
  resolveModel?: (context: {
    riskLevel: RiskLevel;
    failureCount: number;
    taskKey: string;
  }) => ModelProvider;
  /** Learning seam (Roadmap Phase 6): reports each attempt's route outcome. */
  recordRouteOutcome?: (context: {
    riskLevel: RiskLevel;
    failureCount: number;
    taskKey: string;
    success: boolean;
  }) => void;
  /** Optional Ask-Once policy: route intake unknowns into a decision packet. */
  askOnce?: AskOncePolicy;
  /** Optional independent reviewer, applied to high-risk classes only. */
  reviewer?: Reviewer;
  /** Optional delivery channel for built decision packets (Linear comments). */
  notifyDecisionPacket?: (packet: DecisionPacket) => Promise<void>;
  /** Resolve the repository path to explore for a project. */
  repoPathForProject: (projectId: string) => string;
  /** Resolve the sandbox worktree path that gets deployed for a job. */
  worktreeForJob: (job: TicketJob) => string;
}

export interface TicketFlowResult {
  brief: IntakeBrief;
  contract: RequirementsContract;
  capsule: TaskCapsule;
  workerResult: WorkerResult;
  attempts: number;
  triageActions: TriageAction[];
  /** Null when no review ran (low/medium risk or no reviewer wired). */
  review: ReviewVerdict | null;
  /** Null when the agent itself failed, before any release attempt. */
  outcome: TicketOutcome | null;
}

function compileBrief(job: TicketJob, risk: RiskLevel, now: Date): IntakeBrief {
  // Tickets occasionally arrive without a description; the title is then the
  // only goal we have (the brief schema rejects an empty goal).
  const goal = job.description.trim().length > 0 ? job.description : job.title;
  return {
    briefId: `brief-${randomUUID()}`,
    projectId: job.projectId,
    source: "linear-ticket",
    sourceId: job.ticketId,
    title: job.title,
    goal,
    constraints: [],
    knownUnknowns: extractQuestions(job.description),
    riskLevel: risk,
    createdAt: now.toISOString(),
  };
}

export async function runTicketFlow(
  job: TicketJob,
  config: ProjectConfig,
  modelProvider: ModelProvider,
  workerPool: WorkerPool,
  deps: TicketFlowDeps
): Promise<TicketFlowResult> {
  const now = new Date();
  const log = logger.child({ ticketId: job.ticketId, projectId: job.projectId });

  // Stage 1 — intake: compile and persist the brief.
  const risk = classifyRiskFromLabels(job.labels);
  const brief = compileBrief(job, risk, now);
  await deps.artifactStore.save("intake-brief", job.projectId, brief.briefId, brief);

  // Stage 1.5 — Ask-Once (Guide §4.2-4.3): route intake unknowns into a
  // decision packet with defaults that apply if the human never responds.
  // Low/medium-risk unknowns are inferred and reported; on high-risk work
  // the same question goes into a packet instead of being guessed.
  if (deps.askOnce !== undefined && brief.knownUnknowns.length > 0) {
    const reversible = risk === "low" || risk === "medium";
    for (const question of brief.knownUnknowns) {
      await deps.askOnce.resolveUnknown(
        job.projectId,
        job.ticketId,
        { question, reversible, impact: "material", sensitive: false },
        {
          recommendedOption: "proceed-default",
          choices: [
            {
              id: "proceed-default",
              description: `Proceed with the inferred default for: ${question}`,
              consequences: "Recorded as a system decision; reversible",
            },
            {
              id: "hold",
              description: "Hold this branch until a human answers",
              consequences: "Ticket pauses for input",
            },
          ],
          defaultIfNoResponse: "proceed-default",
        }
      );
    }
    // buildPacket persists the packet; the recommended defaults apply.
    const packet = await deps.askOnce.buildPacket(job.projectId, job.ticketId);
    if (packet !== null) {
      log.info(
        { packetId: packet.packetId, count: packet.items.length },
        "Decision packet built and stored"
      );
      if (deps.notifyDecisionPacket !== undefined) {
        await deps.notifyDecisionPacket(packet);
      }
    }
  }

  // Stage 2 — exploration within budget (Guide §7: dedicated stage).
  const exploration = await deps.explorer
    .explore(deps.repoPathForProject(job.projectId), `${job.title} ${job.description}`, {
      maxLines: 3000,
      maxFiles: 40,
    })
    .catch((error: unknown) => {
      // Exploration failure must not kill the ticket: degrade to full-repo context.
      log.warn({ err: error }, "Exploration failed; continuing without it");
      return null;
    });

  // Stage 3 — contract + capsule, both persisted as typed artifacts.
  const contract = buildContract(brief, config, now);
  await deps.artifactStore.save(
    "requirements",
    job.projectId,
    contract.contractId,
    contract
  );

  const capsule = buildTaskCapsule({
    contract,
    exploration,
    project: {
      testCommand: config.deployment.testCommand,
      lintCommand: config.deployment.lintCommand,
      typecheckCommand: config.deployment.typecheckCommand,
      buildCommand: config.deployment.buildCommand,
      budgetUsd: config.agent.maxTicketCostUsd,
      prohibitedPaths: [],
    },
  });
  await deps.artifactStore.save(
    "task-capsule",
    job.projectId,
    capsule.task.id,
    capsule
  );

  // Stage 3.5 — model-backed decomposition for complex tickets (Guide §11):
  // when the autonomous router judges the ticket complex AND the atomizer
  // says it should decompose, run sub-tasks through the epic orchestrator
  // instead of a single worker pass. Each sub-task goes through the same
  // worker + validation gates, so a failure stops before dependent work.
  if (deps.atomizer !== undefined && deps.orchestrator !== undefined) {
    const mode = resolveExecutionMode(job, DEFAULT_EXECUTION_MODE_CONFIG);
    if (mode === "agentic") {
      const briefInput: EpicBriefInput = {
        epicId: job.ticketId,
        title: job.title,
        objective: brief.goal,
        components: [],
      };
      const decomposition = await deps.atomizer.atomize(briefInput);
      if (!decomposition.atomic && decomposition.tasks.length > 1) {
        log.info(
          { tasks: decomposition.tasks.length },
          "Complex ticket decomposed into sub-tasks"
        );

        const executor = async (task: { id: string; objective: string }): Promise<{ taskId: string; success: boolean; summary: string }> => {
          const subJob: TicketJob = {
            ...job,
            title: `${job.title} — ${task.id}`,
            description: task.objective,
            labels: [...job.labels.filter((l) => l !== "agentic"), "plain"],
          };
          const subResult = await workerPool.processTicket(
            subJob,
            config,
            chooseProvider(0)
          );
          return {
            taskId: task.id,
            success: subResult.success,
            summary: subResult.summary,
          };
        };

        const epic = await deps.orchestrator.runEpic(
          job.ticketId,
          decomposition.tasks,
          executor
        );

        const allSucceeded = epic.state === "accepted";
        const aggregated: WorkerResult = {
          success: allSucceeded,
          summary: epic.message,
          filesChanged: [],
          testResults: `Waves: ${String(epic.waves.length)}, completed: ${String(epic.completed.length)}, failed: ${String(epic.failed.length)}`,
          tokensUsed: 0,
          costUsd: 0,
        };

        if (!allSucceeded) {
          log.warn({ epicState: epic.state, failed: epic.failed }, "Epic decomposition failed");
          return { brief, contract, capsule, workerResult: aggregated, attempts: 1, triageActions: [], review: null, outcome: null };
        }

        log.info("Epic decomposition succeeded; running verification gates");
        // Fall through to validation/release with the aggregated result below.
        const verifiedContract: RequirementsContract = {
          ...contract,
          acceptanceCriteria: contract.acceptanceCriteria.map((c) => ({
            ...c,
            verified: true,
          })),
        };
        const outcome = await deps.workflow.runReleaseStage(
          job.ticketId,
          verifiedContract,
          config,
          deps.worktreeForJob(job),
          aggregated.summary
        );
        return { brief, contract: verifiedContract, capsule, workerResult: aggregated, attempts: 1, triageActions: [], review: null, outcome };
      }
    }
  }

  // Stage 4 — implementation inside the sandbox, with a triage-driven
  // repair loop (Guide §10.3 steps 6-7): record, classify, retry or stop.
  const chooseProvider = (failureCount: number): ModelProvider =>
    deps.resolveModel !== undefined
      ? deps.resolveModel({
          riskLevel: risk,
          failureCount,
          taskKey: `${job.ticketId}::${String(failureCount)}`,
        })
      : modelProvider;

  let workerResult = await workerPool.processTicket(job, config, chooseProvider(0));
  let attempts = 1;
  deps.recordRouteOutcome?.({
    riskLevel: risk,
    failureCount: 0,
    taskKey: `${job.ticketId}::0`,
    success: workerResult.success,
  });
  const triageActions: TriageAction[] = [];
  let activeJob = job;
  while (!workerResult.success && deps.triage !== undefined && attempts < MAX_ATTEMPTS) {
    const { decision } = await deps.triage.triage(job.projectId, {
      ticketId: job.ticketId,
      category: classifyWorkerFailure(workerResult),
      symptom: workerResult.summary,
      suspectedScope: job.title,
      confidence: 0.5,
    });
    triageActions.push(decision.action);
    if (decision.action === "escalate") break;
    attempts += 1;
    log.info(
      { attempt: attempts, action: decision.action, strategy: decision.strategy },
      "Retrying implementation after triage"
    );
    // The repair attempt sees what went wrong — otherwise the model repeats
    // the same mistake (e.g. the identical lint error) every time.
    activeJob = withRepairContext(job, workerResult, decision.strategy);
    workerResult = await workerPool.processTicket(activeJob, config, chooseProvider(attempts - 1));
    deps.recordRouteOutcome?.({
      riskLevel: risk,
      failureCount: attempts - 1,
      taskKey: `${job.ticketId}::${String(attempts - 1)}`,
      success: workerResult.success,
    });
  }
  if (!workerResult.success) {
    log.warn({ summary: workerResult.summary, attempts }, "Implementation failed");
    return { brief, contract, capsule, workerResult, attempts, triageActions, review: null, outcome: null };
  }

  // Stage 5 — verification evidence: worker success means the deterministic
  // validation commands passed inside the sandbox (Guide decision 8).
  const verifiedContract: RequirementsContract = {
    ...contract,
    acceptanceCriteria: contract.acceptanceCriteria.map((c) => ({
      ...c,
      verified: true,
    })),
  };
  await deps.artifactStore.save(
    "requirements",
    job.projectId,
    contract.contractId,
    verifiedContract
  );

  // Stage 5.5 — independent review, high-risk classes only (PHILOSOPHY.md:
  // reversible work relies on verification + instant rollback instead).
  let review: ReviewVerdict | null = null;
  if (deps.reviewer !== undefined && (risk === "high" || risk === "critical")) {
    review = await deps.reviewer.review({
      filesChanged: workerResult.filesChanged,
      allowedPaths: capsule.execution.allowedPaths,
      prohibitedPaths: capsule.execution.prohibitedPaths,
      testResults: workerResult.testResults,
    });
    if (!review.approved) {
      log.warn({ findings: review.findings }, "Reviewer blocked the release");
      return { brief, contract: verifiedContract, capsule, workerResult, attempts, triageActions, review, outcome: null };
    }
  }

  // Stage 6 — blast-radius-gated release (reversible work ships direct).
  const outcome = await deps.workflow.runReleaseStage(
    job.ticketId,
    verifiedContract,
    config,
    deps.worktreeForJob(job),
    workerResult.summary
  );

  log.info({ state: outcome.state }, "Ticket flow complete");
  return { brief, contract: verifiedContract, capsule, workerResult, attempts, triageActions, review, outcome };
}
