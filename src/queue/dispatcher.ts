import { Worker } from "bullmq";
import type { Job } from "bullmq";
import type { Redis } from "ioredis";
import pino from "pino";
import { QUEUE_NAME, type TicketJob } from "./scheduler.js";
import type { LockManager } from "./locks.js";

const logger = pino({ name: "nightforge-dispatcher" });

export type JobHandler = (job: TicketJob) => Promise<void>;

export interface Dispatcher {
  start(): void;
  stop(): Promise<void>;
  getActiveCount(): number;
}

export function createDispatcher(
  redis: Redis,
  lockManager: LockManager,
  handler: JobHandler,
  concurrency: number
): Dispatcher {
  let activeCount = 0;

  const worker = new Worker(
    QUEUE_NAME,
    async (job: Job<TicketJob>) => {
      const data = job.data;
      const log = logger.child({
        ticketId: data.ticketId,
        projectId: data.projectId,
      });

      const acquired = await lockManager.acquire(
        data.projectId,
        data.ticketId
      );

      if (!acquired) {
        log.warn("Could not acquire project lock, requeueing");
        throw new Error(
          `Project ${data.projectId} is locked by another worker`
        );
      }

      activeCount++;
      try {
        log.info("Processing ticket");
        await handler(data);
        log.info("Ticket completed successfully");
      } finally {
        activeCount--;
        await lockManager.release(data.projectId, data.ticketId);
      }
    },
    {
      connection: redis,
      concurrency,
      limiter: {
        max: concurrency,
        duration: 1000,
      },
    }
  );

  worker.on("error", (err: Error) => {
    logger.error({ err }, "Worker error");
  });

  return {
    start(): void {
      logger.info({ concurrency }, "Dispatcher started");
    },

    async stop(): Promise<void> {
      await worker.close();
      logger.info("Dispatcher stopped");
    },

    getActiveCount(): number {
      return activeCount;
    },
  };
}
