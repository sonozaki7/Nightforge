import { describe, expect, it } from "vitest";
import { createTaskDag, type TaskDag } from "../src/epic/task-dag.js";

function buildSampleDag(): TaskDag {
  const dag = createTaskDag();
  dag.addTask({ id: "schema", ownedFiles: ["src/db/schema.ts"] });
  dag.addTask({ id: "api", ownedFiles: ["src/api/routes.ts"] });
  dag.addTask({ id: "ui", ownedFiles: ["src/ui/form.tsx"] });
  dag.addTask({ id: "integrate", ownedFiles: ["src/api/index.ts"] });
  dag.addEdge("schema", "api");
  dag.addEdge("api", "integrate");
  dag.addEdge("ui", "integrate");
  return dag;
}

describe("createTaskDag", () => {
  it("should compute the ready set from dependencies", () => {
    const dag = buildSampleDag();
    expect(dag.readySet(new Set()).sort()).toEqual(["schema", "ui"]);

    const afterSchema = dag.readySet(new Set(["schema"])).sort();
    expect(afterSchema).toEqual(["api", "ui"]);

    const afterMore = dag.readySet(new Set(["schema", "api", "ui"]));
    expect(afterMore).toEqual(["integrate"]);
  });

  it("should produce topological waves for parallel scheduling", () => {
    const dag = buildSampleDag();
    const waves = dag.waves();
    expect(waves).toEqual([["schema", "ui"], ["api"], ["integrate"]]);
  });

  it("should detect ownership conflicts between tasks", () => {
    const dag = createTaskDag();
    dag.addTask({ id: "a", ownedFiles: ["src/shared.ts"] });
    dag.addTask({ id: "b", ownedFiles: ["src/shared.ts"] });
    const violations = dag.ownershipViolations();
    expect(violations).toHaveLength(1);
    expect(violations[0]).toEqual(["a", "b", "src/shared.ts"]);
  });

  it("should report no violations for disjoint ownership", () => {
    const dag = buildSampleDag();
    expect(dag.ownershipViolations()).toEqual([]);
  });

  it("should defer ready tasks that conflict with an earlier ready task's files", () => {
    const dag = createTaskDag();
    dag.addTask({ id: "a", ownedFiles: ["src/x.ts"] });
    dag.addTask({ id: "b", ownedFiles: ["src/x.ts"] });
    const ready = dag.readySet(new Set());
    expect(ready).toEqual(["a"]);
  });

  it("should detect dependency cycles", () => {
    const dag = createTaskDag();
    dag.addTask({ id: "a", ownedFiles: [] });
    dag.addTask({ id: "b", ownedFiles: [] });
    dag.addEdge("a", "b");
    dag.addEdge("b", "a");
    expect(() => dag.waves()).toThrow(/cycle/i);
  });

  it("should reject duplicate task ids and unknown edges", () => {
    const dag = createTaskDag();
    dag.addTask({ id: "a", ownedFiles: [] });
    expect(() => {
      dag.addTask({ id: "a", ownedFiles: [] });
    }).toThrow(/Duplicate/);
    expect(() => {
      dag.addEdge("a", "ghost");
    }).toThrow(/Unknown task/);
    expect(() => {
      dag.addEdge("a", "a");
    }).toThrow(/Self-dependency/);
  });

  it("should list all task ids sorted", () => {
    const dag = buildSampleDag();
    expect(dag.taskIds()).toEqual(["api", "integrate", "schema", "ui"]);
  });
});
