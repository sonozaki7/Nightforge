import type { Redis } from "ioredis";
import pino from "pino";

const logger = pino({ name: "nightforge-locks" });

const LOCK_PREFIX = "nightforge:lock:";
const DEFAULT_TTL_SECONDS = 6000; // 100 minutes (90 min runtime + 10 min buffer)

export interface LockManager {
  acquire(projectId: string, ticketId: string, ttlSeconds?: number): Promise<boolean>;
  release(projectId: string, ticketId: string): Promise<void>;
  isLocked(projectId: string): Promise<boolean>;
  getLockHolder(projectId: string): Promise<string | null>;
}

export function createLockManager(redis: Redis): LockManager {
  const lockKey = (projectId: string): string => `${LOCK_PREFIX}${projectId}`;

  return {
    async acquire(
      projectId: string,
      ticketId: string,
      ttlSeconds: number = DEFAULT_TTL_SECONDS
    ): Promise<boolean> {
      const key = lockKey(projectId);
      const result = await redis.set(key, ticketId, "EX", ttlSeconds, "NX");

      if (result === "OK") {
        logger.info(
          { projectId, ticketId, ttlSeconds },
          "Lock acquired for project"
        );
        return true;
      }

      logger.debug(
        { projectId, ticketId },
        "Failed to acquire lock - already held"
      );
      return false;
    },

    async release(projectId: string, ticketId: string): Promise<void> {
      const key = lockKey(projectId);
      const holder = await redis.get(key);

      if (holder === ticketId) {
        await redis.del(key);
        logger.info({ projectId, ticketId }, "Lock released for project");
      } else if (holder !== null) {
        logger.warn(
          { projectId, ticketId, holder },
          "Attempted to release lock held by another ticket"
        );
      }
    },

    async isLocked(projectId: string): Promise<boolean> {
      const key = lockKey(projectId);
      const result = await redis.exists(key);
      return result === 1;
    },

    async getLockHolder(projectId: string): Promise<string | null> {
      const key = lockKey(projectId);
      return await redis.get(key);
    },
  };
}
