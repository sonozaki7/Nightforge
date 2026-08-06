import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFailureTriage, type TriageInput } from "../src/policy/failure-triage.js";
import { createArtifactStore } from "../src/artifacts/store.js";

let dir: string;

const baseInput: TriageInput = {
  ticketId: "T-1",
  category: "unit-behavior",
  symptom: "Worker pool tests fail",
  suspectedScope: "src/workers/pool.ts",
  confidence: 0.7,
};

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "nightforge-triage-"));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("createFailureTriage", () => {
  it("should repair the smallest scope on a first failure and persist the record", async () => {
    const store = createArtifactStore(join(dir, "first"));
    const triage = createFailureTriage(store);
    const { record, decision } = await triage.triage("proj", baseInput);

    expect(decision.action).toBe("repair");
    expect(decision.attemptNumber).toBe(1);
    expect(decision.strategy).toContain("src/workers/pool.ts");
    expect(record.failureId).toBeTruthy();

    const stored = await store.list("failure", "proj");
    expect(stored).toHaveLength(1);
  });

  it("should force strategy diversity on the second similar failure", async () => {
    const store = createArtifactStore(join(dir, "second"));
    const triage = createFailureTriage(store);
    await triage.triage("proj", baseInput);
    const { decision } = await triage.triage("proj", baseInput);

    expect(decision.action).toBe("repair_diverse");
    expect(decision.attemptNumber).toBe(2);
  });

  it("should escalate once the repair budget is exhausted", async () => {
    const store = createArtifactStore(join(dir, "third"));
    const triage = createFailureTriage(store);
    await triage.triage("proj", baseInput);
    await triage.triage("proj", baseInput);
    const { decision } = await triage.triage("proj", baseInput);

    expect(decision.action).toBe("escalate");
    expect(decision.attemptNumber).toBe(3);
    expect(decision.reason).toMatch(/budget exhausted/i);
  });

  it("should retry flaky infrastructure before repairing", async () => {
    const store = createArtifactStore(join(dir, "flaky"));
    const triage = createFailureTriage(store);
    const flaky: TriageInput = {
      ...baseInput,
      category: "flaky-infrastructure",
      symptom: "CI runner timed out",
    };
    const first = await triage.triage("proj", flaky);
    const second = await triage.triage("proj", flaky);
    const third = await triage.triage("proj", flaky);

    expect(first.decision.action).toBe("retry");
    expect(second.decision.action).toBe("retry");
    expect(third.decision.action).toBe("escalate");
  });

  it("should count categories independently per ticket", async () => {
    const store = createArtifactStore(join(dir, "mixed"));
    const triage = createFailureTriage(store);
    await triage.triage("proj", baseInput);
    const other: TriageInput = {
      ...baseInput,
      ticketId: "T-2",
    };
    const { decision } = await triage.triage("proj", other);

    expect(decision.action).toBe("repair");
    expect(decision.attemptNumber).toBe(1);
  });

  it("should link attempt history to previous failure ids", async () => {
    const store = createArtifactStore(join(dir, "history"));
    const triage = createFailureTriage(store);
    const first = await triage.triage("proj", baseInput);
    const second = await triage.triage("proj", baseInput);

    expect(second.record.attemptHistory).toEqual([first.record.failureId]);
  });
});
