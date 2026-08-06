import { randomUUID } from "node:crypto";
import pino from "pino";
import type { ArtifactStore } from "../artifacts/store.js";
import {
  MAX_DECISIONS_PER_PACKET,
  type DecisionHandling,
  type DecisionItem,
  type DecisionPacket,
  type RecordedDecision,
} from "../artifacts/schemas.js";

const logger = pino({ name: "nightforge-ask-once" });

/**
 * Ask-Once Policy (Guide NIGHTFORGE-V2.1 §4.2).
 *
 * An agent may not ask a human merely because information is absent.
 * Every unknown is classified; only irreversible or externally-binding
 * questions ever reach the human, and those are bundled into a single
 * Decision Packet — never asked one at a time, never twice.
 */

/** Facts describing one unknown the agent has encountered. */
export interface UnknownFacts {
  question: string;
  /** Can the choice be undone cheaply later? */
  reversible: boolean;
  /** Impact if the inferred default turns out wrong. */
  impact: "low" | "material";
  /** True when the question is irreversible/legal/financial/security/externally binding. */
  sensitive: boolean;
  /** Set when the unknown blocks exactly one branch of work. */
  blocksBranch?: string;
  /** Set when explicit requirements contradict each other. */
  isContradiction?: boolean;
}

export interface Classification {
  handling: DecisionHandling;
  reason: string;
}

/** Classify an unknown per the Guide §4.2 table. */
export function classifyUnknown(facts: UnknownFacts): Classification {
  if (facts.isContradiction === true) {
    return {
      handling: "ask_contradiction",
      reason: "Explicit requirements contradict; ask before implementation",
    };
  }
  if (facts.sensitive) {
    return {
      handling: "ask_in_packet",
      reason: "Irreversible/legal/financial/security — must ask in Decision Packet",
    };
  }
  if (facts.reversible && facts.impact === "low") {
    return {
      handling: "infer_and_record",
      reason: "Reversible and low impact — choose project default and record it",
    };
  }
  if (facts.reversible && facts.impact === "material") {
    return {
      handling: "recommend_and_report",
      reason: "Reversible but material — choose recommendation, report in digest",
    };
  }
  if (facts.blocksBranch !== undefined) {
    return {
      handling: "pause_branch",
      reason: "Blocks only one branch — pause it, continue independent work",
    };
  }
  // Non-reversible but not flagged sensitive: treat conservatively as a question.
  return {
    handling: "ask_in_packet",
    reason: "Not reversible — ask in Decision Packet",
  };
}

export interface DecisionPacketBuilderInput {
  projectId: string;
  ticketId: string;
}

export interface AskOncePolicy {
  /**
   * Resolve an unknown: infer+record, or collect it for a Decision Packet.
   * Returns the classification applied. Never asks about a question whose
   * normalized form was already decided (ask-once guarantee).
   */
  resolveUnknown(
    projectId: string,
    ticketId: string,
    facts: UnknownFacts,
    options: { recommendedOption: string; choices: DecisionItem["options"]; defaultIfNoResponse: string }
  ): Promise<Classification>;
  /** Build the packet from all collected questions (max 5 items). */
  buildPacket(projectId: string, ticketId: string): Promise<DecisionPacket | null>;
  /** Record a human or system decision; prevents re-asking. */
  recordDecision(projectId: string, decision: RecordedDecision): Promise<void>;
  /** Whether this exact question was already decided for the project. */
  wasDecided(projectId: string, question: string): Promise<boolean>;
  /**
   * Apply a human answer to the pending packet that owns the decision.
   * Returns a reply message.
   */
  answerDecision(
    projectId: string,
    decisionId: string,
    chosenOption: string
  ): Promise<string>;
}

function normalizeQuestion(question: string): string {
  return question.trim().toLowerCase().replace(/\s+/g, " ");
}

