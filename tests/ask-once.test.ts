import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createArtifactStore, type ArtifactStore } from "../src/artifacts/store.js";
import { classifyUnknown, createAskOncePolicy, type UnknownFacts } from "../src/policy/ask-once.js";

describe("classifyUnknown (Ask-Once Policy)", () => {
  it("should infer and record reversible low-impact unknowns", () => {
    const facts: UnknownFacts = {
      question: "Which date format for logs?",
      reversible: true,
      impact: "low",
      sensitive: false,
    };
    expect(classifyUnknown(facts).handling).toBe("infer_and_record");
  });

  it("should recommend and report reversible material unknowns", () => {
    const facts: UnknownFacts = {
      question: "Which cache TTL?",
      reversible: true,
      impact: "material",
      sensitive: false,
    };
    expect(classifyUnknown(facts).handling).toBe("recommend_and_report");
  });

  it("should ask sensitive unknowns in a Decision Packet", () => {
    const facts: UnknownFacts = {
      question: "May contractors see production data?",
      reversible: true,
      impact: "low",
      sensitive: true,
    };
    expect(classifyUnknown(facts).handling).toBe("ask_in_packet");
  });

  it("should prefer contradiction handling over everything else", () => {
    const facts: UnknownFacts = {
      question: "Spec says free tier, brief says paid-only — which?",
      reversible: true,
      impact: "low",
      sensitive: false,
      isContradiction: true,
    };
    expect(classifyUnknown(facts).handling).toBe("ask_contradiction");
  });

  it("should pause a single blocked branch instead of asking", () => {
    const facts: UnknownFacts = {
      question: "Which webhook URL for vendor X?",
      reversible: false,
      impact: "low",
      sensitive: false,
      blocksBranch: "branch-vendor-x",
    };
    expect(classifyUnknown(facts).handling).toBe("pause_branch");
  });
});

describe("createAskOncePolicy", () => {
  let dir: string;
  let store: ArtifactStore;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "nightforge-askonce-"));
    store = createArtifactStore(dir);
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const options = {
    recommendedOption: "a",
    choices: [
      { id: "a", description: "Option A", consequences: "nothing dramatic" },
      { id: "b", description: "Option B", consequences: "slightly more work" },
    ],
    defaultIfNoResponse: "a",
  };

  it("should record inferred decisions without building a packet", async () => {
    const policy = createAskOncePolicy(store);
    const classification = await policy.resolveUnknown(
      "proj",
      "T-1",
      { question: "Which log format?", reversible: true, impact: "low", sensitive: false },
      options
    );
    expect(classification.handling).toBe("infer_and_record");
    const packet = await policy.buildPacket("proj", "T-1");
    expect(packet).toBeNull();
    expect(await policy.wasDecided("proj", "Which log format?")).toBe(true);
  });

  it("should bundle sensitive questions into one Decision Packet", async () => {
    const policy = createAskOncePolicy(store);
    await policy.resolveUnknown(
      "proj",
      "T-2",
      { question: "Enable external invites?", reversible: true, impact: "low", sensitive: true },
      options
    );
    await policy.resolveUnknown(
      "proj",
      "T-2",
      { question: "Charge for API overage?", reversible: false, impact: "material", sensitive: true },
      options
    );
    const packet = await policy.buildPacket("proj", "T-2");
    expect(packet).not.toBeNull();
    expect(packet?.items).toHaveLength(2);
    expect(packet?.status).toBe("pending");
    // Packet is consumed once built.
    expect(await policy.buildPacket("proj", "T-2")).toBeNull();
  });

  it("should never ask the same question twice (ask-once guarantee)", async () => {
    const policy = createAskOncePolicy(store);
    const facts = {
      question: "Which timezone for digests?",
      reversible: true,
      impact: "low",
      sensitive: false,
    };
    await policy.resolveUnknown("proj", "T-3", facts, options);

    // Second occurrence: already decided, so nothing new is collected.
    await policy.resolveUnknown("proj", "T-4", facts, options);
    expect(await policy.buildPacket("proj", "T-4")).toBeNull();
  });

  it("should cap a packet at five decisions", async () => {
    const policy = createAskOncePolicy(store);
    for (let index = 0; index < 7; index += 1) {
      await policy.resolveUnknown(
        "proj",
        "T-5",
        {
          question: `Sensitive question ${String(index)}?`,
          reversible: true,
          impact: "low",
          sensitive: true,
        },
        options
      );
    }
    const packet = await policy.buildPacket("proj", "T-5");
    expect(packet?.items).toHaveLength(5);
  });

  it("should treat whitespace and case differences as the same question", async () => {
    const policy = createAskOncePolicy(store);
    await policy.resolveUnknown(
      "proj",
      "T-6",
      { question: "Which  timezone?", reversible: true, impact: "low", sensitive: false },
      options
    );
    expect(await policy.wasDecided("proj", "which timezone?")).toBe(true);
  });

  it("should apply a human answer and mark the packet answered", async () => {
    const policy = createAskOncePolicy(store);
    await policy.resolveUnknown(
      "proj",
      "T-7",
      { question: "Delete customer data on request?", reversible: false, impact: "material", sensitive: true },
      options
    );
    const packet = await policy.buildPacket("proj", "T-7");
    expect(packet).not.toBeNull();
    if (packet === null) return;
    const decisionId = packet.items[0].decisionId;

    const reply = await policy.answerDecision("proj", decisionId, "b");
    expect(reply).toContain("fully answered");

    const reloaded = await store.load("decision-packet", "proj", packet.packetId);
    expect(reloaded?.status).toBe("answered");
    expect(await policy.wasDecided("proj", "Delete customer data on request?")).toBe(true);
  });

  it("should reject an option that the item does not offer", async () => {
    const policy = createAskOncePolicy(store);
    await policy.resolveUnknown(
      "proj",
      "T-8",
      { question: "May we email partners?", reversible: false, impact: "material", sensitive: true },
      options
    );
    const packet = await policy.buildPacket("proj", "T-8");
    if (packet === null) throw new Error("expected packet");
    const decisionId = packet.items[0].decisionId;

    const reply = await policy.answerDecision("proj", decisionId, "z");
    expect(reply).toContain("Invalid option");

    const reloaded = await store.load("decision-packet", "proj", packet.packetId);
    expect(reloaded?.status).toBe("pending");
  });

  it("should report when no pending decision matches", async () => {
    const policy = createAskOncePolicy(store);
    const reply = await policy.answerDecision("proj", "dec-missing", "a");
    expect(reply).toContain("No pending decision");
  });
});
