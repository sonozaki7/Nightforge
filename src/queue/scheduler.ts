import { Queue, QueueEvents } from "bullmq";
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
  /** True when this job is a release-only re-run after a human `/approve`. */
  approvalGranted?: boolean;
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

/** Terminal outcome of one ticket job, reported back to callers that wait. */
export interface JobOutcome {
  success: boolean;
  summary: string;
}

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
  /** Enqueue and wait for the terminal outcome (used by the epic executor). */
  enqueueAndWait(job: TicketJob): Promise<JobOutcome>;
  getQueueStats(): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
  }>;
  close(): Promise<void>;
}

export function createScheduler(redis: Redis): Scheduler {
  const queue = new Queue<TicketJob, JobOutcome | undefined>(QUEUE_NAME, {
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

  const events = new QueueEvents(QUEUE_NAME, { connection: redis });

  const jobOptions = (
    job: TicketJob
  ): { priority: number; jobId: string } => ({
    priority: job.priority,
    // A fresh id per trigger: BullMQ silently ignores an add when a job with
    // the same id already exists (completed jobs linger for 24h), so a
    // re-triggered ticket would never run again without the suffix.
    jobId: `${job.projectId}-${job.ticketId}-${String(job.attempt)}-${Date.now().toString(36)}`,
  });

  return {
    async enqueue(job: TicketJob): Promise<string> {
      const bullJob = await queue.add("process-ticket", job, jobOptions(job));

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

    async enqueueAndWait(job: TicketJob): Promise<JobOutcome> {
      const bullJob = await queue.add("process-ticket", job, jobOptions(job));
      try {
        const result = await bullJob.waitUntilFinished(events);
        return result ?? { success: true, summary: "completed" };
      } catch (error: unknown) {
        return {
          success: false,
          summary: error instanceof Error ? error.message : String(error),
        };
      }
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
      await events.close();
      await queue.close();
      logger.info("Scheduler closed");
    },
  };
}
