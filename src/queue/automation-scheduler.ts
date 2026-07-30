import { Queue } from "bullmq";
import type { Redis } from "ioredis";
import pino from "pino";
import { QUEUE_NAME, type TicketJob, type AutomationSchedule } from "./scheduler.js";

const logger = pino({ name: "nightforge-automation-scheduler" });

/** Maps simple interval names to cron expressions */
const INTERVAL_TO_CRON: Record<string, string> = {
  hourly: "0 * * * *",
  daily: "0 9 * * *",
  weekly: "0 9 * * 1",
  monthly: "0 9 1 * *",
};

const DEFAULT_CRON = "0 9 * * *";

export interface AutomationScheduler {
  /** Register a recurring automation job */
  registerAutomation(job: TicketJob, schedule: AutomationSchedule): Promise<string>;
  /** Remove a recurring automation */
  removeAutomation(jobId: string): Promise<void>;
  /** List all registered automations */
  listAutomations(): Promise<Array<{ id: string; job: TicketJob; nextRun?: number }>>;
  /** Pause/resume an automation */
  setEnabled(jobId: string, enabled: boolean): Promise<void>;
  close(): Promise<void>;
}

export function createAutomationScheduler(redis: Redis): AutomationScheduler {
  const queue = new Queue(QUEUE_NAME, { connection: redis });

  function resolveCron(schedule: AutomationSchedule): string {
    if (schedule.cron) return schedule.cron;
    if (schedule.every) return INTERVAL_TO_CRON[schedule.every] ?? DEFAULT_CRON;
    return DEFAULT_CRON;
  }

  return {
    async registerAutomation(job: TicketJob, schedule: AutomationSchedule): Promise<string> {
      const cron = resolveCron(schedule);
      const jobId = `auto-${job.projectId}-${job.ticketId}`;

      await queue.add("process-ticket", job, {
        jobId,
        priority: job.priority,
        repeat: {
          pattern: cron,
          tz: schedule.timezone ?? "UTC",
        },
        removeOnComplete: { age: 24 * 3600, count: 100 },
        removeOnFail: { age: 7 * 24 * 3600 },
      });

      logger.info(
        { jobId, ticketId: job.ticketId, cron, timezone: schedule.timezone },
        "Automation registered"
      );

      return jobId;
    },

    async removeAutomation(jobId: string): Promise<void> {
      const schedulers = await queue.getJobSchedulers();
      const target = schedulers.find((j) => j.id === jobId);

      if (target?.id) {
        await queue.removeJobScheduler(target.id);
        logger.info({ jobId }, "Automation removed");
      } else {
        logger.warn({ jobId }, "Automation not found for removal");
      }
    },

    async listAutomations(): Promise<Array<{ id: string; job: TicketJob; nextRun?: number }>> {
      const schedulers = await queue.getJobSchedulers();

      return schedulers
        .filter((j): j is typeof j & { id: string } => typeof j.id === "string" && j.id.startsWith("auto-"))
        .map((j) => ({
          id: j.id,
          job: { ticketId: j.id.replace("auto-", ""), projectId: "", title: "", description: "", labels: [], priority: 5, attempt: 1 } satisfies TicketJob,
          nextRun: j.next,
        }));
    },

    async setEnabled(jobId: string, enabled: boolean): Promise<void> {
      if (!enabled) {
        await this.removeAutomation(jobId);
        logger.info({ jobId }, "Automation disabled (removed from schedule)");
      } else {
        logger.info({ jobId }, "Automation enabled (re-register with schedule to activate)");
      }
    },

    async close(): Promise<void> {
      await queue.close();
      logger.info("Automation scheduler closed");
    },
  };
}
