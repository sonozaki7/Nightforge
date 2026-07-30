import { Redis } from "ioredis";
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
import { createHealthChecker } from "./integrations/health.js";
import { createTelemetry } from "./memory/telemetry.js";
import { createSpeedMetrics } from "./memory/speed-metrics.js";
import { createCostLedger, type ProviderPricing } from "./memory/cost-ledger.js";
import { createTelegramBot } from "./integrations/telegram.js";
import type { TicketJob } from "./queue/scheduler.js";
import type { ModelProvider } from "./workers/worker.js";

const logger = pino({ name: "nightforge-main" });

const mockModelProvider: ModelProvider = {
  generate(prompt: string) {
    logger.info({ promptLength: prompt.length }, "Mock model called");
    return Promise.resolve({
      content: "// Mock implementation",
      tokensUsed: 100,
      costUsd: 0.01,
    });
  },
};

async function main(): Promise<void> {
  logger.info("Starting Nightforge orchestrator");

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

  // Core services
  const linearClient = createLinearClient(config.linear.apiKey);
  const scheduler = createScheduler(redis);
  const lockManager = createLockManager(redis);
  const sandboxManager = createSandboxManager(config.paths.worktreesDir);
  const telemetry = createTelemetry(redis);
  const speedMetrics = createSpeedMetrics(redis);
  const telegram = createTelegramBot(config.telegram.botToken, config.telegram.chatId);

  // Unified cost ledger: tracks per-ticket, per-provider costs
  const providerPricing: Record<string, ProviderPricing> = {
    qwen: {
      model: "token-plan",
      planPriceUsd: config.costLedger.alibabaPlanPriceUsd,
      planTotalTokens: config.costLedger.alibabaPlanTokens,
      baselineUsedTokens: config.costLedger.alibabaBaselineUsed,
      cachedTokenWeight: config.costLedger.alibabaCachedWeight,
      cacheHitRatio: config.costLedger.alibabaCacheHitRatio,
    },
    claude: {
      model: "pay-per-use",
      costPerMillionInput: 5.0,
      costPerMillionOutput: 25.0,
      cachedInputMultiplier: 0.1,
    },
    hermes: {
      model: "pay-per-use",
      costPerMillionInput: 0.13,
      costPerMillionOutput: 0.4,
    },
  };
  const costLedger = createCostLedger(redis, providerPricing);

  // Pipeline: merge → deploy → verify → ship (or auto-revert)
  const deployer = createDeployer();
  const autoMerger = createAutoMerger();
  const healthChecker = createHealthChecker();
  const pipeline = createExecutionPipeline({ deployer, autoMerger, healthChecker });

  const workerPool = createWorkerPool(
    sandboxManager,
    config.paths.projectsDir,
    90
  );

  const handleJob = async (job: TicketJob): Promise<void> => {
    const startTime = Date.now();
    const log = logger.child({ ticketId: job.ticketId, projectId: job.projectId });
    log.info("Processing job");

    await telegram.notifyTicketStarted(job.ticketId, job.title);

    const projectConfig = {
      id: job.projectId,
      name: job.projectId,
      path: config.paths.projectsDir,
      deployment: {
        policy: "direct-prod" as const,
        testCommand: "npm test",
        lintCommand: "npm run lint",
        typecheckCommand: "npx tsc --noEmit",
        buildCommand: "npm run build",
        deployCommand: "echo deploy",
        healthcheckCommand: "echo health",
        rollbackCommand: "echo rollback",
      },
      concurrency: { maxWriteTasks: 1, maxReadonlyTasks: 3 },
      agent: {
        defaultModel: "qwen3.8",
        maxAttempts: 3,
        maxRuntimeMinutes: 90,
        maxTicketCostUsd: 8,
      },
      permissions: { allowedServices: [], prohibitedActions: [] },
      risk: { approvalRequiredFor: [] },
    };

    // Step 1: Agent implements the ticket in an isolated worktree
    const result = await workerPool.processTicket(
      job,
      projectConfig,
      mockModelProvider
    );

    const agentDurationMs = Date.now() - startTime;

    if (!result.success) {
      // Agent failed — notify and record
      await telegram.notifyTicketFailed(job.ticketId, job.title, result.summary);
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
      return;
    }

    // Step 2: Pipeline — auto-merge → deploy → verify → ship
    // No PR. No review. Tests passed = ship it.
    const pipelineResult = await pipeline.execute(
      config.paths.worktreesDir + `/${job.projectId}-${job.ticketId}`,
      projectConfig,
      job.ticketId,
      result.summary
    );

    const pipelineDurationMs = pipelineResult.durationMs;

    if (pipelineResult.success) {
      await telegram.notifyTicketCompleted(
        job.ticketId,
        job.title,
        result.costUsd
      );
      await linearClient.postComment(
        job.ticketId,
        `✅ Shipped: ${result.summary}\n\n` +
        `Pipeline: ${pipelineResult.message}\n` +
        `Tokens: ${String(result.tokensUsed)} | Cost: $${result.costUsd.toFixed(4)} | ` +
        `Duration: ${String(Math.round((Date.now() - startTime) / 1000))}s`
      );
    } else {
      // Pipeline failed — auto-reverted, notify human
      await telegram.notifyRolledBack(job.ticketId, job.title);
      await linearClient.postComment(
        job.ticketId,
        `⏪ Rolled back: ${pipelineResult.message}`
      );
    }

    // Record speed metric
    await speedMetrics.record({
      ticketId: job.ticketId,
      projectId: job.projectId,
      totalDurationMs: Date.now() - startTime,
      agentDurationMs,
      pipelineDurationMs,
      costUsd: result.costUsd,
      success: pipelineResult.success,
      humanTouched: false,
      timestamp: Date.now(),
    });

    // Record cost telemetry
    await telemetry.recordTicketCost({
      ticketId: job.ticketId,
      projectId: job.projectId,
      model: projectConfig.agent.defaultModel,
      inputTokens: 0,
      outputTokens: result.tokensUsed,
      costUsd: result.costUsd,
      durationMs: Date.now() - startTime,
      success: pipelineResult.success,
      timestamp: Date.now(),
    });

    // Record in unified cost ledger (per-provider tracking)
    await costLedger.record(
      {
        provider: "qwen",
        model: projectConfig.agent.defaultModel,
        inputTokens: 0,
        outputTokens: result.tokensUsed,
      },
      job.ticketId
    );
  };

  const dispatcher = createDispatcher(
    redis,
    lockManager,
    handleJob,
    config.limits.maxConcurrentWorkers
  );

  dispatcher.start();

  const server = createServer({
    linearClient,
    scheduler,
    webhookSecret: config.linear.webhookSecret,
    projectId: "default",
  });

  await server.listen({ port: config.server.port, host: config.server.host });
  logger.info(
    { port: config.server.port, host: config.server.host },
    "Server listening"
  );

  const shutdown = async (): Promise<void> => {
    logger.info("Shutdown signal received");

    await server.close();
    logger.info("Server closed");

    await dispatcher.stop();
    logger.info("Dispatcher stopped");

    await workerPool.shutdown();
    logger.info("Worker pool shut down");

    await scheduler.close();
    logger.info("Scheduler closed");

    await redis.quit();
    logger.info("Redis connection closed");

    process.exit(0);
  };

  process.on("SIGTERM", () => {
    void shutdown();
  });

  process.on("SIGINT", () => {
    void shutdown();
  });
}

main().catch((err: unknown) => {
  logger.error({ err }, "Fatal error during startup");
  process.exit(1);
});
