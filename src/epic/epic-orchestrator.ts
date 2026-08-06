import pino from "pino";
import { createTaskDag, type TaskDag } from "./task-dag.js";

const logger = pino({ name: "nightforge-epic" });

/**
 * EpicWorkflow (Guide NIGHTFORGE-V2.1 §10.2, §18).
 *
 * Atomized epic tasks form a DAG with exclusive file ownership. Waves of
 * independent tasks run in parallel; a failure stops the epic so repair or
 * escalation can happen before dependent work starts.
 */

export interface EpicTaskSpec {
  id: string;
  objective: string;
  ownedFiles: string[];
  dependsOn: string[];
}

export interface TaskRunResult {
  taskId: string;
  success: boolean;
  summary: string;
}

export type TaskExecutor = (task: EpicTaskSpec) => Promise<TaskRunResult>;

export interface EpicResult {
  epicId: string;
  state: "accepted" | "failed" | "invalid";
  waves: string[][];
  completed: string[];
  failed: string[];
  taskResults: TaskRunResult[];
  message: string;
}

export interface EpicOrchestrator {
  runEpic(
    epicId: string,
    tasks: EpicTaskSpec[],
    executor: TaskExecutor
  ): Promise<EpicResult>;
}

function buildDag(tasks: EpicTaskSpec[]): TaskDag {
  const dag = createTaskDag();
  for (const task of tasks) {
    dag.addTask({ id: task.id, ownedFiles: task.ownedFiles });
  }
  for (const task of tasks) {
    for (const dep of task.dependsOn) {
      dag.addEdge(dep, task.id);
    }
  }
  return dag;
}

export function createEpicOrchestrator(): EpicOrchestrator {
  return {
    async runEpic(epicId, tasks, executor): Promise<EpicResult> {
      const log = logger.child({ epicId });
      const byId = new Map(tasks.map((t) => [t.id, t]));

      let dag: TaskDag;
      try {
        dag = buildDag(tasks);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        log.error({ err: message }, "Epic DAG construction failed");
        return {
          epicId,
          state: "invalid",
          waves: [],
          completed: [],
          failed: [],
          taskResults: [],
          message: `Invalid epic structure: ${message}`,
        };
      }

      // Guide §18.2: ownership must be exclusive before any work starts.
      const violations = dag.ownershipViolations();
      if (violations.length > 0) {
        log.warn({ violations }, "Ownership conflicts block epic start");
        return {
          epicId,
          state: "invalid",
          waves: [],
          completed: [],
          failed: [],
          taskResults: [],
          message: `Ownership conflicts: ${violations
            .map((v) => v.join(" vs "))
            .join("; ")}`,
        };
      }

      let waves: string[][];
      try {
        waves = dag.waves();
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        log.error({ err: message }, "Epic DAG has a dependency cycle");
        return {
          epicId,
          state: "invalid",
          waves: [],
          completed: [],
          failed: [],
          taskResults: [],
          message,
        };
      }

      log.info({ waves: waves.length, tasks: tasks.length }, "Running epic waves");

      const completed: string[] = [];
      const failed: string[] = [];
      const taskResults: TaskRunResult[] = [];

      for (const wave of waves) {
        // Ownership exclusivity plus full dependency completion makes every
        // task in a wave safe to run in parallel.
        const settled = await Promise.allSettled(
          wave.map(async (taskId) => {
            const spec = byId.get(taskId);
            if (!spec) {
              return { taskId, success: false, summary: "Missing task spec" };
            }
            return await executor(spec);
          })
        );

        for (const outcome of settled) {
          const result: TaskRunResult =
            outcome.status === "fulfilled"
              ? outcome.value
              : { taskId: "unknown", success: false, summary: String(outcome.reason) };
          taskResults.push(result);
          if (result.success) {
            completed.push(result.taskId);
          } else {
            failed.push(result.taskId);
          }
        }

        if (failed.length > 0) {
          log.warn({ failed }, "Epic stopped by failed tasks");
          return {
            epicId,
            state: "failed",
            waves,
            completed,
            failed,
            taskResults,
            message: `Tasks failed: ${failed.join(", ")}`,
          };
        }
      }

      log.info("Epic accepted");
      return {
        epicId,
        state: "accepted",
        waves,
        completed,
        failed,
        taskResults,
        message: `All ${String(tasks.length)} tasks completed`,
      };
    },
  };
}
