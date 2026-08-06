import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import pino from "pino";
import type { z } from "zod";
import {
  decisionPacketSchema,
  failureRecordSchema,
  intakeBriefSchema,
  memoryProposalSchema,
  recordedDecisionSchema,
  requirementsContractSchema,
  taskCapsuleSchema,
  type DecisionPacket,
  type FailureRecord,
  type IntakeBrief,
  type MemoryProposal,
  type RecordedDecision,
  type RequirementsContract,
  type TaskCapsule,
} from "./schemas.js";

const logger = pino({ name: "nightforge-artifacts" });

/**
 * Artifact kinds and their storage subdirectories (Guide §9.1 layout).
 * Agents never pass free-form summaries; every hand-off is one of these.
 */
const KIND_DIRS = {
  "intake-brief": "intake-briefs",
  requirements: "requirements",
  "task-capsule": "task-capsules",
  "decision-packet": "decision-packets",
  "decision-log": "decision-log",
  failure: "failures",
  "memory-proposal": "memory-proposals",
} as const;

export type ArtifactKind = keyof typeof KIND_DIRS;

interface KindBinding<S extends z.ZodTypeAny> {
  dir: string;
  schema: S;
}

const BINDINGS: {
  "intake-brief": KindBinding<typeof intakeBriefSchema>;
  requirements: KindBinding<typeof requirementsContractSchema>;
  "task-capsule": KindBinding<typeof taskCapsuleSchema>;
  "decision-packet": KindBinding<typeof decisionPacketSchema>;
  "decision-log": KindBinding<typeof recordedDecisionSchema>;
  failure: KindBinding<typeof failureRecordSchema>;
  "memory-proposal": KindBinding<typeof memoryProposalSchema>;
} = {
  "intake-brief": { dir: KIND_DIRS["intake-brief"], schema: intakeBriefSchema },
  requirements: { dir: KIND_DIRS.requirements, schema: requirementsContractSchema },
  "task-capsule": { dir: KIND_DIRS["task-capsule"], schema: taskCapsuleSchema },
  "decision-packet": { dir: KIND_DIRS["decision-packet"], schema: decisionPacketSchema },
  "decision-log": { dir: KIND_DIRS["decision-log"], schema: recordedDecisionSchema },
  failure: { dir: KIND_DIRS.failure, schema: failureRecordSchema },
  "memory-proposal": { dir: KIND_DIRS["memory-proposal"], schema: memoryProposalSchema },
};

/** Maps a kind to its validated artifact type. */
export type ArtifactOf<K extends ArtifactKind> = z.infer<(typeof BINDINGS)[K]["schema"]>;

export interface ArtifactStore {
  /** Validate and persist an artifact. Returns the stored artifact. */
  save<K extends ArtifactKind>(
    kind: K,
    projectId: string,
    id: string,
    artifact: unknown
  ): Promise<ArtifactOf<K>>;
  /** Load and re-validate a stored artifact. Null when absent. */
  load<K extends ArtifactKind>(
    kind: K,
    projectId: string,
    id: string
  ): Promise<ArtifactOf<K> | null>;
  /** List all artifact ids of a kind for a project. */
  list(kind: ArtifactKind, projectId: string): Promise<string[]>;
}

function sanitizeSegment(segment: string): string {
  const clean = segment.replace(/[^a-zA-Z0-9._-]/g, "_");
  if (clean.length === 0) {
    throw new Error("Artifact id must contain at least one safe character");
  }
  return clean;
}

export function createArtifactStore(baseDir: string): ArtifactStore {
  function kindDir(kind: ArtifactKind, projectId: string): string {
    return join(baseDir, sanitizeSegment(projectId), BINDINGS[kind].dir);
  }

  function filePath(kind: ArtifactKind, projectId: string, id: string): string {
    return join(kindDir(kind, projectId), `${sanitizeSegment(id)}.json`);
  }

  return {
    async save<K extends ArtifactKind>(
      kind: K,
      projectId: string,
      id: string,
      artifact: unknown
    ): Promise<ArtifactOf<K>> {
      const binding = BINDINGS[kind];
      const parsed = binding.schema.parse(artifact) as ArtifactOf<K>;

      const dir = kindDir(kind, projectId);
      await mkdir(dir, { recursive: true });
      await writeFile(
        filePath(kind, projectId, id),
        JSON.stringify(parsed, null, 2),
        "utf8"
      );

      logger.debug({ kind, projectId, id }, "Artifact saved");
      return parsed;
    },

    async load<K extends ArtifactKind>(
      kind: K,
      projectId: string,
      id: string
    ): Promise<ArtifactOf<K> | null> {
      let raw: string;
      try {
        raw = await readFile(filePath(kind, projectId, id), "utf8");
      } catch (error: unknown) {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        ) {
          return null;
        }
        throw error;
      }

      // Re-validate on read: stored artifacts must still satisfy the schema.
      return BINDINGS[kind].schema.parse(JSON.parse(raw));
    },

    async list(kind: ArtifactKind, projectId: string): Promise<string[]> {
      let entries: string[];
      try {
        entries = await readdir(kindDir(kind, projectId));
      } catch (error: unknown) {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        ) {
          return [];
        }
        throw error;
      }
      return entries
        .filter((name) => name.endsWith(".json"))
        .map((name) => name.slice(0, -".json".length))
        .sort();
    },
  };
}

// Re-export artifact types for convenience.
export type {
  DecisionPacket,
  FailureRecord,
  IntakeBrief,
  MemoryProposal,
  RecordedDecision,
  RequirementsContract,
  TaskCapsule,
};
