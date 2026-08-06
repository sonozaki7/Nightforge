import pino from "pino";

const logger = pino({ name: "nightforge-task-dag" });

/**
 * Epic-mode task DAG (Guide NIGHTFORGE-V2.1 §10.2, executive decision 6).
 *
 * A dependency graph controls parallel work. Agents never edit the same
 * file concurrently: two tasks may run in parallel only when their file
 * ownership sets are disjoint and all dependencies are complete.
 */

export interface TaskNode {
  id: string;
  /** Files this task exclusively owns while running. */
  ownedFiles: string[];
}

export interface TaskDag {
  addTask(task: TaskNode): void;
  /** Edge from dependency to dependent: dependent waits for dependency. */
  addEdge(dependencyId: string, dependentId: string): void;
  /** Tasks with no task owning the same file among themselves. */
  ownershipViolations(): string[][];
  /** Tasks whose dependencies are all complete AND ownership is exclusive. */
  readySet(completed: ReadonlySet<string>): string[];
  /** Topological waves for parallel scheduling; throws on cycles. */
  waves(): string[][];
  taskIds(): string[];
}

export function createTaskDag(): TaskDag {
  const tasks = new Map<string, TaskNode>();
  /** dependentId -> set of dependency ids. */
  const dependencies = new Map<string, Set<string>>();

  function assertExists(id: string): void {
    if (!tasks.has(id)) {
      throw new Error(`Unknown task: ${id}`);
    }
  }

  return {
    addTask(task): void {
      if (tasks.has(task.id)) {
        throw new Error(`Duplicate task id: ${task.id}`);
      }
      tasks.set(task.id, task);
      dependencies.set(task.id, new Set());
    },

    addEdge(dependencyId, dependentId): void {
      assertExists(dependencyId);
      assertExists(dependentId);
      if (dependencyId === dependentId) {
        throw new Error(`Self-dependency on task: ${dependencyId}`);
      }
      const deps = dependencies.get(dependentId);
      if (deps) deps.add(dependencyId);
    },

    ownershipViolations(): string[][] {
      const owner = new Map<string, string[]>();
      for (const task of tasks.values()) {
        for (const file of task.ownedFiles) {
          const holders = owner.get(file) ?? [];
          holders.push(task.id);
          owner.set(file, holders);
        }
      }
      const violations: string[][] = [];
      const seenPairs = new Set<string>();
      for (const [file, holders] of owner) {
        if (holders.length < 2) continue;
        for (let i = 0; i < holders.length; i += 1) {
          for (let j = i + 1; j < holders.length; j += 1) {
            const a = holders[i];
            const b = holders[j];
            const pairKey = [a, b].sort().join("::");
            if (!seenPairs.has(pairKey)) {
              seenPairs.add(pairKey);
              violations.push([a, b, file]);
            }
          }
        }
      }
      return violations;
    },

    readySet(completed): string[] {
      const ready: string[] = [];
      const runningOwnership = new Set<string>();

      for (const [id, deps] of dependencies) {
        if (completed.has(id)) continue;
        const depsComplete = [...deps].every((d) => completed.has(d));
        if (!depsComplete) continue;

        const task = tasks.get(id);
        if (!task) continue;
        const conflicts = task.ownedFiles.some((f) => runningOwnership.has(f));
        if (conflicts) {
          logger.debug({ taskId: id }, "Deferred: file owned by earlier ready task");
          continue;
        }
        for (const file of task.ownedFiles) runningOwnership.add(file);
        ready.push(id);
      }

      return ready;
    },

    waves(): string[][] {
      const remaining = new Set(tasks.keys());
      const done = new Set<string>();
      const result: string[][] = [];

      while (remaining.size > 0) {
        const wave = [...remaining].filter((id) => {
          const deps = dependencies.get(id);
          return deps !== undefined && [...deps].every((d) => done.has(d));
        });
        if (wave.length === 0) {
          throw new Error(
            `Dependency cycle detected involving: ${[...remaining].join(", ")}`
          );
        }
        result.push(wave.sort());
        for (const id of wave) {
          remaining.delete(id);
          done.add(id);
        }
      }

      return result;
    },

    taskIds(): string[] {
      return [...tasks.keys()].sort();
    },
  };
}
