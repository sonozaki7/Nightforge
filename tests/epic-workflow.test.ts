import { describe, expect, it } from "vitest";
import { createEpicAtomizer, type EpicBriefInput } from "../src/epic/atomizer.js";
import { createEpicOrchestrator } from "../src/epic/epic-orchestrator.js";
import { createEpicWorkflow } from "../src/epic/epic-workflow.js";

const base = {
  epicId: "epic-9",
  title: "Billing overhaul",
  objective: "Rework billing",
};

function workflow(): ReturnType<typeof createEpicWorkflow> {
  return createEpicWorkflow({
    atomizer: createEpicAtomizer(),
    orchestrator: createEpicOrchestrator(),
  });
}

describe("createEpicWorkflow", () => {
  it("should run an atomic epic as a single task", async () => {
    const ran: string[] = [];
    const result = await workflow().run({ ...base, components: [] }, (task) => {
      ran.push(task.id);
      return Promise.resolve({ taskId: task.id, success: true, summary: "ok" });
    });

    expect(result.atomic).toBe(true);
    expect(result.state).toBe("accepted");
    expect(ran).toEqual(["epic-9-single"]);
    expect(result.epic?.completed).toEqual(["epic-9-single"]);
  });

  it("should execute a decomposed epic wave by wave", async () => {
    const brief: EpicBriefInput = {
      ...base,
      components: [
        { id: "schema", objective: "Schema", ownedFiles: ["src/db/schema.ts"] },
        { id: "api", objective: "API", ownedFiles: ["src/api/x.ts"], dependsOn: ["schema"] },
      ],
    };
    const result = await workflow().run(brief, (task) =>
      Promise.resolve({ taskId: task.id, success: true, summary: "ok" })
    );

    expect(result.atomic).toBe(false);
    expect(result.state).toBe("accepted");
    expect(result.epic?.waves).toEqual([["schema"], ["api"]]);
  });

  it("should report ownership conflicts as invalid without executing", async () => {
    const brief: EpicBriefInput = {
      ...base,
      components: [
        { id: "a", objective: "A", ownedFiles: ["src/shared.ts"] },
        { id: "b", objective: "B", ownedFiles: ["src/shared.ts"] },
      ],
    };
    let executed = false;
    const result = await workflow().run(brief, (task) => {
      executed = true;
      return Promise.resolve({ taskId: task.id, success: true, summary: "ok" });
    });

    expect(result.state).toBe("invalid");
    expect(result.atomizerReason).toMatch(/conflicts/);
    expect(executed).toBe(false);
  });

  it("should reject structurally invalid decompositions", async () => {
    const brief: EpicBriefInput = {
      ...base,
      components: [
        { id: "a", objective: "A", ownedFiles: [], dependsOn: ["ghost"] },
        { id: "b", objective: "B", ownedFiles: [] },
      ],
    };
    const result = await workflow().run(brief, (task) =>
      Promise.resolve({ taskId: task.id, success: true, summary: "ok" })
    );

    expect(result.state).toBe("invalid");
    expect(result.epic).toBeNull();
  });

  it("should propagate task failures from the orchestrator", async () => {
    const brief: EpicBriefInput = {
      ...base,
      components: [
        { id: "a", objective: "A", ownedFiles: ["src/a.ts"] },
        { id: "b", objective: "B", ownedFiles: ["src/b.ts"], dependsOn: ["a"] },
      ],
    };
    const result = await workflow().run(brief, (task) =>
      Promise.resolve({ taskId: task.id, success: task.id !== "a", summary: "boom" })
    );

    expect(result.state).toBe("failed");
    expect(result.epic?.failed).toEqual(["a"]);
  });
});
