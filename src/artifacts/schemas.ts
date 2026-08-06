import { z } from "zod";

/**
 * Canonical artifact schemas (Guide NIGHTFORGE-V2.1 §9).
 * Agents communicate through validated artifacts, never free-form summaries.
 */

// ---------------------------------------------------------------------------
// Shared enums
// ---------------------------------------------------------------------------

export const riskLevelSchema = z.enum(["low", "medium", "high", "critical"]);
export type RiskLevel = z.infer<typeof riskLevelSchema>;

export const decisionHandlingSchema = z.enum([
  "infer_and_record",
  "recommend_and_report",
  "ask_in_packet",
  "pause_branch",
  "ask_contradiction",
]);
export type DecisionHandling = z.infer<typeof decisionHandlingSchema>;

export const FAILURE_CATEGORIES = [
  "requirement",
  "localization",
  "architecture",
  "environment",
  "dependency-install",
  "compile-type",
  "unit-behavior",
  "integration-interface",
  "database-migration",
  "browser-ui",
  "performance",
  "security",
  "provider-tool-call",
  "flaky-infrastructure",
] as const;

// ---------------------------------------------------------------------------
// IntakeBrief — compiled human goal (Guide §9, Intake Compiler output)
// ---------------------------------------------------------------------------

export const intakeBriefSchema = z.object({
  briefId: z.string().min(1),
  projectId: z.string().min(1),
  // "telegram" is retained for backward compatibility with historical
  // artifacts; new briefs only use the other sources.
  source: z.enum(["linear-ticket", "epic", "product", "telegram"]),
  sourceId: z.string().min(1),
  title: z.string().min(1),
  goal: z.string().min(1),
  constraints: z.array(z.string()).default([]),
  knownUnknowns: z.array(z.string()).default([]),
  riskLevel: riskLevelSchema,
  createdAt: z.string().datetime(),
});
export type IntakeBrief = z.infer<typeof intakeBriefSchema>;

// ---------------------------------------------------------------------------
// RequirementsContract — acceptance criteria mapped to deterministic tests
// ---------------------------------------------------------------------------

export const acceptanceCriterionSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  /** Deterministic command that proves this criterion (e.g. `npm test -- x`) */
  verificationCommand: z.string().optional(),
  verified: z.boolean().default(false),
});

export const requirementsContractSchema = z.object({
  contractId: z.string().min(1),
  briefId: z.string().min(1),
  objective: z.string().min(1),
  acceptanceCriteria: z.array(acceptanceCriterionSchema).min(1),
  nonGoals: z.array(z.string()).default([]),
  riskLevel: riskLevelSchema,
  createdAt: z.string().datetime(),
});
export type RequirementsContract = z.infer<typeof requirementsContractSchema>;

// ---------------------------------------------------------------------------
// TaskCapsule — bounded context handed to a worker (Guide §9.3)
// ---------------------------------------------------------------------------

export const taskCapsuleSchema = z.object({
  task: z.object({
    id: z.string().min(1),
    objective: z.string().min(1),
    acceptanceCriteria: z.array(z.string()).min(1),
    nonGoals: z.array(z.string()).default([]),
    risk: riskLevelSchema,
    budgetUsd: z.number().nonnegative(),
    stopConditions: z.array(z.string()).default([]),
  }),
  context: z.object({
    architectureFragment: z.string().default(""),
    targetRegions: z.array(z.string()).default([]),
    interfaceBriefs: z.array(z.string()).default([]),
    relevantTests: z.array(z.string()).default([]),
    relevantMemory: z.array(z.string()).default([]),
    previousAttempts: z.array(z.string()).default([]),
  }),
  execution: z.object({
    allowedPaths: z.array(z.string()).default([]),
    prohibitedPaths: z.array(z.string()).default([]),
    allowedTools: z.array(z.string()).default([]),
    validationCommands: z.array(z.string()).default([]),
  }),
});
export type TaskCapsule = z.infer<typeof taskCapsuleSchema>;

// ---------------------------------------------------------------------------
// DecisionPacket — bundled human questions (Guide §4.3)
// ---------------------------------------------------------------------------

export const decisionOptionSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  consequences: z.string().min(1),
});

export const decisionItemSchema = z.object({
  decisionId: z.string().min(1),
  question: z.string().min(1),
  whyItMatters: z.string().min(1),
  recommendedOption: z.string().min(1),
  options: z.array(decisionOptionSchema).min(2),
  defaultIfNoResponse: z.string().min(1),
  deadline: z.string().datetime().optional(),
  blocks: z.array(z.string()).default([]),
}).refine((item) => item.options.some((o) => o.id === item.recommendedOption), {
  message: "recommendedOption must reference an existing option id",
});

/** Guide §4.3: maximum five decisions per packet. */
export const MAX_DECISIONS_PER_PACKET = 5;

export const decisionPacketSchema = z
  .object({
    packetId: z.string().min(1),
    projectId: z.string().min(1),
    ticketId: z.string().min(1),
    items: z
      .array(decisionItemSchema)
      .min(1)
      .max(MAX_DECISIONS_PER_PACKET),
    status: z.enum(["pending", "answered", "expired"]).default("pending"),
    createdAt: z.string().datetime(),
  })
  .refine(
    (packet) => {
      const ids = packet.items.map((i) => i.decisionId);
      return new Set(ids).size === ids.length;
    },
    { message: "decision ids must be unique within a packet" }
  );
export type DecisionItem = z.infer<typeof decisionItemSchema>;
export type DecisionPacket = z.infer<typeof decisionPacketSchema>;

// ---------------------------------------------------------------------------
// RecordedDecision — outcome of a decision (answered or inferred)
// ---------------------------------------------------------------------------

export const recordedDecisionSchema = z.object({
  decisionId: z.string().min(1),
  ticketId: z.string().min(1),
  question: z.string().min(1),
  handling: decisionHandlingSchema,
  chosenOption: z.string().min(1),
  decidedBy: z.enum(["human", "system"]),
  rationale: z.string().min(1),
  decidedAt: z.string().datetime(),
});
export type RecordedDecision = z.infer<typeof recordedDecisionSchema>;

// ---------------------------------------------------------------------------
// FailureRecord — triage output (Guide §20.2)
// ---------------------------------------------------------------------------

export const failureRecordSchema = z.object({
  failureId: z.string().min(1),
  ticketId: z.string().min(1),
  category: z.enum(FAILURE_CATEGORIES),
  symptom: z.string().min(1),
  command: z.string().default(""),
  minimalErrorExcerpt: z.string().default(""),
  suspectedScope: z.string().min(1),
  confidence: z.number().min(0).max(1),
  attemptHistory: z.array(z.string()).default([]),
  recommendedNextStrategy: z.string().min(1),
  requeueTasks: z.array(z.string()).default([]),
  createdAt: z.string().datetime(),
});
export type FailureRecord = z.infer<typeof failureRecordSchema>;

// ---------------------------------------------------------------------------
// MemoryProposal — structured memory awaiting curation (Roadmap Phase 3)
// ---------------------------------------------------------------------------

export const memoryProposalSchema = z.object({
  proposalId: z.string().min(1),
  projectId: z.string().min(1),
  ticketId: z.string().min(1),
  category: z.string().min(1),
  content: z.string().min(1),
  evidence: z.array(z.string()).default([]),
  /** How many times this exact lesson was observed; curation thresholds it. */
  observations: z.number().int().min(1).default(1),
  status: z.enum(["pending", "accepted", "rejected"]).default("pending"),
  createdAt: z.string().datetime(),
});
export type MemoryProposal = z.infer<typeof memoryProposalSchema>;
