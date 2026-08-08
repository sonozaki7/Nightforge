import { Redis } from "ioredis";
import { existsSync } from "node:fs";
import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import pino from "pino";
import { loadConfig } from "./config.js";
import { createLinearClient } from "./integrations/linear.js";
import { createScheduler } from "./queue/scheduler.js";
import { createLockManager } from "./queue/locks.js";
import { createDispatcher } from "./queue/dispatcher.js";
import { createSandboxManager } from "./workers/sandbox.js";
import { createWorkerPool } from "./workers/pool.js";
import { createServer } from "./server.js";
import { createDeployer } from "./projects/deployer.js";
import { createAutoMerger } from "./projects/auto-merge.js";
import { createExecutionPipeline } from "./projects/pipeline.js";
import { createCiGate } from "./projects/ci-gate.js";
import { loadProjectConfig, repoPathFor } from "./projects/project-loader.js";
import { createTeamRouter } from "./projects/team-router.js";
import { createProjectControl } from "./projects/control.js";
import { createHealthChecker } from "./integrations/health.js";
import { createTelemetry } from "./memory/telemetry.js";
import { createSpeedMetrics } from "./memory/speed-metrics.js";
import { createCostLedger } from "./memory/cost-ledger.js";
import { buildProviderPricing } from "./memory/pricing-config.js";
import { createArtifactStore } from "./artifacts/store.js";
import { createRepositoryExplorer } from "./context/repository-explorer.js";
import { createBlastRadiusClassifier } from "./tools/blast-radius.js";
import { createReleaseGate, createTicketWorkflow } from "./queue/ticket-workflow.js";
import { createFailureTriage } from "./policy/failure-triage.js";
import { createAskOncePolicy } from "./policy/ask-once.js";
import { createTieredModelRouter } from "./router/model-tiers.js";
import { createModelProviderRegistry } from "./router/provider-registry.js";
import { createMockModelProvider } from "./router/mock-provider.js";
import { createRouteResolver } from "./router/route-resolver.js";
import { createAdaptiveRouter } from "./router/adaptive-router.js";
import { DEFAULT_EXPERIMENT_CONFIG } from "./router/experiments.js";
import { createProviderHealth } from "./router/provider-health.js";
import { createOutcomeRecorder } from "./memory/outcome-recorder.js";
import { runTicketFlow } from "./queue/ticket-flow.js";
import { buildShippedComment } from "./integrations/run-report.js";
import { createReviewer } from "./queue/reviewer.js";
import { createMemoryCurator } from "./memory/memory-curator.js";
import { createEpicIntake } from "./epic/epic-intake.js";
import { createEpicAtomizer } from "./epic/atomizer.js";
import { createEpicOrchestrator } from "./epic/epic-orchestrator.js";
import { createEpicWorkflow } from "./epic/epic-workflow.js";
import { createEpicDispatch } from "./epic/epic-dispatch.js";
import { createApprovalStore, APPROVAL_TTL_MS } from "./queue/approvals.js";
import type { ApprovalRecord } from "./queue/approvals.js";
import type { JobOutcome, TicketJob } from "./queue/scheduler.js";
import type { DecisionPacket, RiskLevel } from "./artifacts/schemas.js";
import type { ModelProvider } from "./workers/worker.js";
import { createSandbox } from "./sandbox/factory.js";
import { createAgenticProvider } from "./router/providers/agentic.js";
import { createModelAtomizer } from "./epic/model-atomizer.js";
import { createDeepSeekProvider } from "./router/providers/deepseek.js";

const logger = pino({ name: "nightforge-main" });

const mockModelProvider: ModelProvider = createMockModelProvider();

