import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSpeedMetrics, type TicketMetric } from "../src/memory/speed-metrics.js";

/** Minimal Redis mock for speed metrics */
function createMockRedis(): Record<string, unknown> {
  const store = new Map<string, string>();
  const sortedSets = new Map<string, Array<{ score: number; value: string }>>();

  return {
    zadd: vi.fn((key: string, score: number, value: string): Promise<number> => {
      const set = sortedSets.get(key) ?? [];
      set.push({ score, value });
      sortedSets.set(key, set);
      return Promise.resolve(1);
    }),
    zrange: vi.fn((key: string, start: number, stop: number): Promise<string[]> => {
      const set = sortedSets.get(key) ?? [];
      const sorted = [...set].sort((a, b) => a.score - b.score);
      let s = start;
      let e = stop;
      if (s < 0) s = Math.max(0, sorted.length + s);
      if (e < 0) e = sorted.length + e;
      return Promise.resolve(sorted.slice(s, e + 1).map((item) => item.value));
    }),
    zremrangebyrank: vi.fn((key: string, start: number, stop: number): Promise<number> => {
      const set = sortedSets.get(key) ?? [];
      const sorted = [...set].sort((a, b) => a.score - b.score);
      const e = stop < 0 ? sorted.length + stop : stop;
      const removed = sorted.slice(start, e + 1);
      const remaining = sorted.filter((item) => !removed.includes(item));
      sortedSets.set(key, remaining);
      return Promise.resolve(removed.length);
    }),
    expire: vi.fn((): Promise<number> => Promise.resolve(1)),
    incr: vi.fn((key: string): Promise<number> => {
      const val = parseInt(store.get(key) ?? "0", 10) + 1;
      store.set(key, String(val));
      return Promise.resolve(val);
    }),
    get: vi.fn((key: string): Promise<string | null> => Promise.resolve(store.get(key) ?? null)),
    set: vi.fn((key: string, value: string): Promise<string> => {
      store.set(key, value);
      return Promise.resolve("OK");
    }),
    keys: vi.fn((pattern: string): Promise<string[]> => {
      const prefix = pattern.replace("*", "");
      return Promise.resolve([...sortedSets.keys()].filter((k) => k.startsWith(prefix)));
    }),
  };
}

function makeMetric(overrides?: Partial<TicketMetric>): TicketMetric {
  return {
    ticketId: "TICKET-1",
    projectId: "proj-a",
    totalDurationMs: 120000,
    agentDurationMs: 90000,
    pipelineDurationMs: 30000,
    costUsd: 0.15,
    success: true,
    humanTouched: false,
    timestamp: Date.now(),
    ...overrides,
  };
}

describe("SpeedMetrics", () => {
  let redis: Record<string, unknown>;

  beforeEach(() => {
    redis = createMockRedis();
  });

  it("records a metric and retrieves summary", async () => {
    const metrics = createSpeedMetrics(redis as never);

    await metrics.record(makeMetric({ totalDurationMs: 60000, costUsd: 0.10 }));
    await metrics.record(makeMetric({ ticketId: "TICKET-2", totalDurationMs: 180000, costUsd: 0.30 }));

    const summary = await metrics.getSummary();

    expect(summary.completedToday).toBe(2);
    expect(summary.autonomousToday).toBe(2);
    expect(summary.successRate).toBe(1);
    expect(summary.autonomyRate).toBe(1);
    expect(summary.totalSpendToday).toBeCloseTo(0.40);
    expect(summary.avgCostUsd).toBeCloseTo(0.20);
  });

  it("tracks success rate correctly with failures", async () => {
    const metrics = createSpeedMetrics(redis as never);

    await metrics.record(makeMetric({ success: true }));
    await metrics.record(makeMetric({ ticketId: "T-2", success: false }));
    await metrics.record(makeMetric({ ticketId: "T-3", success: true }));

    const summary = await metrics.getSummary();
    expect(summary.successRate).toBeCloseTo(2 / 3);
  });

  it("tracks autonomy rate (humanTouched)", async () => {
    const metrics = createSpeedMetrics(redis as never);

    await metrics.record(makeMetric({ humanTouched: false }));
    await metrics.record(makeMetric({ ticketId: "T-2", humanTouched: true }));

    const summary = await metrics.getSummary();
    expect(summary.autonomyRate).toBeCloseTo(0.5);
    expect(summary.autonomousToday).toBe(1);
  });

  it("computes median and p95 durations", async () => {
    const metrics = createSpeedMetrics(redis as never);

    // Add 10 metrics with increasing durations
    for (let i = 1; i <= 10; i++) {
      await metrics.record(
        makeMetric({ ticketId: `T-${String(i)}`, totalDurationMs: i * 10000 })
      );
    }

    const summary = await metrics.getSummary();
    // Sorted: 10k, 20k, ..., 100k. Median (P50) = 50k
    expect(summary.medianDurationMs).toBe(50000);
    // P95 = 100k (index ceil(0.95*10)-1 = 9)
    expect(summary.p95DurationMs).toBe(100000);
  });

  it("returns empty summary when no metrics recorded", async () => {
    const metrics = createSpeedMetrics(redis as never);
    const summary = await metrics.getSummary();

    expect(summary.completedToday).toBe(0);
    expect(summary.medianDurationMs).toBe(0);
    expect(summary.successRate).toBe(0);
  });

  it("tracks autonomous streak", async () => {
    const metrics = createSpeedMetrics(redis as never);

    await metrics.record(makeMetric({ success: true, humanTouched: false }));
    await metrics.record(makeMetric({ ticketId: "T-2", success: true, humanTouched: false }));
    await metrics.record(makeMetric({ ticketId: "T-3", success: true, humanTouched: false }));

    const streak = await metrics.getStreak();
    expect(streak.current).toBe(3);
    expect(streak.best).toBe(3);
  });

  it("resets streak on failure", async () => {
    const metrics = createSpeedMetrics(redis as never);

    await metrics.record(makeMetric({ success: true, humanTouched: false }));
    await metrics.record(makeMetric({ ticketId: "T-2", success: true, humanTouched: false }));
    await metrics.record(makeMetric({ ticketId: "T-3", success: false }));

    const streak = await metrics.getStreak();
    expect(streak.current).toBe(0);
    expect(streak.best).toBe(2);
  });

  it("retrieves recent metrics for a project", async () => {
    const metrics = createSpeedMetrics(redis as never);

    await metrics.record(makeMetric({ ticketId: "T-1" }));
    await metrics.record(makeMetric({ ticketId: "T-2" }));
    await metrics.record(makeMetric({ ticketId: "T-3", projectId: "proj-b" }));

    const recent = await metrics.getRecent(10, "proj-a");
    expect(recent.length).toBe(2);
  });
});
