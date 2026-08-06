import pino from "pino";
import type { LinearClient, LinearIssue } from "../integrations/linear.js";
import {
  linearPriorityToNightforge,
  mapPriority,
  type JobOutcome,
  type Scheduler,
} from "../queue/scheduler.js";
import type { EpicTaskSpec, TaskRunResult } from "./epic-orchestrator.js";
import type { EpicIntake } from "./epic-intake.js";
import type { EpicWorkflow, EpicWorkflowResult } from "./epic-workflow.js";

const logger = pino({ name: "nightforge-epic-dispatch" });

/**
 * Epic dispatch (Guide NIGHTFORGE-V2.1 §10.2): routes epic-labeled issues
 * off the single-ticket path. Fetches the child issues, compiles the brief
 * through intake, and runs the epic workflow with an executor that sends
 * each task through the normal ticket queue and waits for its outcome —
 * waves therefore keep their dependency ordering.
 */

export interface EpicDispatchDeps {
  intake: EpicIntake;
  workflow: EpicWorkflow;
  linearClient: LinearClient;
  scheduler: Scheduler;
  projectId: string;
}

export interface EpicDispatch {
  isEpic(issue: LinearIssue): boolean;
  /** Fetch children, compile the brief, and run the epic workflow. */
  handle(issue: LinearIssue): Promise<EpicWorkflowResult>;
}

export function createEpicDispatch(deps: EpicDispatchDeps): EpicDispatch {
  return {
    isEpic(issue): boolean {
      return deps.intake.isEpic(issue);
    },

    async handle(issue): Promise<EpicWorkflowResult> {
      const log = logger.child({ epicId: issue.identifier });

      const children = await deps.linearClient.getChildIssues(issue.id);
      const brief = deps.intake.compileBrief(issue, children);
      const byIdentifier = new Map(children.map((c) => [c.identifier, c]));

      const executor = async (task: EpicTaskSpec): Promise<TaskRunResult> => {
        const child = byIdentifier.get(task.id);
        if (child === undefined) {
          return {
            taskId: task.id,
            success: false,
            summary: "No Linear issue backs this task",
          };
        }

        const outcome: JobOutcome = await deps.scheduler.enqueueAndWait({
          ticketId: child.id,
          projectId: deps.projectId,
          title: child.title,
          description: task.objective,
          labels: child.labels,
          priority: mapPriority(linearPriorityToNightforge(child.priority)),
          attempt: 1,
        });

        log.info(
          { taskId: task.id, success: outcome.success },
          "Epic task finished"
        );
        return {
          taskId: task.id,
          success: outcome.success,
          summary: outcome.summary,
        };
      };

      const result = await deps.workflow.run(brief, executor);
      log.info({ state: result.state }, "Epic dispatch finished");
      return result;
    },
  };
}