async function main(): Promise<void> {
  logger.info("Starting Nightforge orchestrator");

  if (existsSync(".env")) process.loadEnvFile(".env");
  const config = loadConfig();

  const redis = new Redis(config.redis.url, {
    maxRetriesPerRequest: null,
  });

  redis.on("error", (err: Error) => {
    logger.error({ err }, "Redis connection error");
  });
  redis.on("connect", () => {
    logger.info("Connected to Redis");
  });

  const linearClient = createLinearClient(config.linear.apiKey);
  const scheduler = createScheduler(redis);
  const lockManager = createLockManager(redis);
  const sandboxManager = createSandboxManager(config.paths.worktreesDir);
  const telemetry = createTelemetry(redis);
  const speedMetrics = createSpeedMetrics(redis);

  const costLedger = createCostLedger(redis, buildProviderPricing(config));
  const outcomeRecorder = createOutcomeRecorder({ speedMetrics, telemetry, costLedger, provider: "qwen" });

  const deployer = createDeployer();
  const autoMerger = createAutoMerger();
  const healthChecker = createHealthChecker();
  const ciGate = createCiGate();
  const pipeline = createExecutionPipeline({ deployer, autoMerger, healthChecker, ciGate });

  const artifactStore = createArtifactStore(".nightforge/artifacts");
  const askOnce = createAskOncePolicy(artifactStore);
  const memoryCurator = createMemoryCurator(artifactStore);
  const approvalStore = createApprovalStore(redis);
  const ticketWorkflow = createTicketWorkflow({
    releaseGate: createReleaseGate(createBlastRadiusClassifier()),
    pipeline,
  });

  const tieredRouter = createTieredModelRouter();
  const providerRegistry = createModelProviderRegistry({
    dashscopeApiKey: config.providers.dashscope.apiKey,
    anthropicApiKey: config.providers.anthropic.apiKey,
    openrouterApiKey: config.providers.openrouter.apiKey,
    dashscopeBaseUrl: config.providers.dashscope.baseUrl,
    openrouterBaseUrl: config.providers.openrouter.baseUrl,
  });
  const routeResolver = createRouteResolver({
    tieredRouter,
    adaptiveRouter: createAdaptiveRouter(),
    registry: providerRegistry,
    fallback: mockModelProvider,
    experiments: DEFAULT_EXPERIMENT_CONFIG,
    health: createProviderHealth(),
  });

  const flowDeps = {
    artifactStore,
    explorer: createRepositoryExplorer(),
    workflow: ticketWorkflow,
    reviewer: createReviewer(),
    triage: createFailureTriage(artifactStore),
    askOnce,
    // Model-backed decomposition for complex tickets (DeepSeek v4 flash —
    // cheap). Deterministic structural checks still validate the model's
    // output before any sub-task runs.
    atomizer: createModelAtomizer(
      createDeepSeekProvider({
        apiKey: config.providers.dashscope.apiKey,
        baseUrl: config.providers.dashscope.baseUrl,
        model: "deepseek-v4-flash-0731",
      })
    ),
    orchestrator: createEpicOrchestrator(),
    notifyDecisionPacket: async (packet: DecisionPacket): Promise<void> => {
      await linearClient.postComment(packet.ticketId, `🧭 Decision packet \`${packet.packetId}\` requires input.`);
    },
    resolveModel: (ctx: { riskLevel: RiskLevel; failureCount: number; taskKey: string }): ModelProvider =>
      routeResolver.resolve({ role: "implementer", riskLevel: ctx.riskLevel, failureCount: ctx.failureCount, taskKey: ctx.taskKey }),
    recordRouteOutcome: (ctx: { riskLevel: RiskLevel; failureCount: number; taskKey: string; success: boolean }): void => {
      routeResolver.record({ role: "implementer", riskLevel: ctx.riskLevel, failureCount: ctx.failureCount, taskKey: ctx.taskKey }, ctx.success);
    },
    repoPathForProject: (projectId: string): string => repoPathFor(config.paths.projectsDir, projectId),
    worktreeForJob: (job: TicketJob): string => `${config.paths.worktreesDir}/${job.projectId}-${job.ticketId}`,
  };

  const workerPool = createWorkerPool(
    sandboxManager,
    config.paths.projectsDir,
    90,
    {
      // A held ticket's worktree must survive until the human approves or
      // the record expires — the release re-run deploys from the same tree.
      shouldKeepWorktree: (job: TicketJob): Promise<boolean> =>
        approvalStore.get(job.ticketId).then((record) => record !== null),
      // OS-level sandbox keeps generated validation/test code from touching
      // the host or production systems.
      sandbox: createSandbox(config.sandbox),
      // Opt-in agentic (tool-use) path, enabled per ticket via the "agentic"
      // label. Uses the DashScope token-plan endpoint — no extra credentials.
      agenticProvider: createAgenticProvider({
        apiKey: config.providers.dashscope.apiKey,
        baseUrl: config.providers.dashscope.baseUrl,
        model: config.providers.dashscope.model,
      }),
      maxAgenticIterations: config.limits.maxAgenticIterations,
      executionModeConfig: {
        autoRoute: config.executionMode.autoRoute,
        agenticThreshold: config.executionMode.agenticThreshold,
      },
    }
  );

  const runJob = async (job: TicketJob): Promise<JobOutcome> => {
    const startTime = Date.now();
    const log = logger.child({ ticketId: job.ticketId, projectId: job.projectId });
    log.info("Processing job");

    const projectConfig = loadProjectConfig(config.paths.projectsDir, job.projectId);

    const flow = await runTicketFlow(
      job,
      projectConfig,
      mockModelProvider,
      workerPool,
      flowDeps
    );
    const result = flow.workerResult;
    const outcome = flow.outcome;

    const agentDurationMs = Date.now() - startTime;

    if (!result.success) {
      await linearClient.postComment(job.ticketId, `❌ Failed: ${result.summary}`);

      await speedMetrics.record({
        ticketId: job.ticketId,
        projectId: job.projectId,
        totalDurationMs: Date.now() - startTime,
        agentDurationMs,
        pipelineDurationMs: 0,
        costUsd: result.costUsd,
        success: false,
        humanTouched: false,
        timestamp: Date.now(),
      });
      return { success: false, summary: result.summary };
    }

    const shipped = outcome !== null && outcome.state === "shipped";
    const pipelineDurationMs = outcome?.pipeline?.durationMs ?? 0;

    if (outcome !== null && outcome.state === "awaiting_approval") {
      const record: ApprovalRecord = {
        job,
        contract: flow.contract,
        worktreePath: flowDeps.worktreeForJob(job),
        summary: result.summary,
        riskReason: outcome.gate.reason,
        createdAt: Date.now(),
        expiresAt: Date.now() + APPROVAL_TTL_MS,
      };
      await approvalStore.save(record);
      await linearClient.postComment(
        job.ticketId,
        `⏸ Awaiting one approval: ${outcome.gate.reason}\nReply with \`/approve\` on this ticket to grant the release.`
      );
    } else if (shipped) {
      await linearClient.postComment(
        job.ticketId,
        buildShippedComment({
          summary: result.summary,
          filesChanged: result.filesChanged,
          model: result.model ?? projectConfig.agent.defaultModel,
          tokensUsed: result.tokensUsed,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          costUsd: result.costUsd,
          durationMs: Date.now() - startTime,
          pipeline: outcome.pipeline ?? null,
        })
      );
    } else {
      // Released failed or was blocked — auto-reverted where possible
      await linearClient.postComment(
        job.ticketId,
        `⏪ Not shipped: ${outcome?.message ?? "release blocked"}`
      );
    }

    if (shipped) {
      await memoryCurator.propose({ projectId: job.projectId, ticketId: job.ticketId, category: "shipped-ticket", content: result.summary });
    }

    await outcomeRecorder.record({
      ticketId: job.ticketId,
      projectId: job.projectId,
      model: result.model ?? projectConfig.agent.defaultModel,
      totalDurationMs: Date.now() - startTime,
      agentDurationMs,
      pipelineDurationMs,
      costUsd: result.costUsd,
      tokensUsed: result.tokensUsed,
      shipped,
    });
    return { success: shipped, summary: result.summary };
  };

  /**
   * Release-only re-run after a human `/approve` reply on the Linear ticket.
   * The held worktree still exists; the release stage deploys from it with
   * the approval flag set. Notifications are guarded so a transient comment
   * failure never re-runs an already-granted release.
   */
  const runApprovalRelease = async (job: TicketJob): Promise<JobOutcome> => {
    const log = logger.child({ ticketId: job.ticketId, projectId: job.projectId });
    const record = await approvalStore.get(job.ticketId);
    if (record === null) {
      log.warn("No approval record found for approved ticket");
      return { success: false, summary: "Approval record expired or missing" };
    }

    const projectConfig = loadProjectConfig(config.paths.projectsDir, job.projectId);
    const outcome = await ticketWorkflow.runReleaseStage(
      job.ticketId,
      record.contract,
      projectConfig,
      record.worktreePath,
      record.summary,
      { humanApproved: true }
    );

    // The release is decided; removing the record lets releaseTicket clean up.
    await approvalStore.remove(job.ticketId);

    const shipped = outcome.state === "shipped";
    if (shipped) {
      log.info({ state: outcome.state }, "Approved release shipped");
    } else {
      log.warn(
        { state: outcome.state, message: outcome.message },
        "Approved release did not ship"
      );
    }
    try {
      await linearClient.postComment(
        job.ticketId,
        shipped
          ? `✅ Approved and shipped: ${outcome.message}`
          : `⏪ Approval release did not ship: ${outcome.message}`
      );
    } catch (err) {
      log.warn({ err }, "Could not post approval result comment");
    }
    return { success: shipped, summary: outcome.message };
  };

  // The sandbox worktree must outlive implementation — the release stage
  // commits, merges, and deploys from it — so cleanup happens last.
  const handleJob = async (job: TicketJob): Promise<JobOutcome> => {
    if (job.approvalGranted === true) {
      return runApprovalRelease(job).finally(() => workerPool.releaseTicket(job));
    }
    return runJob(job).finally(() => workerPool.releaseTicket(job));
  };

  const dispatcher = createDispatcher(
    redis,
    lockManager,
    handleJob,
    config.limits.maxConcurrentWorkers
  );

  dispatcher.start();

  // Sweep stale approvals on boot: expired records release their worktrees.
  {
    const stale = await approvalStore.list();
    const now = Date.now();
    for (const { ticketId } of stale) {
      const record = await approvalStore.get(ticketId);
      if (record === null || record.expiresAt > now) {
        continue;
      }
      await approvalStore.remove(ticketId);
      await rm(record.worktreePath, { recursive: true, force: true }).catch(
        (err: unknown) => {
          logger.warn(
            { ticketId, err },
            "Could not clean expired approval worktree"
          );
        }
      );
      logger.info({ ticketId }, "Expired approval record swept");
    }
  }

  // Orphaned worktrees (records already expired out of Redis) are removed by
  // age — a held or running sandbox is always younger than the TTL.
  {
    const cutoff = Date.now() - APPROVAL_TTL_MS;
    try {
      const entries = await readdir(config.paths.worktreesDir);
      for (const entry of entries) {
        const fullPath = path.join(config.paths.worktreesDir, entry);
        try {
          const info = await stat(fullPath);
          if (info.isDirectory() && info.mtimeMs < cutoff) {
            await rm(fullPath, { recursive: true, force: true });
            logger.info({ worktree: fullPath }, "Stale worktree swept");
          }
        } catch {
          // Removed by a concurrent cleanup; ignore.
        }
      }
    } catch {
      // Worktrees dir may not exist yet — nothing to sweep.
    }
  }

  const server = createServer({
    linearClient,
    scheduler,
    webhookSecret: config.linear.webhookSecret,
    projectId: config.projectId,
    teamRouter: createTeamRouter(config.paths.projectsDir),
    projectControl: createProjectControl({
      linearClient,
      projectsDir: config.paths.projectsDir,
      publicBaseUrl: config.control.publicBaseUrl,
      webhookSecret: config.linear.webhookSecret,
      defaultProjectId: config.projectId,
    }),
    controlTeam: config.control.team,
    approvalStore,
    epicDispatch: createEpicDispatch({
      intake: createEpicIntake(),
      workflow: createEpicWorkflow({ atomizer: createEpicAtomizer(), orchestrator: createEpicOrchestrator() }),
      linearClient,
      scheduler,
      projectId: config.projectId,
    }),
  });

  await server.listen({ port: config.server.port, host: config.server.host });
  logger.info(
    { port: config.server.port, host: config.server.host },
    "Server listening"
  );

  const shutdown = async (): Promise<void> => {
    logger.info("Shutdown signal received");
    const stages: Array<[string, () => Promise<unknown>]> = [
      ["Server closed", (): Promise<unknown> => server.close()],
      ["Dispatcher stopped", (): Promise<unknown> => dispatcher.stop()],
      ["Worker pool shut down", (): Promise<unknown> => workerPool.shutdown()],
      ["Scheduler closed", (): Promise<unknown> => scheduler.close()],
      ["Redis connection closed", (): Promise<unknown> => redis.quit()],
    ];
    for (const [message, stop] of stages) {
      await stop();
      logger.info(message);
    }
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
}

main().catch((err: unknown) => {
  logger.error({ err }, "Fatal error during startup");
  process.exit(1);
});
