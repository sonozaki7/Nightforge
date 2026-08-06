import { describe, expect, it, vi, beforeEach } from "vitest";
import { createApprovalStore, APPROVAL_TTL_MS } from "../src/queue/approvals.js";
import type { ApprovalRecord } from "../src/queue/approvals.js";
import type { TicketJob } from "../src/queue/scheduler.js";

const job: TicketJob = {
  ticketId: "T-1",
  projectId: "proj",
  title: "High-risk change",
  description: "Migration",
  labels: ["billing"],
  priority: 2,
  attempt: 1,
};

const record: ApprovalRecord = {
  job,
  contract: {
    contractId: "c-1",
    ticketId: "T-1",
    projectId: "proj",
    objective: "Migrate",
    acceptanceCriteria: [{ id: "a", description: "works", verified: true }],
    riskLevel: "high",
    createdAt: "2026-08-06T00:00:00.000Z",
  } as ApprovalRecord["contract"],
  worktreePath: "/worktrees/proj-T-1",
  summary: "implemented",
  riskReason: "high-risk classes detected",
  createdAt: 1,
  expiresAt: 2,
};

function mockRedis(): {
  store: Map<string, string>;
  redis: {
    set: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    del: ReturnType<typeof vi.fn>;
    keys: ReturnType<typeof vi.fn>;
  };
} {
  const store = new Map<string, string>();
  return {
    store,
    redis: {
      set: vi.fn((key: string, value: string, _mode: string, _ms: number): Promise<string> => {
        store.set(key, value);
        return Promise.resolve("OK");
      }),
      get: vi.fn((key: string): Promise<string | null> =>
        Promise.resolve(store.get(key) ?? null)
      ),
      del: vi.fn((key: string): Promise<number> =>
        Promise.resolve(store.delete(key) ? 1 : 0)
      ),
      keys: vi.fn((pattern: string): Promise<string[]> =>
        Promise.resolve(
          [...store.keys()].filter((k) =>
            k.startsWith(pattern.slice(0, -1))
          )
        )
      ),
    },
  };
}

describe("createApprovalStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should save and retrieve a record", async () => {
    const { redis } = mockRedis();
    const store = createApprovalStore(
      redis as unknown as Parameters<typeof createApprovalStore>[0]
    );

    await store.save(record);
    const roundTrip = await store.get("T-1");

    expect(roundTrip).toEqual(record);
  });

  it("should persist with the TTL and namespaced key", async () => {
    const { store: mem, redis } = mockRedis();
    const store = createApprovalStore(
      redis as unknown as Parameters<typeof createApprovalStore>[0]
    );

    await store.save(record);

    expect(redis.set).toHaveBeenCalledWith(
      "nightforge:approval:T-1",
      JSON.stringify(record),
      "PX",
      APPROVAL_TTL_MS
    );
    expect(await store.get("T-1")).toEqual(record);
    expect(mem.size).toBe(1);
  });

  it("should return null for a missing ticket", async () => {
    const { redis } = mockRedis();
    const store = createApprovalStore(
      redis as unknown as Parameters<typeof createApprovalStore>[0]
    );

    expect(await store.get("missing")).toBeNull();
  });

  it("should remove a record", async () => {
    const { redis } = mockRedis();
    const store = createApprovalStore(
      redis as unknown as Parameters<typeof createApprovalStore>[0]
    );

    await store.save(record);
    await store.remove("T-1");

    expect(await store.get("T-1")).toBeNull();
  });

  it("should list pending approvals with expiry", async () => {
    const { redis } = mockRedis();
    const store = createApprovalStore(
      redis as unknown as Parameters<typeof createApprovalStore>[0]
    );

    await store.save(record);
    await store.save({ ...record, job: { ...job, ticketId: "T-2" } });

    const pending = await store.list();

    expect(pending).toEqual([
      { ticketId: "T-1", expiresAt: 2 },
      { ticketId: "T-2", expiresAt: 2 },
    ]);
  });

  it("should tolerate corrupt records", async () => {
    const { redis, store: mem } = mockRedis();
    mem.set("nightforge:approval:T-1", "{not-json");
    const store = createApprovalStore(
      redis as unknown as Parameters<typeof createApprovalStore>[0]
    );

    expect(await store.get("T-1")).toBeNull();
    expect(await store.list()).toEqual([]);
  });
});