export function createAskOncePolicy(
  store: ArtifactStore,
  clock: () => Date = () => new Date()
): AskOncePolicy {
  // Questions collected per project+ticket, awaiting packet assembly.
  const pending = new Map<string, DecisionItem[]>();

  function pendingKey(projectId: string, ticketId: string): string {
    return `${projectId}::${ticketId}`;
  }

  return {
    async resolveUnknown(
      projectId: string,
      ticketId: string,
      facts: UnknownFacts,
      options
    ): Promise<Classification> {
      const classification = classifyUnknown(facts);
      const log = logger.child({ ticketId, projectId });

      if (await this.wasDecided(projectId, facts.question)) {
        log.info({ question: facts.question }, "Already decided; not asking again");
        return classification;
      }

      switch (classification.handling) {
        case "infer_and_record":
        case "recommend_and_report": {
          await this.recordDecision(projectId, {
            decisionId: `dec-${randomUUID()}`,
            ticketId,
            question: facts.question,
            handling: classification.handling,
            chosenOption: options.recommendedOption,
            decidedBy: "system",
            rationale: classification.reason,
            decidedAt: clock().toISOString(),
          });
          log.info(
            { question: facts.question, chosen: options.recommendedOption },
            "Decision inferred and recorded"
          );
          return classification;
        }
        case "ask_in_packet":
        case "ask_contradiction": {
          const key = pendingKey(projectId, ticketId);
          const items = pending.get(key) ?? [];
          if (items.length >= MAX_DECISIONS_PER_PACKET) {
            log.warn(
              { question: facts.question },
              "Packet already at capacity; question deferred to next packet"
            );
            return classification;
          }
          items.push({
            decisionId: `dec-${randomUUID()}`,
            question: facts.question,
            whyItMatters: classification.reason,
            recommendedOption: options.recommendedOption,
            options: options.choices,
            defaultIfNoResponse: options.defaultIfNoResponse,
            blocks: facts.blocksBranch !== undefined ? [facts.blocksBranch] : [],
          });
          pending.set(key, items);
          return classification;
        }
        case "pause_branch":
          log.info(
            { question: facts.question, branch: facts.blocksBranch },
            "Branch paused; independent work continues"
          );
          return classification;
      }
    },

    async buildPacket(projectId, ticketId): Promise<DecisionPacket | null> {
      const key = pendingKey(projectId, ticketId);
      const items = pending.get(key);
      if (!items || items.length === 0) return null;
      pending.delete(key);

      const packet: DecisionPacket = {
        packetId: `packet-${randomUUID()}`,
        projectId,
        ticketId,
        items,
        status: "pending",
        createdAt: clock().toISOString(),
      };
      await store.save("decision-packet", projectId, packet.packetId, packet);
      logger.info(
        { ticketId, count: items.length },
        "Decision Packet built and stored"
      );
      return packet;
    },

    async recordDecision(projectId, decision): Promise<void> {
      await store.save("decision-log", projectId, decision.decisionId, decision);
    },

    async wasDecided(projectId, question): Promise<boolean> {
      const normalized = normalizeQuestion(question);
      // Scan this project's decision log for an equivalent question.
      const decisionIds = await store.list("decision-log", projectId);
      for (const decisionId of decisionIds) {
        const decision = await store.load("decision-log", projectId, decisionId);
        if (decision && normalizeQuestion(decision.question) === normalized) {
          return true;
        }
      }
      return false;
    },

    async answerDecision(
      projectId: string,
      decisionId: string,
      chosenOption: string
    ): Promise<string> {
      const packetIds = await store.list("decision-packet", projectId);
      for (const packetId of packetIds) {
        const packet = await store.load("decision-packet", projectId, packetId);
        if (packet === null || packet.status !== "pending") continue;

        const item = packet.items.find((i) => i.decisionId === decisionId);
        if (item === undefined) continue;

        const valid =
          item.options.some((o) => o.id === chosenOption) ||
          chosenOption === item.defaultIfNoResponse;
        if (!valid) {
          return `Invalid option "${chosenOption}" for ${decisionId}. Valid: ${item.options
            .map((o) => o.id)
            .join(", ")}`;
        }

        await this.recordDecision(projectId, {
          decisionId: item.decisionId,
          ticketId: packet.ticketId,
          question: item.question,
          handling: "ask_in_packet",
          chosenOption,
          decidedBy: "human",
          rationale: "Answered by a human",
          decidedAt: clock().toISOString(),
        });

        // Packet is answered once every item in it has a recorded decision.
        const settled = await Promise.all(
          packet.items.map((i) => this.wasDecided(projectId, i.question))
        );
        if (settled.every((done) => done)) {
          await store.save("decision-packet", projectId, packet.packetId, {
            ...packet,
            status: "answered",
          });
          logger.info({ packetId: packet.packetId }, "Decision packet answered");
          return `Recorded ${decisionId} → ${chosenOption}. Packet ${packet.packetId} fully answered.`;
        }
        return `Recorded ${decisionId} → ${chosenOption}`;
      }
      return `No pending decision "${decisionId}" found for project ${projectId}`;
    },
  };
}
