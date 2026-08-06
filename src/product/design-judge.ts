import pino from "pino";
import type { ProductRequirement } from "./product-intake.js";

const logger = pino({ name: "nightforge-design-judge" });

/**
 * Design Judge (Roadmap Phase 5): scores architecture candidates against
 * the brief's requirements and turns the winner into an executable
 * architecture contract. Deterministic scoring — requirement coverage
 * first, fewer dependencies second, stable id order last.
 */

export interface ArchitectureCandidate {
  id: string;
  name: string;
  stack: string[];
  /** Requirement ids this candidate satisfies. */
  satisfies: string[];
  dependencyCount: number;
}

export interface ArchitectureContract {
  candidateId: string;
  name: string;
  stack: string[];
  satisfiedRequirements: string[];
  unsatisfiedRequirements: string[];
  rationale: string;
}

export interface JudgeVerdict {
  contract: ArchitectureContract | null;
  scores: Record<string, number>;
  reason: string;
}

export interface DesignJudge {
  judge(
    requirements: ProductRequirement[],
    candidates: ArchitectureCandidate[]
  ): JudgeVerdict;
}

export function createDesignJudge(): DesignJudge {
  return {
    judge(requirements, candidates): JudgeVerdict {
      if (candidates.length === 0) {
        logger.warn("No architecture candidates provided");
        return { contract: null, scores: {}, reason: "No candidates" };
      }

      const requirementIds = requirements.map((r) => r.id);
      const scores: Record<string, number> = {};

      for (const candidate of candidates) {
        const satisfied = candidate.satisfies.filter((id) =>
          requirementIds.includes(id)
        );
        scores[candidate.id] = satisfied.length;
      }

      const ranked = [...candidates].sort((a, b) => {
        const scoreA = scores[a.id];
        const scoreB = scores[b.id];
        if (scoreA !== scoreB) {
          return scoreB - scoreA;
        }
        if (a.dependencyCount !== b.dependencyCount) {
          return a.dependencyCount - b.dependencyCount;
        }
        return a.id.localeCompare(b.id);
      });
      if (ranked.length === 0) {
        return { contract: null, scores, reason: "Ranking produced no winner" };
      }
      const winner = ranked[0];

      const satisfied = requirementIds.filter((id) =>
        winner.satisfies.includes(id)
      );
      const unsatisfied = requirementIds.filter(
        (id) => !winner.satisfies.includes(id)
      );

      const contract: ArchitectureContract = {
        candidateId: winner.id,
        name: winner.name,
        stack: winner.stack,
        satisfiedRequirements: satisfied,
        unsatisfiedRequirements: unsatisfied,
        rationale:
          `Satisfies ${String(satisfied.length)}/${String(requirementIds.length)}` +
          ` requirements with ${String(winner.dependencyCount)} dependencies`,
      };

      logger.info(
        {
          candidateId: winner.id,
          satisfied: satisfied.length,
          unsatisfied: unsatisfied.length,
        },
        "Architecture contract selected"
      );

      return {
        contract,
        scores,
        reason: `Selected ${winner.name} (${winner.id})`,
      };
    },
  };
}
