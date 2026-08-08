import { describe, expect, it } from "vitest";
import type { LinearIssue } from "../src/integrations/linear.js";
import { createEpicIntake, extractOwnedFiles } from "../src/epic/epic-intake.js";
import { createEpicAtomizer } from "../src/epic/atomizer.js";

function issue(overrides: Partial<LinearIssue> & { identifier: string }): LinearIssue {
  return {
    id: overrides.identifier,
    title: "Issue",
    description: null,
    priority: 2,
    labels: [],
    stateName: "Todo",
    teamId: "team-1",
    teamName: "Nightforge",
    ...overrides,
  };
}

describe("createEpicIntake", () => {
  it("should detect epic-labeled issues case-insensitively", () => {
    const intake = createEpicIntake();
    expect(intake.isEpic(issue({ identifier: "NIG-1", labels: ["Epic"] }))).toBe(true);
    expect(intake.isEpic(issue({ identifier: "NIG-2", labels: ["epic", "backend"] }))).toBe(true);
    expect(intake.isEpic(issue({ identifier: "NIG-3", labels: ["bug"] }))).toBe(false);
    expect(intake.isEpic(issue({ identifier: "NIG-4" }))).toBe(false);
  });

  it("should honor a custom epic label", () => {
    const intake = createEpicIntake({ epicLabel: "initiative" });
    expect(intake.isEpic(issue({ identifier: "NIG-5", labels: ["Initiative"] }))).toBe(true);
    expect(intake.isEpic(issue({ identifier: "NIG-6", labels: ["epic"] }))).toBe(false);
  });

  it("should compile children into components with extracted ownership", () => {
    const intake = createEpicIntake();
    const brief = intake.compileBrief(
      issue({
        identifier: "NIG-10",
        title: "Ship the queue redesign",
        description: "Rebuild scheduling and dispatch around wave execution.",
      }),
      [
        issue({
          identifier: "NIG-11",
          title: "Rework scheduler",
          description: "Rewrite `src/queue/scheduler.ts` and add tests/queue.test.ts coverage.",
        }),
        issue({
          identifier: "NIG-12",
          title: "Rework dispatcher",
          description: "Touch src/queue/dispatcher.ts, see https://linear.app/docs/api",
        }),
      ]
    );

    expect(brief.epicId).toBe("NIG-10");
    expect(brief.objective).toBe("Rebuild scheduling and dispatch around wave execution.");
    expect(brief.components).toHaveLength(2);
    expect(brief.components[0]).toEqual({
      id: "NIG-11",
      objective: "Rework scheduler: Rewrite `src/queue/scheduler.ts` and add tests/queue.test.ts coverage.",
      ownedFiles: ["src/queue/scheduler.ts", "tests/queue.test.ts"],
      dependsOn: [],
    });
    expect(brief.components[1].ownedFiles).toEqual(["src/queue/dispatcher.ts"]);
  });

  it("should fall back to titles when descriptions are missing", () => {
    const intake = createEpicIntake();
    const brief = intake.compileBrief(
      issue({ identifier: "NIG-20", title: "Parent epic" }),
      [issue({ identifier: "NIG-21", title: "Only a title" })]
    );
    expect(brief.objective).toBe("Parent epic");
    expect(brief.components[0].objective).toBe("Only a title");
    expect(brief.components[0].ownedFiles).toEqual([]);
  });
});

describe("extractOwnedFiles", () => {
  it("should strip punctuation, skip URLs, and deduplicate", () => {
    const files = extractOwnedFiles(
      "Edit src/a/b.ts, then src/a/b.ts again (src/c/d.go). Docs: https://x.com/a/b.ts"
    );
    expect(files).toEqual(["src/a/b.ts", "src/c/d.go"]);
  });

  it("should return no files for null or prose-only descriptions", () => {
    expect(extractOwnedFiles(null)).toEqual([]);
    expect(extractOwnedFiles("Just words, no paths here.")).toEqual([]);
  });
});

describe("epic intake → atomizer", () => {
  it("should produce a brief the atomizer decomposes into a valid DAG", async () => {
    const intake = createEpicIntake();
    const brief = intake.compileBrief(
      issue({ identifier: "NIG-30", title: "Two-track epic", description: "Split work." }),
      [
        issue({
          identifier: "NIG-31",
          title: "Track A",
          description: "Owns src/track/a.ts",
        }),
        issue({
          identifier: "NIG-32",
          title: "Track B",
          description: "Owns src/track/b.ts",
        }),
      ]
    );

    const output = await createEpicAtomizer().atomize(brief);
    expect(output.atomic).toBe(false);
    expect(output.tasks.map((task) => task.id)).toEqual(["NIG-31", "NIG-32"]);
    expect(output.conflicts).toEqual([]);
  });

  it("should flag ownership conflicts when children claim the same file", async () => {
    const intake = createEpicIntake();
    const brief = intake.compileBrief(
      issue({ identifier: "NIG-40", title: "Conflicting epic" }),
      [
        issue({ identifier: "NIG-41", title: "A", description: "Edits src/shared/core.ts" }),
        issue({ identifier: "NIG-42", title: "B", description: "Also edits src/shared/core.ts" }),
      ]
    );

    const output = await createEpicAtomizer().atomize(brief);
    expect(output.atomic).toBe(false);
    expect(output.conflicts.length).toBeGreaterThan(0);
  });
});
