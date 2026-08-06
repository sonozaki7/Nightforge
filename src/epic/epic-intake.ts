import pino from "pino";
import type { LinearIssue } from "../integrations/linear.js";
import type { EpicBriefInput, EpicComponent } from "./atomizer.js";

const logger = pino({ name: "nightforge-epic-intake" });

/**
 * Epic intake (Guide NIGHTFORGE-V2.1 §10.2): the missing trigger for the
 * epic workflow. An issue labeled as an epic arrives with its child issues;
 * intake compiles them into an EpicBriefInput the atomizer can judge.
 *
 * Deterministic by design: ownership comes from file paths mentioned in
 * child descriptions, dependencies start empty and the atomizer validates
 * the structure before any parallel work begins.
 */

export interface EpicIntakeOptions {
  /** Label that marks an issue as an epic (case-insensitive). Default "epic". */
  epicLabel?: string;
}

export interface EpicIntake {
  /** Whether the issue is an epic and must go through the epic workflow. */
  isEpic(issue: LinearIssue): boolean;
  /** Compile the epic and its children into a brief for the atomizer. */
  compileBrief(parent: LinearIssue, children: LinearIssue[]): EpicBriefInput;
}

/** Matches repo-relative paths like src/queue/scheduler.ts or tests/queue.test.ts. */
const FILE_PATH_PATTERN = /^(?:[\w@.-]+\/)+[\w@.-]+\.[A-Za-z0-9]+$/;

export function extractOwnedFiles(description: string | null): string[] {
  if (description === null) {
    return [];
  }
  const files: string[] = [];
  for (const rawToken of description.split(/\s+/)) {
    const token = rawToken
      .replace(/^['"`(]+/, "")
      .replace(/[`"')\],.;:]+$/, "");
    if (token === "" || token.startsWith("http")) {
      continue;
    }
    if (FILE_PATH_PATTERN.test(token) && !files.includes(token)) {
      files.push(token);
    }
  }
  return files;
}

function componentObjective(child: LinearIssue): string {
  const description = child.description?.trim() ?? "";
  return description === "" ? child.title : `${child.title}: ${description}`;
}

export function createEpicIntake(options: EpicIntakeOptions = {}): EpicIntake {
  const epicLabel = (options.epicLabel ?? "epic").toLowerCase();

  return {
    isEpic(issue): boolean {
      return issue.labels.some((label) => label.toLowerCase() === epicLabel);
    },

    compileBrief(parent, children): EpicBriefInput {
      const components: EpicComponent[] = children.map((child) => ({
        id: child.identifier,
        objective: componentObjective(child),
        ownedFiles: extractOwnedFiles(child.description),
        dependsOn: [],
      }));

      const objective = parent.description?.trim() ?? "";
      const brief: EpicBriefInput = {
        epicId: parent.identifier,
        title: parent.title,
        objective: objective === "" ? parent.title : objective,
        components,
      };

      logger.info(
        { epicId: brief.epicId, components: components.length },
        "Epic brief compiled from Linear intake"
      );
      return brief;
    },
  };
}
