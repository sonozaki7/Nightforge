import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createArtifactStore, type ArtifactStore } from "../src/artifacts/store.js";
import { createMemoryCurator } from "../src/memory/memory-curator.js";

const DAY_MS = 24 * 3600 * 1000;

describe("createMemoryCurator", () => {
  let dir: string;
  let store: ArtifactStore;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "nightforge-memory-"));
    store = createArtifactStore(dir);
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("should submit new lessons as pending proposals", async () => {
    const curator = createMemoryCurator(store);
    const proposal = await curator.propose({
      projectId: "p1",
      ticketId: "T-1",
      category: "flaky-test",
      content: "Redis tests need a fresh container",
      evidence: ["T-1 run log"],
    });
    expect(proposal.status).toBe("pending");
    expect(proposal.observations).toBe(1);
  });

  it("should reinforce duplicates instead of storing them twice", async () => {
    const curator = createMemoryCurator(store);
    await curator.propose({
      projectId: "p2",
      ticketId: "T-2",
      category: "flaky-test",
      content: "Redis tests need a fresh container",
      evidence: ["T-2 run log"],
    });
    const reinforced = await curator.propose({
      projectId: "p2",
      ticketId: "T-3",
      category: "flaky-test",
      content: "redis tests need  a fresh container",
      evidence: ["T-3 run log"],
    });
    expect(reinforced.observations).toBe(2);
    expect(reinforced.evidence).toEqual(["T-2 run log", "T-3 run log"]);

    const ids = await store.list("memory-proposal", "p2");
    expect(ids).toHaveLength(1);
  });

  it("should accept corroborated proposals during curation", async () => {
    const curator = createMemoryCurator(store);
    const first = await curator.propose({
      projectId: "p3",
      ticketId: "T-4",
      category: "deploy",
      content: "Migration must run before boot",
    });
    await curator.propose({
      projectId: "p3",
      ticketId: "T-5",
      category: "deploy",
      content: "Migration must run before boot",
    });

    const result = await curator.curate("p3");
    expect(result.accepted).toEqual([first.proposalId]);

    const stored = await store.load("memory-proposal", "p3", first.proposalId);
    expect(stored?.status).toBe("accepted");
  });

  it("should reject stale one-offs but keep fresh ones pending", async () => {
    let current = new Date("2026-07-01T00:00:00Z");
    const curator = createMemoryCurator(store, () => current, {
      maxPendingAgeMs: 7 * DAY_MS,
    });

    const oldOne = await curator.propose({
      projectId: "p4",
      ticketId: "T-6",
      category: "misc",
      content: "Old uncorroborated lesson",
    });
    current = new Date("2026-07-02T00:00:00Z");
    await curator.propose({
      projectId: "p4",
      ticketId: "T-7",
      category: "misc",
      content: "Fresh uncorroborated lesson",
    });

    current = new Date("2026-07-09T00:00:00Z");
    const result = await curator.curate("p4");
    expect(result.rejected).toEqual([oldOne.proposalId]);
    expect(result.accepted).toEqual([]);

    const stored = await store.load("memory-proposal", "p4", oldOne.proposalId);
    expect(stored?.status).toBe("rejected");
  });

  it("should not re-curate decided proposals", async () => {
    const curator = createMemoryCurator(store);
    await curator.propose({
      projectId: "p5",
      ticketId: "T-8",
      category: "misc",
      content: "Repeat me",
    });
    await curator.propose({
      projectId: "p5",
      ticketId: "T-9",
      category: "misc",
      content: "Repeat me",
    });

    await curator.curate("p5");
    const second = await curator.curate("p5");
    expect(second.accepted).toEqual([]);
    expect(second.rejected).toEqual([]);
  });
});
