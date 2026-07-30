import type { Redis } from "ioredis";
import pino from "pino";

const logger = pino({ name: "nightforge-speed-metrics" });

const METRICS_KEY = "nightforge:speed:";
const HISTORY_KEY = "nightforge:speed-history:";

export interface TicketMetric {
  ticketId: string;
  projectId: string;
  /** Total time from enqueue to "done" (shipped or rolled_back) in ms */
  totalDurationMs: number;
  /** Time spent in the agent loop (implementation) */
  agentDurationMs: number;
  /** Time spent in pipeline (merge + deploy + verify) */
  pipelineDurationMs: number;
  costUsd: number;
  success: boolean;
  /** Whether human intervention was needed */
  humanTouched: boolean;
  timestamp: number;
}

export interface SpeedSummary {
  /** Total tickets completed today */
  completedToday: number;
  /** Total tickets that shipped without human touch */
  autonomousToday: number;
  /** Median ticket→done time in ms */
  medianDurationMs: number;
  /** P95 ticket→done time in ms */
  p95DurationMs: number;
  /** Average cost per ticket in USD */
  avgCostUsd: number;
  /** Success rate (0-1) */
  successRate: number;
  /** Percentage that shipped without human intervention (0-1) */
  autonomyRate: number;
  /** Total spend today */
  totalSpendToday: number;
}

export interface SpeedMetrics {
  record(metric: TicketMetric): Promise<void>;
  getSummary(projectId?: string): Promise<SpeedSummary>;
  getRecent(limit: number, projectId?: string): Promise<TicketMetric[]>;
  getStreak(): Promise<{ current: number; best: number }>;
}

function getDateKey(date: Date): string {
  return date.toISOString().split("T")[0] ?? "";
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)] ?? 0;
}

export function createSpeedMetrics(redis: Redis): SpeedMetrics {
  return {
    async record(metric: TicketMetric): Promise<void> {
      const dateKey = getDateKey(new Date(metric.timestamp));
      const dayKey = `${METRICS_KEY}${dateKey}`;
      const historyKey = `${HISTORY_KEY}${metric.projectId}`;

      const serialized = JSON.stringify(metric);

      // Store in daily sorted set (score = timestamp)
      await redis.zadd(dayKey, metric.timestamp, serialized);
      await redis.expire(dayKey, 30 * 24 * 3600);

      // Store in per-project history (last 500)
      await redis.zadd(historyKey, metric.timestamp, serialized);
      await redis.zremrangebyrank(historyKey, 0, -501);
      await redis.expire(historyKey, 90 * 24 * 3600);

      // Track autonomous streak
      if (metric.success && !metric.humanTouched) {
        await redis.incr(`${METRICS_KEY}streak:current`);
        const current = parseInt(
          (await redis.get(`${METRICS_KEY}streak:current`)) ?? "0",
          10
        );
        const best = parseInt(
          (await redis.get(`${METRICS_KEY}streak:best`)) ?? "0",
          10
        );
        if (current > best) {
          await redis.set(`${METRICS_KEY}streak:best`, String(current));
        }
      } else if (!metric.success) {
        await redis.set(`${METRICS_KEY}streak:current`, "0");
      }

      logger.info(
        {
          ticketId: metric.ticketId,
          durationMs: metric.totalDurationMs,
          costUsd: metric.costUsd,
          success: metric.success,
          autonomous: !metric.humanTouched,
        },
        "Speed metric recorded"
      );
    },

    async getSummary(projectId?: string): Promise<SpeedSummary> {
      const dateKey = getDateKey(new Date());
      const dayKey = `${METRICS_KEY}${dateKey}`;

      const entries = await redis.zrange(dayKey, 0, -1);
      const metrics = entries
        .map((e) => JSON.parse(e) as TicketMetric)
        .filter((m) => !projectId || m.projectId === projectId);

      if (metrics.length === 0) {
        return {
          completedToday: 0,
          autonomousToday: 0,
          medianDurationMs: 0,
          p95DurationMs: 0,
          avgCostUsd: 0,
          successRate: 0,
          autonomyRate: 0,
          totalSpendToday: 0,
        };
      }

      const durations = metrics
        .map((m) => m.totalDurationMs)
        .sort((a, b) => a - b);
      const successes = metrics.filter((m) => m.success);
      const autonomous = metrics.filter((m) => m.success && !m.humanTouched);
      const totalCost = metrics.reduce((sum, m) => sum + m.costUsd, 0);

      return {
        completedToday: metrics.length,
        autonomousToday: autonomous.length,
        medianDurationMs: percentile(durations, 50),
        p95DurationMs: percentile(durations, 95),
        avgCostUsd: totalCost / metrics.length,
        successRate: successes.length / metrics.length,
        autonomyRate: autonomous.length / metrics.length,
        totalSpendToday: totalCost,
      };
    },

    async getRecent(limit: number, projectId?: string): Promise<TicketMetric[]> {
      const historyKey = projectId
        ? `${HISTORY_KEY}${projectId}`
        : `${HISTORY_KEY}*`;

      if (projectId) {
        const entries = await redis.zrange(historyKey, -limit, -1);
        return entries.map((e) => JSON.parse(e) as TicketMetric).reverse();
      }

      // Cross-project: scan all project histories
      const keys = await redis.keys(`${HISTORY_KEY}*`);
      const allMetrics: TicketMetric[] = [];

      for (const key of keys) {
        const entries = await redis.zrange(key, -limit, -1);
        allMetrics.push(
          ...entries.map((e) => JSON.parse(e) as TicketMetric)
        );
      }

      return allMetrics
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, limit);
    },

    async getStreak(): Promise<{ current: number; best: number }> {
      const [current, best] = await Promise.all([
        redis.get(`${METRICS_KEY}streak:current`),
        redis.get(`${METRICS_KEY}streak:best`),
      ]);

      return {
        current: parseInt(current ?? "0", 10),
        best: parseInt(best ?? "0", 10),
      };
    },
  };
}
