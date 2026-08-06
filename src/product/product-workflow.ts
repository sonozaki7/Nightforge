import pino from "pino";
import type {
  EpicOrchestrator,
  EpicResult,
  TaskExecutor,
} from "../epic/epic-orchestrator.js";
import type {
  ProductBrief,
  ProductIdeaInput,
  ProductIntake,
  ProductQuestion,
} from "./product-intake.js";
import type {
  ArchitectureCandidate,
  ArchitectureContract,
  DesignJudge,
} from "./design-judge.js";

const logger = pino({ name: "nightforge-product-workflow" });

/**
 * ProductWorkflow (Guide NIGHTFORGE-V2.1 §3.3, Roadmap Phase 5):
 * product brief → at most one Decision Packet → architecture candidates →
 * Design Judge → contract → Bootstrap Gate → vertical-slice roadmap
 * executed in waves → acceptance against the traceability matrix.
 */

export interface TraceabilityEntry {
  requirementId: string;
  sliceIds: string[];
}

export interface ProductWorkflowResult {
  productId: string;
  state: "accepted" | "blocked" | "failed" | "invalid";
  brief: ProductBrief;
  contract: ArchitectureContract | null;
  traceability: TraceabilityEntry[];
  /** Requirement ids with no delivering slice. */
  uncovered: string[];
  epic: EpicResult | null;
  blockers: string[];
}

export interface ProductWorkflowDeps {
  intake: ProductIntake;
  judge: DesignJudge;
  orchestrator: EpicOrchestrator;
  /** Called at most once with the brief's open questions (Ask-Once §4.3). */
  requestDecisions?: (questions: ProductQuestion[]) => Promise<void>;
  /** Extra environment checks for the Bootstrap Gate; returns blockers. */
  bootstrapCheck?: (
    brief: ProductBrief,
    contract: ArchitectureContract
  ) => Promise<string[]>;
}

export interface ProductWorkflow {
  run(
    input: ProductIdeaInput,
    candidates: ArchitectureCandidate[],
    executor: TaskExecutor
  ): Promise<ProductWorkflowResult>;
}

function traceabilityFor(brief: ProductBrief): TraceabilityEntry[] {
  return brief.requirements.map((requirement) => ({
    requirementId: requirement.id,
    sliceIds: brief.slices
      .filter((slice) => slice.covers.includes(requirement.id))
      .map((slice) => slice.id),
  }));
}

export function createProductWorkflow(deps: ProductWorkflowDeps): ProductWorkflow {
  return {
    async run(input, candidates, executor): Promise<ProductWorkflowResult> {
      const log = logger.child({ productId: input.productId });
      const brief = deps.intake.compile(input);
      const traceability = traceabilityFor(brief);
      const uncovered = deps.intake.coverage(brief);

      if (brief.openQuestions.length > 0 && deps.requestDecisions !== undefined) {
        await deps.requestDecisions(brief.openQuestions);
      }

      const verdict = deps.judge.judge(brief.requirements, candidates);
      if (verdict.contract === null) {
        log.warn({ reason: verdict.reason }, "No architecture contract");
        return {
          productId: input.productId,
          state: "invalid",
          brief,
          contract: null,
          traceability,
          uncovered,
          epic: null,
          blockers: [verdict.reason],
        };
      }
      const contract = verdict.contract;

      // Bootstrap Gate: nothing builds until structure and coverage hold.
      const blockers: string[] = [];
      if (brief.slices.length === 0) {
        blockers.push("No vertical slices defined");
      }
      for (const requirementId of uncovered) {
        blockers.push(`Requirement ${requirementId} has no delivering slice`);
      }
      if (deps.bootstrapCheck !== undefined) {
        blockers.push(...(await deps.bootstrapCheck(brief, contract)));
      }
      if (blockers.length > 0) {
        log.warn({ blockers }, "Bootstrap gate blocked the build");
        return {
          productId: input.productId,
          state: "blocked",
          brief,
          contract,
          traceability,
          uncovered,
          epic: null,
          blockers,
        };
      }

      const tasks = brief.slices.map((slice) => ({
        id: slice.id,
        objective: slice.title,
        ownedFiles: [] as string[],
        dependsOn: slice.dependsOn,
      }));
      const epic = await deps.orchestrator.runEpic(
        input.productId,
        tasks,
        executor
      );

      // Acceptance: every slice shipped and every requirement traced.
      log.info({ state: epic.state }, "Product workflow finished");

      return {
        productId: input.productId,
        state: epic.state,
        brief,
        contract,
        traceability,
        uncovered,
        epic,
        blockers: [],
      };
    },
  };
}
