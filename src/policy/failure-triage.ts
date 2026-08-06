import { randomUUID } from "node:crypto";
import pino from "pino";
import type { ArtifactStore } from "../artifacts/store.js";
import type { FailureRecord } from "../artifacts/schemas.js";

const logger = pino({ name: "nightforge-triage" });

/**
 * Failure triage (Guide NIGHTFORGE-V2.1 §20.2-20.3).
 *
 * Every failure is recorded as a typed artifact, then routed by deterministic
 * repair rules: repair the smallest suspected scope, force strategy diversity
 * after two similar failures, and stop escalating after three repair loops.
 */

export type TriageAction = "retry" | "repair" | "repair_diverse" | "escalate";

export interface TriageInput {
  ticketId: string;
  category: FailureRecord["category"];
  symptom: string;
  command?: string;
  minimalErrorExcerpt?: string;
  suspectedScope: string;
  confidence: number;
  requeueTasks?: string[];
}

export interface TriageDecision {
  action: TriageAction;
  /** How many failures of this category the ticket has accumulated. */
  attemptNumber: number;
  strategy: string;
  reason: string;
}

export interface TriageOutcome {
  record: FailureRecord;
  decision: TriageDecision;
}

export interface FailureTriage {
  triage(projectId: string, input: TriageInput): Promise<TriageOutcome>;
}

const MAX_REPAIR_LOOPS = 3;

export function createFailureTriage(
  store: ArtifactStore,
  clock: () => Date = () => new Date()
): FailureTriage {
  return {
    async triage(projectId, input): Promise<TriageOutcome> {
      const log = logger.child({ projectId, ticketId: input.ticketId });

      const ids = await store.list("failure", projectId);
      const records = await Promise.all(
        ids.map((id) => store.load("failure", projectId, id))
      );
      const similar = records.filter(
        (f): f is FailureRecord =>
          f !== null && f.ticketId === input.ticketId && f.category === input.category
      );
      const attemptNumber = similar.length + 1;

      const decision = decideAction(input, attemptNumber);
      log.info(
        { category: input.category, attemptNumber, action: decision.action },
        "Failure triaged"
      );

      const record: FailureRecord = {
        failureId: randomUUID(),
        ticketId: input.ticketId,
        category: input.category,
        symptom: input.symptom,
        command: input.command ?? "",
        minimalErrorExcerpt: input.minimalErrorExcerpt ?? "",
        suspectedScope: input.suspectedScope,
        confidence: input.confidence,
        attemptHistory: [...similar.map((f) => f.failureId)],
        recommendedNextStrategy: decision.strategy,
        requeueTasks: input.requeueTasks ?? [],
        createdAt: clock().toISOString(),
      };

      await store.save("failure", projectId, record.failureId, record);
      return { record, decision };
    },
  };
}

function decideAction(input: TriageInput, attemptNumber: number): TriageDecision {
  // Flaky infrastructure is retried as-is before any repair effort.
  if (input.category === "flaky-infrastructure" && attemptNumber <= 2) {
    return {
      action: "retry",
      attemptNumber,
      strategy: "Re-run the same command; infrastructure flakes usually clear.",
      reason: "Infrastructure flake, retry before repair",
    };
  }

  // Guide §20.3: maximum ordinary repair loops is three.
  if (attemptNumber >= MAX_REPAIR_LOOPS) {
    return {
      action: "escalate",
      attemptNumber,
      strategy:
        "Reset to the last known-good commit and hand the failure to a higher tier.",
      reason: `Repair budget exhausted after ${String(attemptNumber)} attempts`,
    };
  }

  // Guide §20.3: after two similar failures, force strategy diversity.
  if (attemptNumber === 2) {
    return {
      action: "repair_diverse",
      attemptNumber,
      strategy:
        "Take a materially different approach than the previous attempt; " +
        "do not repeat the same repair strategy.",
      reason: "Second similar failure; strategy diversity required",
    };
  }

  return {
    action: "repair",
    attemptNumber,
    strategy: `Repair the smallest suspected scope: ${input.suspectedScope}`,
    reason: "First failure of this category; minimal-scope repair",
  };
}
