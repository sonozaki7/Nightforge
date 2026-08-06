import { describe, expect, it, vi } from "vitest";
import { createProductIntake, type ProductIdeaInput } from "../src/product/product-intake.js";
import { createDesignJudge, type ArchitectureCandidate } from "../src/product/design-judge.js";
import { createProductWorkflow, type ProductWorkflow } from "../src/product/product-workflow.js";
import { createEpicOrchestrator, type TaskRunResult } from "../src/epic/epic-orchestrator.js";

function ideaInput(overrides: Partial<ProductIdeaInput> = {}): ProductIdeaInput {
  return {
    productId: "prod-1",
    idea: "Invoice automation for freelancers",
    targetUsers: "Freelancers",
    constraints: ["PostgreSQL storage", "Email delivery"],
    desiredOutcome: "A usable staging deployment",
    slices: [
      { id: "slice-1", title: "Auth + orgs", covers: ["REQ-1"] },
      { id: "slice-2", title: "Invoices + email", covers: ["REQ-2", "REQ-3"] },
    ],
    ...overrides,
  };
}

function candidates(): ArchitectureCandidate[] {
  return [
    { id: "arch-a", name: "Next.js + PG", stack: ["next", "postgres"], satisfies: ["REQ-1", "REQ-2", "REQ-3"], dependencyCount: 12 },
    { id: "arch-b", name: "Rails", stack: ["rails"], satisfies: ["REQ-1"], dependencyCount: 30 },
  ];
}

const okExecutor = (task: { id: string }): Promise<TaskRunResult> =>
  Promise.resolve({ taskId: task.id, success: true, summary: "shipped" });

describe("createProductIntake", () => {
  it("should derive requirements from constraints plus the outcome", () => {
    const brief = createProductIntake().compile(ideaInput());
    expect(brief.requirements.map((r) => r.id)).toEqual(["REQ-1", "REQ-2", "REQ-3"]);
    expect(brief.requirements[2].source).toBe("outcome");
  });

  it("should chain slices and drop unknown coverage ids", () => {
    const intake = createProductIntake();
    const brief = intake.compile(
      ideaInput({
        slices: [
          { id: "s1", title: "First", covers: ["REQ-1", "REQ-99"] },
          { id: "s2", title: "Second", covers: ["REQ-2"] },
        ],
      })
    );
    expect(brief.slices[0].covers).toEqual(["REQ-1"]);
    expect(brief.slices[0].dependsOn).toEqual([]);
    expect(brief.slices[1].dependsOn).toEqual(["s1"]);
    expect(brief.openQuestions).toEqual([]);
  });

  it("should raise a question for slices covering nothing", () => {
    const brief = createProductIntake().compile(
      ideaInput({ slices: [{ id: "s1", title: "Loose slice", covers: [] }] })
    );
    expect(brief.openQuestions).toHaveLength(1);
    expect(brief.openQuestions[0].defaultAnswer).toBe("keep");
  });

  it("should report uncovered requirements", () => {
    const intake = createProductIntake();
    const brief = intake.compile(
      ideaInput({ slices: [{ id: "s1", title: "Partial", covers: ["REQ-1"] }] })
    );
    expect(intake.coverage(brief)).toEqual(["REQ-2", "REQ-3"]);
  });
});

describe("createDesignJudge", () => {
  it("should pick the candidate with the most requirement coverage", () => {
    const intake = createProductIntake();
    const brief = intake.compile(ideaInput());
    const verdict = createDesignJudge().judge(brief.requirements, candidates());
    expect(verdict.contract?.candidateId).toBe("arch-a");
    expect(verdict.contract?.unsatisfiedRequirements).toEqual([]);
  });

  it("should break score ties with fewer dependencies", () => {
    const intake = createProductIntake();
    const brief = intake.compile(ideaInput());
    const tied: ArchitectureCandidate[] = [
      { id: "x", name: "Heavy", stack: [], satisfies: ["REQ-1"], dependencyCount: 40 },
      { id: "y", name: "Lean", stack: [], satisfies: ["REQ-1"], dependencyCount: 5 },
    ];
    const verdict = createDesignJudge().judge(brief.requirements, tied);
    expect(verdict.contract?.candidateId).toBe("y");
  });

  it("should return no contract without candidates", () => {
    const verdict = createDesignJudge().judge([], []);
    expect(verdict.contract).toBeNull();
  });
});

describe("createProductWorkflow", () => {
  const buildWorkflow = (
    requestDecisions?: (questions: unknown[]) => Promise<void>
  ): ProductWorkflow =>
    createProductWorkflow({
      intake: createProductIntake(),
      judge: createDesignJudge(),
      orchestrator: createEpicOrchestrator(),
      requestDecisions,
    });

  it("should accept a fully covered product after running every slice", async () => {
    const executor = vi.fn(okExecutor);
    const result = await buildWorkflow().run(ideaInput(), candidates(), executor);

    expect(result.state).toBe("accepted");
    expect(result.contract?.candidateId).toBe("arch-a");
    expect(executor).toHaveBeenCalledTimes(2);
    expect(result.traceability).toEqual([
      { requirementId: "REQ-1", sliceIds: ["slice-1"] },
      { requirementId: "REQ-2", sliceIds: ["slice-2"] },
      { requirementId: "REQ-3", sliceIds: ["slice-2"] },
    ]);
  });

  it("should send open questions through exactly one decision request", async () => {
    const requestDecisions = vi.fn((): Promise<void> => Promise.resolve(undefined));
    const input = ideaInput({
      slices: [
        { id: "s1", title: "Covers outcome", covers: ["REQ-1", "REQ-2", "REQ-3"] },
        { id: "s2", title: "Unanchored", covers: [] },
      ],
    });
    // slice chain: s2 depends on s1 and covers nothing → question, but still runs
    const result = await buildWorkflow(requestDecisions).run(input, candidates(), okExecutor);
    expect(requestDecisions).toHaveBeenCalledTimes(1);
    expect(result.state).toBe("accepted");
  });

  it("should block at the bootstrap gate when requirements are uncovered", async () => {
    const input = ideaInput({
      slices: [{ id: "s1", title: "Partial", covers: ["REQ-1"] }],
    });
    const result = await buildWorkflow().run(input, candidates(), okExecutor);
    expect(result.state).toBe("blocked");
    expect(result.epic).toBeNull();
    expect(result.blockers).toContain("Requirement REQ-2 has no delivering slice");
  });

  it("should be invalid without architecture candidates", async () => {
    const result = await buildWorkflow().run(ideaInput(), [], okExecutor);
    expect(result.state).toBe("invalid");
    expect(result.blockers).toEqual(["No candidates"]);
  });

  it("should fail when a slice fails during execution", async () => {
    const executor = vi.fn(
      (task: { id: string }): Promise<TaskRunResult> =>
        Promise.resolve({ taskId: task.id, success: task.id !== "slice-1", summary: "boom" })
    );
    const result = await buildWorkflow().run(ideaInput(), candidates(), executor);
    expect(result.state).toBe("failed");
    expect(result.epic?.failed).toEqual(["slice-1"]);
    // dependent slice must never start after its dependency fails
    expect(executor).toHaveBeenCalledTimes(1);
  });
});
