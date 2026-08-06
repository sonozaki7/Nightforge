import pino from "pino";
import { z } from "zod";
import { createTaskDag } from "./task-dag.js";
import type { EpicTaskSpec } from "./epic-orchestrator.js";
import type { EpicAtomizer, EpicBriefInput, AtomizerOutput } from "./atomizer.js";
import type { ModelProvider } from "../workers/worker.js";

const logger = pino({ name: "nightforge-model-atomizer" });

/**
 * Model-backed atomizer (Guide §11, replaces the deterministic one).
 *
 * A cheap model decides whether a task is atomic or must decompose, and
 * generates the sub-task DAG (objectives, file ownership, dependencies).
 * The output is validated with zod AND the deterministic structural checks
 * (valid DAG, exclusive ownership) run on the model's result — the model
 * proposes, the system disposes. A malformed or conflicting decomposition
 * falls back to atomic rather than shipping a bad split.
 */

const subTaskSchema = z.object({
  id: z.string().min(1),
  objective: z.string().min(1),
  ownedFiles: z.array(z.string()).default([]),
  dependsOn: z.array(z.string()).default([]),
});

const decompositionSchema = z.object({
  decompose: z.boolean(),
  reason: z.string().default(""),
  tasks: z.array(subTaskSchema).default([]),
});

const PROMPT = `You decompose an engineering ticket into the smallest set of independent sub-tasks that can each be implemented and verified on its own.

Rules:
1. If the ticket is a single coherent change with one verification point, answer decompose=false.
2. If it spans multiple independent areas, answer decompose=true and list sub-tasks.
3. Each sub-task needs: id (short slug), objective (what to do), ownedFiles (repo-relative paths this task may touch), dependsOn (ids of sub-tasks that must finish first).
4. Sub-tasks must NOT own overlapping files (exclusive ownership).
5. Only decompose when parallel or staged execution genuinely helps.

Respond with ONLY valid JSON matching this schema:
{
  "decompose": boolean,
  "reason": string,
  "tasks": [{ "id": string, "objective": string, "ownedFiles": string[], "dependsOn": string[] }]
}`;

/** Validate the model's decomposition for structural soundness. */
function validateTasks(
  tasks: z.infer<typeof subTaskSchema>[]
): { valid: EpicTaskSpec[]; conflicts: string[][] } | null {
  const specs: EpicTaskSpec[] = tasks.map((t) => ({
    id: t.id,
    objective: t.objective,
    ownedFiles: t.ownedFiles,
    dependsOn: t.dependsOn,
  }));

  if (specs.length === 0) return null;

  const dag = createTaskDag();
  try {
    for (const spec of specs) {
      dag.addTask({ id: spec.id, ownedFiles: spec.ownedFiles });
    }
    for (const spec of specs) {
      for (const dep of spec.dependsOn) {
        dag.addEdge(dep, spec.id);
      }
    }
    // Cycle check + wave derivation throw on invalid structure.
    dag.waves();
  } catch {
    return null;
  }

  const conflicts = dag.ownershipViolations();
  return { valid: specs, conflicts };
}

export function createModelAtomizer(modelProvider: ModelProvider): EpicAtomizer {
  return {
    async atomize(brief: EpicBriefInput): Promise<AtomizerOutput> {
      const log = logger.child({ epicId: brief.epicId });

      const objective =
        brief.components.length > 0
          ? `${brief.objective}\n\nComponents:\n${brief.components
              .map((c) => `- ${c.objective}`)
              .join("\n")}`
          : brief.objective;

      const userPrompt = `Ticket: ${brief.title}\n\nObjective:\n${objective}\n\nProject paths hint: ${brief.components
        .flatMap((c) => c.ownedFiles)
        .slice(0, 20)
        .join(", ")}`;

      let raw: string;
      try {
        const response = await modelProvider.generate(
          `${PROMPT}\n\n${userPrompt}`,
          { temperature: 0.1, maxTokens: 2048 }
        );
        raw = response.content;
      } catch (err) {
        const error = err as Error;
        log.warn({ err: error.message }, "Atomizer model call failed; falling back to atomic");
        return atomicFallback(brief);
      }

      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch === null) {
        log.warn("Model returned no JSON; falling back to atomic");
        return atomicFallback(brief);
      }

      let parsed: z.infer<typeof decompositionSchema>;
      try {
        parsed = decompositionSchema.parse(JSON.parse(jsonMatch[0]));
      } catch {
        log.warn("Model JSON failed validation; falling back to atomic");
        return atomicFallback(brief);
      }

      if (!parsed.decompose || parsed.tasks.length <= 1) {
        const task: EpicTaskSpec = {
          id: `${brief.epicId}-single`,
          objective: brief.objective,
          ownedFiles: [],
          dependsOn: [],
        };
        log.info("Model judged ticket atomic");
        return {
          atomic: true,
          reason: parsed.reason || "Single coherent objective",
          tasks: [task],
          conflicts: [],
        };
      }

      const validated = validateTasks(parsed.tasks);
      if (validated === null) {
        log.warn("Model decomposition was structurally invalid; falling back to atomic");
        return atomicFallback(brief);
      }

      if (validated.conflicts.length > 0) {
        log.warn(
          { conflicts: validated.conflicts.length },
          "Model decomposition has ownership conflicts; falling back to atomic"
        );
        return atomicFallback(brief);
      }

      log.info(
        { tasks: validated.valid.length },
        "Model decomposition accepted (structure + ownership valid)"
      );
      return {
        atomic: false,
        reason: parsed.reason || `Decomposed into ${String(validated.valid.length)} tasks`,
        tasks: validated.valid,
        conflicts: [],
      };
    },
  };
}

function atomicFallback(brief: EpicBriefInput): AtomizerOutput {
  const task: EpicTaskSpec = {
    id: `${brief.epicId}-single`,
    objective: brief.objective,
    ownedFiles: [],
    dependsOn: [],
  };
  return {
    atomic: true,
    reason: "Fallback to atomic execution (model decomposition unavailable or invalid)",
    tasks: [task],
    conflicts: [],
  };
}