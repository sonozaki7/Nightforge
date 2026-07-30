import type { Redis } from "ioredis";
import pino from "pino";

const logger = pino({ name: "nightforge-learnings" });

const LEARNINGS_KEY = "nightforge:learnings:";

export interface Learning {
  id: string;
  projectId: string;
  ticketId: string;
  category: string;
  content: string;
  timestamp: number;
}

export interface LearningsStore {
  add(learning: Omit<Learning, "id" | "timestamp">): Promise<void>;
  getForProject(projectId: string): Promise<Learning[]>;
  getRecent(projectId: string, limit: number): Promise<Learning[]>;
}

export function createLearningsStore(redis: Redis): LearningsStore {
  return {
    async add(learning: Omit<Learning, "id" | "timestamp">): Promise<void> {
      const key = `${LEARNINGS_KEY}${learning.projectId}`;
      const entry: Learning = {
        ...learning,
        id: `${learning.ticketId}-${Date.now().toString(36)}`,
        timestamp: Date.now(),
      };

      await redis.zadd(key, entry.timestamp, JSON.stringify(entry));
      await redis.expire(key, 90 * 24 * 3600);

      logger.info(
        { projectId: learning.projectId, category: learning.category },
        "Learning stored"
      );
    },

    async getForProject(projectId: string): Promise<Learning[]> {
      const key = `${LEARNINGS_KEY}${projectId}`;
      const entries = await redis.zrange(key, 0, -1);
      return entries.map((e) => JSON.parse(e) as Learning);
    },

    async getRecent(projectId: string, limit: number): Promise<Learning[]> {
      const key = `${LEARNINGS_KEY}${projectId}`;
      const entries = await redis.zrange(key, -limit, -1);
      return entries.map((e) => JSON.parse(e) as Learning);
    },
  };
}
