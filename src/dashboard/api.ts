import type { FastifyInstance } from "fastify";
import pino from "pino";
import type { Scheduler } from "../queue/scheduler.js";
import type { Telemetry } from "../memory/telemetry.js";
import type { WorkerPool } from "../workers/pool.js";
import type { SpeedMetrics } from "../memory/speed-metrics.js";
import type { CostLedger } from "../memory/cost-ledger.js";
import { getDefaultRules } from "../tools/blast-radius.js";

const logger = pino({ name: "nightforge-dashboard" });

export interface DashboardDeps {
  scheduler: Scheduler;
  telemetry: Telemetry;
  workerPool: WorkerPool;
  speedMetrics: SpeedMetrics;
  costLedger: CostLedger;
  maxDailyBudgetUsd: number;
}

export function registerDashboardRoutes(
  server: FastifyInstance,
  deps: DashboardDeps
): void {
  /** Master status: everything at a glance */
  server.get("/api/status", async () => {
    const [queueStats, dailySpend, budgetPercent, speed, streak] =
      await Promise.all([
        deps.scheduler.getQueueStats(),
        deps.telemetry.getDailySpend(),
        deps.telemetry.getBudgetUsagePercent(deps.maxDailyBudgetUsd),
        deps.speedMetrics.getSummary(),
        deps.speedMetrics.getStreak(),
      ]);

    return {
      status: "ok",
      uptime: process.uptime(),
      queue: queueStats,
      workers: {
        active: deps.workerPool.getActiveWorkers(),
      },
      budget: {
        dailySpend,
        maxDaily: deps.maxDailyBudgetUsd,
        percentUsed: budgetPercent,
      },
      speed: {
        completedToday: speed.completedToday,
        autonomousToday: speed.autonomousToday,
        medianDurationMs: speed.medianDurationMs,
        p95DurationMs: speed.p95DurationMs,
        avgCostUsd: speed.avgCostUsd,
        successRate: speed.successRate,
        autonomyRate: speed.autonomyRate,
        streak,
      },
    };
  });

  /** Budget details */
  server.get("/api/budget", async () => {
    const [dailySpend, budgetPercent, isExceeded] = await Promise.all([
      deps.telemetry.getDailySpend(),
      deps.telemetry.getBudgetUsagePercent(deps.maxDailyBudgetUsd),
      deps.telemetry.isBudgetExceeded(deps.maxDailyBudgetUsd),
    ]);

    return {
      dailySpend,
      maxDaily: deps.maxDailyBudgetUsd,
      percentUsed: budgetPercent,
      isExceeded,
    };
  });

  /** Queue stats */
  server.get("/api/queue", async () => {
    const stats = await deps.scheduler.getQueueStats();
    return stats;
  });

  /** Speed metrics: the vital signs of autonomous execution */
  server.get("/api/speed", async () => {
    const [summary, streak, recent] = await Promise.all([
      deps.speedMetrics.getSummary(),
      deps.speedMetrics.getStreak(),
      deps.speedMetrics.getRecent(20),
    ]);

    return { summary, streak, recent };
  });

  /** Recent ticket execution history */
  server.get("/api/history", async () => {
    const recent = await deps.speedMetrics.getRecent(50);
    return { tickets: recent };
  });

  /** Blast radius rules (transparency: what's auto vs gated) */
  server.get("/api/blast-radius-rules", () => {
    const rules = getDefaultRules();
    return {
      rules: rules.map((r) => ({
        pattern: r.pattern,
        radius: r.radius,
        reason: r.reason,
      })),
    };
  });

  /** Cost ledger: per-provider breakdown, plan status, daily totals */
  server.get("/api/costs", async () => {
    const [providers, dailyTotal] = await Promise.all([
      deps.costLedger.getProviderSummaries(),
      deps.costLedger.getDailyTotal(),
    ]);

    return { dailyTotal, providers };
  });

  /** Token plan status (Alibaba-style prepaid plans) */
  server.get("/api/costs/plan/:provider", async (request) => {
    const { provider } = request.params as { provider: string };
    const status = await deps.costLedger.getPlanStatus(provider);

    if (!status) {
      return { error: `Provider "${provider}" is not on a token plan` };
    }

    return status;
  });

  /** Per-ticket cost breakdown */
  server.get("/api/costs/ticket/:ticketId", async (request) => {
    const { ticketId } = request.params as { ticketId: string };
    const breakdown = await deps.costLedger.getTicketBreakdown(ticketId);
    return breakdown;
  });

  logger.info("Dashboard routes registered");
}
