import { randomUUID } from "node:crypto";
import pino from "pino";
import type { ArtifactStore } from "../artifacts/store.js";
import type { MemoryProposal } from "../artifacts/schemas.js";

const logger = pino({ name: "nightforge-memory-curator" });

/**
 * Structured memory proposals + curation (Roadmap Phase 3).
 *
 * Agents never write memory directly: every lesson becomes a proposal.
 * Repeated observations raise a proposal's weight; curation accepts
 * corroborated lessons and rejects stale one-offs, so stored memory is
 * evidence, not noise.
 */

export interface ProposalInput {
  projectId: string;
  ticketId: string;
  category: string;
  content: string;
  evidence?: string[];
}

export interface CurationResult {
  accepted: string[];
  rejected: string[];
}

export interface MemoryCurator {
  /** Submit or reinforce a proposal; duplicates bump observations instead. */
  propose(input: ProposalInput): Promise<MemoryProposal>;
  /** Accept corroborated proposals, reject stale one-offs. */
  curate(projectId: string): Promise<CurationResult>;
}

function normalize(content: string): string {
  return content.trim().toLowerCase().replace(/\s+/g, " ");
}

export interface MemoryCuratorOptions {
  /** Observations a proposal needs before curation accepts it. */
  minObservations?: number;
  /** Pending one-off proposals older than this are rejected. */
  maxPendingAgeMs?: number;
}

export function createMemoryCurator(
  store: ArtifactStore,
  clock: () => Date = () => new Date(),
  options: MemoryCuratorOptions = {}
): MemoryCurator {
  const minObservations = options.minObservations ?? 2;
  const maxPendingAgeMs = options.maxPendingAgeMs ?? 7 * 24 * 3600 * 1000;

  async function loadAll(projectId: string): Promise<MemoryProposal[]> {
    const ids = await store.list("memory-proposal", projectId);
    const loaded = await Promise.all(
      ids.map((id) => store.load("memory-proposal", projectId, id))
    );
    return loaded.filter((p): p is MemoryProposal => p !== null);
  }

  return {
    async propose(input): Promise<MemoryProposal> {
      const existing = await loadAll(input.projectId);
      const duplicate = existing.find(
        (p) =>
          p.status === "pending" && normalize(p.content) === normalize(input.content)
      );
      if (duplicate !== undefined) {
        const reinforced: MemoryProposal = {
          ...duplicate,
          observations: duplicate.observations + 1,
          evidence: [
            ...duplicate.evidence,
            ...(input.evidence ?? []).filter(
              (e) => !duplicate.evidence.includes(e)
            ),
          ],
        };
        await store.save(
          "memory-proposal",
          input.projectId,
          duplicate.proposalId,
          reinforced
        );
        logger.info(
          { proposalId: duplicate.proposalId, observations: reinforced.observations },
          "Proposal reinforced"
        );
        return reinforced;
      }

      const proposal: MemoryProposal = {
        proposalId: `mem-${randomUUID()}`,
        projectId: input.projectId,
        ticketId: input.ticketId,
        category: input.category,
        content: input.content,
        evidence: input.evidence ?? [],
        observations: 1,
        status: "pending",
        createdAt: clock().toISOString(),
      };
      await store.save("memory-proposal", input.projectId, proposal.proposalId, proposal);
      logger.info({ proposalId: proposal.proposalId }, "Memory proposal submitted");
      return proposal;
    },

    async curate(projectId): Promise<CurationResult> {
      const proposals = await loadAll(projectId);
      const now = clock().getTime();
      const accepted: string[] = [];
      const rejected: string[] = [];

      for (const proposal of proposals) {
        if (proposal.status !== "pending") continue;

        if (proposal.observations >= minObservations) {
          await store.save("memory-proposal", projectId, proposal.proposalId, {
            ...proposal,
            status: "accepted",
          });
          accepted.push(proposal.proposalId);
          continue;
        }

        const age = now - Date.parse(proposal.createdAt);
        if (age > maxPendingAgeMs) {
          await store.save("memory-proposal", projectId, proposal.proposalId, {
            ...proposal,
            status: "rejected",
          });
          rejected.push(proposal.proposalId);
        }
      }

      logger.info(
        { accepted: accepted.length, rejected: rejected.length },
        "Memory curation complete"
      );
      return { accepted, rejected };
    },
  };
}
