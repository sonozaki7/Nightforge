import { describe, expect, it, vi } from "vitest";
import type { LinearClient, LinearIssue } from "../src/integrations/linear.js";
import type { Scheduler } from "../src/queue/scheduler.js";
import { createEpicDispatch, type EpicDispatch } from "../src/epic/epic-dispatch.js";
import { createEpicIntake } from "../src/epic/epic-intake.js";
import { createEpicAtomizer } from "../src/epic/atomizer.js";
import { createEpicOrchestrator } from "../src/epic/epic-orchestrator.js";
import { createEpicWorkflow } from "../src/epic/epic-workflow.js";

function issue(overrides: Partial<LinearIssue> & { identifier: string }): LinearIssue {
  return {
    id: `uuid-${overrides.identifier}`,
    title: "Issue",
    description: null,
    priority: 3,
    labels: [],
    stateName: "Todo",
    ...overrides,
  };
}

function buildDispatch(
  children: LinearIssue[],
  enqueueAndWait: ReturnType<typeof vi.fn>
): EpicDispatch {
  const linearClient = {
    verifyWebhookSignature: vi.fn(),
    getIssue: vi.fn(),
    getChildIssues: vi.fn().mockResolvedValue(children),
    postComment: vi.fn(),
    updateIssueState: vi.fn(),
  } satisfies Partial<LinearClient> as LinearClient;

  const scheduler = {
    enqueue: vi.fn(),
    enqueueAndWait,
    getQueueStats: vi.fn(),
    close: vi.fn(),
  } satisfies Partial<Scheduler> as Scheduler;

  return createEpicDispatch({
    intake: createEpicIntake(),
    workflow: createEpicWorkflow({
      atomizer: createEpicAtomizer(),
      orchestrator: createEpicOrchestrator(),
    }),
    linearClient,
    scheduler,
    projectId: "default",
  });
}

describe("createEpicDispatch", () => {
  it("should delegate epic detection to intake", () => {
    const dispatch = buildDispatch([], vi.fn());
    expect(dispatch.isEpic(issue({ identifier: "NIG-1", labels: ["epic"] }))).toBe(true);
    expect(dispatch.isEpic(issue({ identifier: "NIG-2" }))).toBe(false);
  });

  it("should run every child task through the ticket queue and accept the epic", async () => {
    const enqueueAndWait = vi.fn().mockResolvedValue({ success: true, summary: "shipped" });
    const dispatch = buildDispatch(
      [
        issue({ identifier: "NIG-11", title: "Track A", description: "Owns src/a/a.ts" }),
        issue({ identifier: "NIG-12", title: "Track B", description: "Owns src/b/b.ts" }),
      ],
      enqueueAndWait
    );

    const result = await dispatch.handle(issue({ identifier: "NIG-10", title: "Epic" }));

    expect(result.state).toBe("accepted");
    expect(result.epic?.completed).toEqual(["NIG-11", "NIG-12"]);
    expect(enqueueAndWait).toHaveBeenCalledTimes(2);
    expect(enqueueAndWait).toHaveBeenCalledWith(
      expect.objectContaining({ ticketId: "uuid-NIG-11", projectId: "default", attempt: 1 })
    );
  });

  it("should fail the epic when a child task fails", async () => {
    const enqueueAndWait = vi.fn().mockResolvedValue({ success: false, summary: "tests failing" });
    const dispatch = buildDispatch(
      [issue({ identifier: "NIG-21", description: "Owns src/a/a.ts" })],
      enqueueAndWait
    );

    const result = await dispatch.handle(issue({ identifier: "NIG-20", title: "Epic" }));

    expect(result.state).toBe("failed");
    expect(result.epic?.failed).toEqual(["NIG-21"]);
  });

  it("should fail cleanly when the epic has no child issues", async () => {
    const enqueueAndWait = vi.fn();
    const dispatch = buildDispatch([], enqueueAndWait);

    const result = await dispatch.handle(issue({ identifier: "NIG-30", title: "Empty epic" }));

    expect(result.state).toBe("failed");
    expect(enqueueAndWait).not.toHaveBeenCalled();
    expect(result.epic?.taskResults[0].summary).toBe("No Linear issue backs this task");
  });
});
