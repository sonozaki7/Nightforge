import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "node:crypto";
import { createServer, type ServerDeps } from "../src/server.js";
import type { LinearClient } from "../src/integrations/linear.js";
import type { Scheduler } from "../src/queue/scheduler.js";
import type { ProjectControl } from "../src/projects/control.js";

/* eslint-disable @typescript-eslint/unbound-method */

const SECRET = "test-secret";

function sign(payload: string): string {
  return crypto
    .createHmac("sha256", SECRET)
    .update(payload)
    .digest("hex");
}

function linearClientMock(): LinearClient {
  return {
    verifyWebhookSignature: vi.fn(
      (payload: string, signature: string): boolean =>
        sign(payload) === signature
    ),
    getIssue: vi.fn(),
    getChildIssues: vi.fn(),
    postComment: vi.fn(),
    updateIssueState: vi.fn(),
    listTeams: vi.fn().mockResolvedValue([]),
    createTeam: vi.fn(),
    createWebhook: vi.fn(),
    createIssue: vi.fn().mockResolvedValue(undefined),
    listTeamIssues: vi.fn().mockResolvedValue([]),
    listTeamStates: vi.fn(),
  };
}

function schedulerMock(): Scheduler {
  return {
    enqueue: vi.fn().mockResolvedValue("job-1"),
    enqueueAndWait: vi.fn(),
    getQueueStats: vi.fn(),
    close: vi.fn(),
  };
}

function issuePayload(action: string, overrides: Record<string, unknown> = {}): {
  type: string;
  action: string;
  data: Record<string, unknown>;
} {
  return {
    type: "Issue",
    action,
    data: {
      id: "issue-1",
      title: "project list",
      description: "",
      priority: 3,
      state: { name: "Ready for AI" },
      team: { id: "team-1", name: "Nightforge Control" },
      labels: [],
      ...overrides,
    },
  };
}

function makeDeps(): ServerDeps {
  return {
    linearClient: linearClientMock(),
    scheduler: schedulerMock(),
    webhookSecret: SECRET,
    projectId: "nightforge",
    controlTeam: "team-1",
    approvalStore: {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn(),
      remove: vi.fn(),
    },
  };
}

async function postIssue(
  server: ReturnType<typeof createServer>,
  body: Record<string, unknown>
): Promise<{ statusCode: number }> {
  return server.inject({
    method: "POST",
    url: "/webhooks/linear",
    headers: { "linear-signature": sign(JSON.stringify(body)) },
    payload: body,
  });
}

describe("Linear webhook triggering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("processes a ticket created directly in the Ready for AI state", async () => {
    const deps = makeDeps();
    const server = createServer(deps);

    const res = await postIssue(server, issuePayload("create"));

    expect(res.statusCode).toBe(200);
    expect(deps.scheduler.enqueue).toHaveBeenCalledTimes(1);
    expect(deps.linearClient.postComment).toHaveBeenCalled();
  });

  it("still processes a ticket moved into the Ready for AI state", async () => {
    const deps = makeDeps();
    const server = createServer(deps);

    const res = await postIssue(server, issuePayload("update"));

    expect(res.statusCode).toBe(200);
    expect(deps.scheduler.enqueue).toHaveBeenCalledTimes(1);
  });

  it("ignores tickets in a non-triggering state", async () => {
    const deps = makeDeps();
    const server = createServer(deps);

    const res = await postIssue(
      server,
      issuePayload("create", { state: { name: "Backlog" } })
    );

    expect(res.statusCode).toBe(200);
    expect(deps.scheduler.enqueue).not.toHaveBeenCalled();
  });

  it("does not double-run when create and update fire in quick succession", async () => {
    const deps = makeDeps();
    const server = createServer(deps);

    const createBody = issuePayload("create");
    const updateBody = issuePayload("update");

    const first = await postIssue(server, createBody);
    const second = await postIssue(server, updateBody);

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(deps.scheduler.enqueue).toHaveBeenCalledTimes(1);
  });

  it("runs a control command created directly in the Ready for AI state", async () => {
    const deps = makeDeps();
    const projectControl: ProjectControl = {
      run: vi.fn().mockResolvedValue("Registered projects:\n\n- test"),
    };
    deps.projectControl = projectControl;
    const server = createServer(deps);

    const res = await postIssue(
      server,
      issuePayload("create", {
        title: "project list",
        team: { id: "team-1", name: "Nightforge Control" },
      })
    );

    expect(res.statusCode).toBe(200);
    // Control path replies but never enqueues a worker job.
    expect(deps.scheduler.enqueue).not.toHaveBeenCalled();
    expect(deps.linearClient.postComment).toHaveBeenCalled();
  });

  it("handles a bare repo URL title as a control command", async () => {
    const deps = makeDeps();
    const projectControl: ProjectControl = {
      run: vi.fn().mockResolvedValue("Project added"),
    };
    deps.projectControl = projectControl;
    const server = createServer(deps);

    const res = await postIssue(
      server,
      issuePayload("create", {
        title: "https://github.com/sonozaki7/my-app",
        team: { id: "team-1", name: "Nightforge Control" },
      })
    );

    expect(res.statusCode).toBe(200);
    expect(deps.scheduler.enqueue).not.toHaveBeenCalled();
    // The bare URL is parsed as an add command and reaches the control branch.
    expect(projectControl.run).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "add",
        repoUrl: "https://github.com/sonozaki7/my-app",
      })
    );
    expect(deps.linearClient.postComment).toHaveBeenCalledWith(
      "issue-1",
      expect.stringContaining("⚙️")
    );
  });
});