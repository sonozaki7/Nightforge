import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createArtifactStore, type ArtifactStore } from "../src/artifacts/store.js";
import {
  decisionPacketSchema,
  intakeBriefSchema,
  taskCapsuleSchema,
  type IntakeBrief,
  type TaskCapsule,
} from "../src/artifacts/schemas.js";

describe("artifact schemas", () => {
  const baseBrief = {
    briefId: "brief-1",
    projectId: "my-saas",
    source: "linear-ticket",
    sourceId: "LIN-42",
    title: "Fix login redirect",
    goal: "Users land on dashboard after login",
    riskLevel: "low",
    createdAt: "2026-08-04T20:00:00.000Z",
  };

  it("should accept a valid intake brief and apply defaults", () => {
    const parsed = intakeBriefSchema.parse(baseBrief);
    expect(parsed.constraints).toEqual([]);
    expect(parsed.knownUnknowns).toEqual([]);
  });

  it("should reject an intake brief with unknown risk level", () => {
    expect(() =>
      intakeBriefSchema.parse({ ...baseBrief, riskLevel: "extreme" })
    ).toThrow();
  });

  it("should reject an empty acceptance criteria list in requirements", () => {
    expect(() =>
      intakeBriefSchema.parse({ ...baseBrief, title: "" })
    ).toThrow();
  });

  it("should apply task capsule defaults for optional context fields", () => {
    const capsule: TaskCapsule = taskCapsuleSchema.parse({
      task: {
        id: "t-1",
        objective: "Implement endpoint",
        acceptanceCriteria: ["returns 200"],
        risk: "low",
        budgetUsd: 3,
      },
      context: {},
      execution: {},
    });
    expect(capsule.context.targetRegions).toEqual([]);
    expect(capsule.execution.allowedPaths).toEqual([]);
  });

  it("should reject a decision packet with more than five items", () => {
    const items = Array.from({ length: 6 }, (_, index) => ({
      decisionId: `dec-${String(index)}`,
      question: `Question ${String(index)}`,
      whyItMatters: "matters",
      recommendedOption: "a",
      options: [
        { id: "a", description: "A", consequences: "a happens" },
        { id: "b", description: "B", consequences: "b happens" },
      ],
      defaultIfNoResponse: "a",
    }));
    const result = decisionPacketSchema.safeParse({
      packetId: "packet-1",
      projectId: "my-saas",
      ticketId: "LIN-42",
      items,
      createdAt: "2026-08-04T20:00:00.000Z",
    });
    expect(result.success).toBe(false);
  });

  it("should reject a decision item whose recommendation is not an option", () => {
    const result = decisionPacketSchema.safeParse({
      packetId: "packet-1",
      projectId: "my-saas",
      ticketId: "LIN-42",
      items: [
        {
          decisionId: "dec-1",
          question: "Which provider?",
          whyItMatters: "cost",
          recommendedOption: "missing",
          options: [
            { id: "a", description: "A", consequences: "a happens" },
            { id: "b", description: "B", consequences: "b happens" },
          ],
          defaultIfNoResponse: "a",
        },
      ],
      createdAt: "2026-08-04T20:00:00.000Z",
    });
    expect(result.success).toBe(false);
  });
});

describe("createArtifactStore", () => {
  let dir: string;
  let store: ArtifactStore;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "nightforge-artifacts-"));
    store = createArtifactStore(dir);
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const brief: IntakeBrief = {
    briefId: "brief-1",
    projectId: "my-saas",
    source: "linear-ticket",
    sourceId: "LIN-42",
    title: "Fix login redirect",
    goal: "Users land on dashboard after login",
    constraints: [],
    knownUnknowns: [],
    riskLevel: "low",
    createdAt: "2026-08-04T20:00:00.000Z",
  };

  it("should save and load an artifact round-trip", async () => {
    await store.save("intake-brief", "my-saas", "brief-1", brief);
    const loaded = await store.load("intake-brief", "my-saas", "brief-1");
    expect(loaded).toEqual(brief);
  });

  it("should return null for a missing artifact", async () => {
    const loaded = await store.load("intake-brief", "my-saas", "nope");
    expect(loaded).toBeNull();
  });

  it("should reject invalid payloads on save", async () => {
    await expect(
      store.save("intake-brief", "my-saas", "bad", { ...brief, riskLevel: "wild" })
    ).rejects.toThrow();
  });

  it("should list artifact ids sorted", async () => {
    await store.save("intake-brief", "my-saas", "brief-2", {
      ...brief,
      briefId: "brief-2",
    });
    const ids = await store.list("intake-brief", "my-saas");
    expect(ids).toEqual(["brief-1", "brief-2"]);
  });

  it("should return empty list for an unknown project", async () => {
    const ids = await store.list("intake-brief", "ghost-project");
    expect(ids).toEqual([]);
  });

  it("should sanitize unsafe ids without path traversal", async () => {
    await store.save("intake-brief", "my-saas", "../evil", brief);
    const loaded = await store.load("intake-brief", "my-saas", "../evil");
    expect(loaded?.briefId).toBe("brief-1");
  });
});
