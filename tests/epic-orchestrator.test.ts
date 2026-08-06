import { describe, expect, it } from "vitest";
import {
  createEpicOrchestrator,
  type EpicTaskSpec,
} from "../src/epic/epic-orchestrator.js";

const tasks: EpicTaskSpec[] = [
  { id: "schema", objective: "DB schema", ownedFiles: ["src/db/schema.ts"], dependsOn: [] },
  { id: "ui", objective: "Form UI", ownedFiles: ["src/ui/form.tsx"], dependsOn: [] },
  { id: "api", objective: "API routes", ownedFiles: ["src/api/routes.ts"], dependsOn: ["schema"] },
  { id: "integrate", objective: "Wire up", ownedFiles: ["src/api/index.ts"], dependsOn: ["api", "ui"] },
];

describe("createEpicOrchestrator", () => {
  it("should accept an epic when every task succeeds", async () => {
    const orchestrator = createEpicOrchestrator();
    const ran: string[] = [];
    const result = await orchestrator.runEpic("epic-1", tasks, (task) => {
      ran.push(task.id);
      return Promise.resolve({ taskId: task.id, success: true, summary: "done" });
    });

    expect(result.state).toBe("accepted");
    expect(result.waves).toEqual([["schema", "ui"], ["api"], ["integrate"]]);
    expect(result.completed.sort()).toEqual(["api", "integrate", "schema", "ui"]);
    expect(ran).toHaveLength(4);
  });

  it("should run wave tasks in parallel but waves sequentially", async () => {
    const orchestrator = createEpicOrchestrator();
    const order: string[] = [];
    await orchestrator.runEpic("epic-2", tasks, async (task) => {
      order.push(`start:${task.id}`);
      if (task.id === "schema") {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      order.push(`end:${task.id}`);
      return { taskId: task.id, success: true, summary: "ok" };
    });

    // ui finishes before schema (parallel), but api starts only after both.
    expect(order.indexOf("end:ui")).toBeLessThan(order.indexOf("end:schema"));
    expect(order.indexOf("start:api")).toBeGreaterThan(order.indexOf("end:schema"));
  });

  it("should reject ownership conflicts before running anything", async () => {
    const orchestrator = createEpicOrchestrator();
    const conflicting: EpicTaskSpec[] = [
      { id: "a", objective: "A", ownedFiles: ["src/shared.ts"], dependsOn: [] },
      { id: "b", objective: "B", ownedFiles: ["src/shared.ts"], dependsOn: [] },
    ];
    let executed = false;
    const result = await orchestrator.runEpic("epic-3", conflicting, (task) => {
      executed = true;
      return Promise.resolve({ taskId: task.id, success: true, summary: "ok" });
    });

    expect(result.state).toBe("invalid");
    expect(result.message).toMatch(/Ownership conflicts/);
    expect(executed).toBe(false);
  });

  it("should stop after a failed task and skip later waves", async () => {
    const orchestrator = createEpicOrchestrator();
    const ran: string[] = [];
    const result = await orchestrator.runEpic("epic-4", tasks, (task) => {
      ran.push(task.id);
      return Promise.resolve({
        taskId: task.id,
        success: task.id !== "schema",
        summary: "boom",
      });
    });

    expect(result.state).toBe("failed");
    expect(result.failed).toEqual(["schema"]);
    expect(ran).not.toContain("api");
    expect(ran).not.toContain("integrate");
  });

  it("should report cycles as invalid epics", async () => {
    const orchestrator = createEpicOrchestrator();
    const cyclic: EpicTaskSpec[] = [
      { id: "a", objective: "A", ownedFiles: [], dependsOn: ["b"] },
      { id: "b", objective: "B", ownedFiles: [], dependsOn: ["a"] },
    ];
    const result = await orchestrator.runEpic("epic-5", cyclic, (task) =>
      Promise.resolve({ taskId: task.id, success: true, summary: "ok" })
    );

    expect(result.state).toBe("invalid");
    expect(result.message).toMatch(/cycle/i);
  });

  it("should report unknown dependencies as invalid epics", async () => {
    const orchestrator = createEpicOrchestrator();
    const broken: EpicTaskSpec[] = [
      { id: "a", objective: "A", ownedFiles: [], dependsOn: ["ghost"] },
    ];
    const result = await orchestrator.runEpic("epic-6", broken, (task) =>
      Promise.resolve({ taskId: task.id, success: true, summary: "ok" })
    );

    expect(result.state).toBe("invalid");
  });
});
