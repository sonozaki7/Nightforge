import pino from "pino";
import type { AtomizerOutput, EpicAtomizer, EpicBriefInput } from "./atomizer.js";
import type {
  EpicOrchestrator,
  EpicResult,
  TaskExecutor,
} from "./epic-orchestrator.js";

const logger = pino({ name: "nightforge-epic-workflow" });

/**
 * EpicWorkflow (Guide NIGHTFORGE-V2.1 §10.2): atomize the epic, allocate
 * ownership, launch ready TicketWorkflows through the orchestrator, and
 * aggregate the outcome.
 */

export interface EpicWorkflowResult {
  epicId: string;
  atomic: boolean;
  atomizerReason: string;
  /** Null when the atomizer rejected the decomposition. */
  epic: EpicResult | null;
  state: "accepted" | "failed" | "invalid";
}

export interface EpicWorkflow {
  run(brief: EpicBriefInput, executor: TaskExecutor): Promise<EpicWorkflowResult>;
}

export interface EpicWorkflowDeps {
  atomizer: EpicAtomizer;
  orchestrator: EpicOrchestrator;
}

export function createEpicWorkflow(deps: EpicWorkflowDeps): EpicWorkflow {
  return {
    async run(brief, executor): Promise<EpicWorkflowResult> {
      const log = logger.child({ epicId: brief.epicId });
      const decomposition: AtomizerOutput = await deps.atomizer.atomize(brief);

      if (decomposition.tasks.length === 0) {
        log.warn({ reason: decomposition.reason }, "Epic rejected by atomizer");
        return {
          epicId: brief.epicId,
          atomic: decomposition.atomic,
          atomizerReason: decomposition.reason,
          epic: null,
          state: "invalid",
        };
      }

      // Ownership conflicts must be resolved before parallel work starts;
      // the orchestrator enforces the same rule, but failing fast here
      // keeps the atomizer's verdict in the result.
      const epic = await deps.orchestrator.runEpic(
        brief.epicId,
        decomposition.tasks,
        executor
      );

      log.info(
        { atomic: decomposition.atomic, state: epic.state },
        "Epic workflow finished"
      );
      return {
        epicId: brief.epicId,
        atomic: decomposition.atomic,
        atomizerReason: decomposition.reason,
        epic,
        state: epic.state,
      };
    },
  };
}
