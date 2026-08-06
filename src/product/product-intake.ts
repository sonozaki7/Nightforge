import pino from "pino";

const logger = pino({ name: "nightforge-product-intake" });

/**
 * Intake Compiler for Product Mode (Guide NIGHTFORGE-V2.1 §3.3, Roadmap
 * Phase 5). Compiles a raw product idea into a structured brief: typed
 * requirements derived from constraints and the desired outcome, an
 * ordered vertical-slice roadmap, and the open questions that belong in
 * the single allowed Decision Packet.
 */

export interface ProductSliceInput {
  id: string;
  title: string;
  /** Requirement ids this slice delivers. */
  covers: string[];
}

export interface ProductIdeaInput {
  productId: string;
  idea: string;
  targetUsers: string;
  constraints: string[];
  desiredOutcome: string;
  slices: ProductSliceInput[];
}

export interface ProductRequirement {
  id: string;
  text: string;
  source: "constraint" | "outcome";
}

export interface ProductSliceSpec {
  id: string;
  title: string;
  covers: string[];
  /** Vertical slices ship one after another. */
  dependsOn: string[];
}

export interface ProductQuestion {
  id: string;
  question: string;
  defaultAnswer: string;
}

export interface ProductBrief {
  productId: string;
  idea: string;
  targetUsers: string;
  desiredOutcome: string;
  requirements: ProductRequirement[];
  slices: ProductSliceSpec[];
  openQuestions: ProductQuestion[];
}

export interface ProductIntake {
  compile(input: ProductIdeaInput): ProductBrief;
  /** Requirement ids no slice covers. */
  coverage(brief: ProductBrief): string[];
}

export function createProductIntake(): ProductIntake {
  return {
    compile(input): ProductBrief {
      const log = logger.child({ productId: input.productId });

      const requirements: ProductRequirement[] = input.constraints.map(
        (constraint, index) => ({
          id: `REQ-${String(index + 1)}`,
          text: constraint,
          source: "constraint",
        })
      );
      requirements.push({
        id: `REQ-${String(requirements.length + 1)}`,
        text: input.desiredOutcome,
        source: "outcome",
      });
      const knownIds = new Set(requirements.map((r) => r.id));

      // Slices form a delivery chain: each vertical slice builds on the
      // previous one so the product is runnable after every step.
      const slices: ProductSliceSpec[] = input.slices.map((slice, index) => ({
        id: slice.id,
        title: slice.title,
        covers: slice.covers.filter((id) => knownIds.has(id)),
        dependsOn: index === 0 ? [] : [input.slices[index - 1].id],
      }));

      const openQuestions: ProductQuestion[] = [];
      for (const slice of slices) {
        if (slice.covers.length === 0) {
          openQuestions.push({
            id: `q-${slice.id}`,
            question: `Slice "${slice.title}" covers no requirement — keep it?`,
            defaultAnswer: "keep",
          });
        }
      }

      log.info(
        {
          requirements: requirements.length,
          slices: slices.length,
          questions: openQuestions.length,
        },
        "Product brief compiled"
      );

      return {
        productId: input.productId,
        idea: input.idea,
        targetUsers: input.targetUsers,
        desiredOutcome: input.desiredOutcome,
        requirements,
        slices,
        openQuestions,
      };
    },

    coverage(brief): string[] {
      const covered = new Set(brief.slices.flatMap((slice) => slice.covers));
      return brief.requirements
        .map((requirement) => requirement.id)
        .filter((id) => !covered.has(id));
    },
  };
}
