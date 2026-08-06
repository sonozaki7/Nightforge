import pino from "pino";
import { createTaskDag } from "./task-dag.js";
import type { EpicTaskSpec } from "./epic-orchestrator.js";

const logger = pino({ name: "nightforge-atomizer" });

/**
 * Atomizer (Guide NIGHTFORGE-V2.1 §11, AGENT-PROMPTS §5).
 *
 * Decides whether an epic is atomic — one coherent objective, bounded
 * footprint, no independently executable branches — or must be decomposed.
 * The deterministic implementation judges structure; a model-backed
 * atomizer can replace it behind the same interface.
 */

export interface EpicComponent {
  id: string;
  objective: string;
  ownedFiles: string[];
  dependsOn?: string[];
}

export interface EpicBriefInput {
  epicId: string;
  title: string;
  objective: string;
  components: EpicComponent[];
}

export interface AtomizerOutput {
  atomic: boolean;
  reason: string;
  tasks: EpicTaskSpec[];
  /** Overlapping ownership pairs: [taskA, taskB, file]. */
  conflicts: string[][];
}

export interface EpicAtomizer {
  atomize(brief: EpicBriefInput): Promise<AtomizerOutput>;
}

function toTask(component: EpicComponent): EpicTaskSpec {
  return {
    id: component.id,
    objective: component.objective,
    ownedFiles: component.ownedFiles,
    dependsOn: component.dependsOn ?? [],
  };
}

export function createEpicAtomizer(): EpicAtomizer {
  return {
    atomize(brief): Promise<AtomizerOutput> {
      const log = logger.child({ epicId: brief.epicId });

      // Guide §11: one coherent objective with no independent branches
      // is atomic — it ships through the normal ticket path.
      if (brief.components.length <= 1) {
        const component = brief.components[0];
        const task: EpicTaskSpec =
          brief.components.length === 1
            ? toTask(component)
            : {
                id: `${brief.epicId}-single`,
                objective: brief.objective,
                ownedFiles: [],
                dependsOn: [],
              };
        log.info("Epic is atomic");
        return Promise.resolve({
          atomic: true,
          reason: "Single coherent objective with no independently executable branches",
          tasks: [task],
          conflicts: [],
        });
      }

      const tasks = brief.components.map(toTask);
      const dag = createTaskDag();
      try {
        for (const task of tasks) {
          dag.addTask({ id: task.id, ownedFiles: task.ownedFiles });
        }
        for (const task of tasks) {
          for (const dep of task.dependsOn) {
            dag.addEdge(dep, task.id);
          }
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        log.error({ err: message }, "Decomposition is structurally invalid");
        return Promise.resolve({
          atomic: false,
          reason: `Invalid decomposition: ${message}`,
          tasks: [],
          conflicts: [],
        });
      }
      const conflicts = dag.ownershipViolations();

      log.info(
        { tasks: tasks.length, conflicts: conflicts.length },
        "Epic decomposed into task DAG"
      );
      return Promise.resolve({
        atomic: false,
        reason:
          conflicts.length > 0
            ? "Decomposed with ownership conflicts that must be resolved"
            : `Decomposed into ${String(tasks.length)} tasks with exclusive ownership`,
        tasks,
        conflicts,
      });
    },
  };
}
