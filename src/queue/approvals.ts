import type { Redis } from "ioredis";
import pino from "pino";
import type { RequirementsContract } from "../artifacts/schemas.js";
import type { TicketJob } from "./scheduler.js";

const logger = pino({ name: "nightforge-approvals" });

const APPROVAL_PREFIX = "nightforge:approval:";
/** How long an awaiting-approval record (and its worktree) is kept. */
export const APPROVAL_TTL_MS = 24 * 3600 * 1000;

/**
 * A ticket held by the release gate ("awaiting_approval"). The record keeps
 * enough state for a later Linear `/approve` reply to re-run the release
 * stage on the surviving worktree without re-implementing the ticket.
 */
export interface ApprovalRecord {
  job: TicketJob;
  contract: RequirementsContract;
  worktreePath: string;
  summary: string;
  riskReason: string;
  createdAt: number;
  expiresAt: number;
}

export interface ApprovalStore {
  save(record: ApprovalRecord): Promise<void>;
  get(ticketId: string): Promise<ApprovalRecord | null>;
  remove(ticketId: string): Promise<void>;
  /** All pending approvals (ticketId + expiry) for startup sweeps. */
  list(): Promise<Array<{ ticketId: string; expiresAt: number }>>;
}

export function createApprovalStore(redis: Redis): ApprovalStore {
  const key = (ticketId: string): string => `${APPROVAL_PREFIX}${ticketId}`;

  const parse = (raw: string | null): ApprovalRecord | null => {
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as ApprovalRecord;
    } catch {
      logger.warn("Corrupt approval record ignored");
      return null;
    }
  };

  return {
    async save(record: ApprovalRecord): Promise<void> {
      await redis.set(
        key(record.job.ticketId),
        JSON.stringify(record),
        "PX",
        APPROVAL_TTL_MS
      );
      logger.info({ ticketId: record.job.ticketId }, "Awaiting-approval record saved");
    },

    async get(ticketId: string): Promise<ApprovalRecord | null> {
      return parse(await redis.get(key(ticketId)));
    },

    async remove(ticketId: string): Promise<void> {
      await redis.del(key(ticketId));
    },

    async list(): Promise<Array<{ ticketId: string; expiresAt: number }>> {
      const keys = await redis.keys(`${APPROVAL_PREFIX}*`);
      const records: Array<{ ticketId: string; expiresAt: number }> = [];
      for (const k of keys) {
        const record = parse(await redis.get(k));
        if (record !== null) {
          records.push({
            ticketId: record.job.ticketId,
            expiresAt: record.expiresAt,
          });
        }
      }
      return records;
    },
  };
}