import { Queue } from "bullmq";
import type { Redis } from "ioredis";
import pino from "pino";

const logger = pino({ name: "nightforge-scheduler" });

export const QUEUE_NAME = "nightforge-tickets";

export interface TicketJob {
  ticketId: string;
  projectId: string;
  title: string;
  description: string;
  labels: string[];
  priority: number;
  attempt: number;
  /** Execution mode: "automation" (routine/recurring) or "ticket" (problem to solve) */
  mode?: "automation" | "ticket";
  /** Effort level: controls execution intensity (default: resolved from labels) */
  effort?: "high" | "xhigh" | "max";
  /** Automation schedule (only for recurring automations) */
  schedule?: AutomationSchedule;
}

/** Schedule configuration for recurring automations */
export interface AutomationSchedule {
  /** Cron expression (e.g. "0 9 * * 1" = every Monday 9am) */
  cron?: string;
  /** Simple interval alternative */
  every?: "hourly" | "daily" | "weekly" | "monthly";
  /** Timezone for schedule (default from config) */
  timezone?: string;
  /** Whether the automation is currently active */
  enabled: boolean;
}

export type TicketPriority = "urgent" | "high" | "normal" | "low";

const PRIORITY_MAP: Record<TicketPriority, number> = {
  urgent: 1,
  high: 2,
  normal: 5,
  low: 10,
};

export function mapPriority(priority: TicketPriority): number {
  return PRIORITY_MAP[priority];
}

export function linearPriorityToNightforge(
  linearPriority: number
): TicketPriority {
  if (linearPriority === 1) return "urgent";
  if (linearPriority === 2) return "high";
  if (linearPriority === 3) return "normal";
  return "low";
}

export interface Scheduler {
  enqueue(job: TicketJob): Promise<string>;
  getQueueStats(): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
  }>;
  close(): Promise<void>;
}

export function createScheduler(redis: Redis): Scheduler {
  const queue = new Queue(QUEUE_NAME, {
    connection: redis,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 5000,
      },
      removeOnComplete: {
        age: 24 * 3600,
        count: 1000,
      },
      removeOnFail: {
        age: 7 * 24 * 3600,
      },
    },
  });

  return {
    async enqueue(job: TicketJob): Promise<string> {
      const bullJob = await queue.add("process-ticket", job, {
        priority: job.priority,
        jobId: `${job.projectId}-${job.ticketId}-${String(job.attempt)}`,
      });

      logger.info(
        {
          ticketId: job.ticketId,
          projectId: job.projectId,
          priority: job.priority,
          jobId: bullJob.id,
        },
        "Ticket enqueued"
      );

      return bullJob.id ?? "";
    },

    async getQueueStats(): Promise<{
      waiting: number;
      active: number;
      completed: number;
      failed: number;
    }> {
      const [waiting, active, completed, failed] = await Promise.all([
        queue.getWaitingCount(),
        queue.getActiveCount(),
        queue.getCompletedCount(),
        queue.getFailedCount(),
      ]);

      return { waiting, active, completed, failed };
    },

    async close(): Promise<void> {
      await queue.close();
      logger.info("Scheduler closed");
    },
  };
}
