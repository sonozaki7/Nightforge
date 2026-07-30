import type { Redis } from "ioredis";
import pino from "pino";

const logger = pino({ name: "nightforge-telemetry" });

const DAILY_SPEND_KEY = "nightforge:daily-spend:";
const TICKET_COST_KEY = "nightforge:ticket-cost:";

export interface TicketCostRecord {
  ticketId: string;
  projectId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  durationMs: number;
  success: boolean;
  timestamp: number;
}

export interface Telemetry {
  recordTicketCost(record: TicketCostRecord): Promise<void>;
  getDailySpend(date?: Date): Promise<number>;
  getTicketCost(ticketId: string): Promise<number>;
  isBudgetExceeded(maxDailyBudgetUsd: number): Promise<boolean>;
  getBudgetUsagePercent(maxDailyBudgetUsd: number): Promise<number>;
}

function getDateKey(date: Date): string {
  return date.toISOString().split("T")[0] ?? "";
}

export function createTelemetry(redis: Redis): Telemetry {
  return {
    async recordTicketCost(record: TicketCostRecord): Promise<void> {
      const dateKey = getDateKey(new Date(record.timestamp));
      const dailyKey = `${DAILY_SPEND_KEY}${dateKey}`;
      const ticketKey = `${TICKET_COST_KEY}${record.ticketId}`;

      await redis.incrbyfloat(dailyKey, record.costUsd);
      await redis.incrbyfloat(ticketKey, record.costUsd);

      await redis.expire(dailyKey, 7 * 24 * 3600);
      await redis.expire(ticketKey, 30 * 24 * 3600);

      logger.info(
        {
          ticketId: record.ticketId,
          model: record.model,
          costUsd: record.costUsd,
          success: record.success,
        },
        "Ticket cost recorded"
      );
    },

    async getDailySpend(date?: Date): Promise<number> {
      const targetDate = date ?? new Date();
      const dateKey = getDateKey(targetDate);
      const dailyKey = `${DAILY_SPEND_KEY}${dateKey}`;
      const spend = await redis.get(dailyKey);
      return spend ? parseFloat(spend) : 0;
    },

    async getTicketCost(ticketId: string): Promise<number> {
      const ticketKey = `${TICKET_COST_KEY}${ticketId}`;
      const cost = await redis.get(ticketKey);
      return cost ? parseFloat(cost) : 0;
    },

    async isBudgetExceeded(maxDailyBudgetUsd: number): Promise<boolean> {
      const dailySpend = await this.getDailySpend();
      return dailySpend >= maxDailyBudgetUsd;
    },

    async getBudgetUsagePercent(maxDailyBudgetUsd: number): Promise<number> {
      const dailySpend = await this.getDailySpend();
      if (maxDailyBudgetUsd === 0) return 100;
      return (dailySpend / maxDailyBudgetUsd) * 100;
    },
  };
}
