import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { createServer, type ServerDeps } from "../src/server.js";
import { createProjectControl } from "../src/projects/control.js";
import type { LinearClient, LinearIssue } from "../src/integrations/linear.js";
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
    listWebhooks: vi.fn(),
    updateWebhook: vi.fn(),
    createIssue: vi.fn().mockResolvedValue(undefined),
    archiveIssue: vi.fn(),
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

function controlIssue(): LinearIssue {
  return {
    id: "issue-ctrl",
    identifier: "CTRL-1",
    title: "🏠 Nightforge Home — run commands here",
    description: null,
    priority: 0,
    labels: [],
    stateName: "Todo",
    teamId: "team-ctrl",
    teamName: "Nightforge Control",
  };
}

function commentPayload(
  body: string,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    type: "Comment",
    action: "create",
    data: { id: "comment-1", body, issueId: "issue-ctrl", ...overrides },
  };
}

function buildDeps(): {
  deps: ServerDeps;
  linear: ReturnType<typeof linearClientMock>;
  run: ReturnType<typeof vi.fn>;
  approvalGet: ReturnType<typeof vi.fn>;
} {
  const linear = linearClientMock();
  const run = vi.fn().mockResolvedValue("Registered projects:\n\n- test");
  const projectControl: ProjectControl = { run };
  const approvalGet = vi.fn().mockResolvedValue(null);
  const deps: ServerDeps = {
    linearClient: linear,
    scheduler: schedulerMock(),
    webhookSecret: SECRET,
    projectId: "nightforge",
    controlTeam: "team-ctrl",
    projectControl,
    approvalStore: {
      get: approvalGet,
      set: vi.fn(),
      remove: vi.fn(),
    },
  };
  return { deps, linear, run, approvalGet };
}

async function postComment(
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

describe("Linear comment console", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs a project list command from a comment on a control-team issue", async () => {
    const { deps, linear, run } = buildDeps();
    vi.mocked(linear.getIssue).mockResolvedValue(controlIssue());
    const server = createServer(deps);

    const res = await postComment(server, commentPayload("project list"));

    expect(res.statusCode).toBe(200);
    expect(run).toHaveBeenCalledWith({ kind: "list" });
    expect(linear.postComment).toHaveBeenCalledWith(
      "issue-ctrl",
      expect.stringContaining("⚙️")
    );
  });

  it("runs a bare repo name comment as an add command", async () => {
    const { deps, linear, run } = buildDeps();
    vi.mocked(linear.getIssue).mockResolvedValue(controlIssue());
    const server = createServer(deps);

    const res = await postComment(server, commentPayload("browser-use"));

    expect(res.statusCode).toBe(200);
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "add", repoName: "browser-use" })
    );
    expect(linear.postComment).toHaveBeenCalled();
  });

  it("runs an explicit help comment", async () => {
    const { deps, linear, run } = buildDeps();
    vi.mocked(linear.getIssue).mockResolvedValue(controlIssue());
    const server = createServer(deps);

    const res = await postComment(server, commentPayload("help"));

    expect(res.statusCode).toBe(200);
    expect(run).toHaveBeenCalledWith({ kind: "help" });
    expect(linear.postComment).toHaveBeenCalledWith(
      "issue-ctrl",
      expect.stringContaining("⚙️")
    );
  });

  it("ignores a random chat comment (noise guard)", async () => {
    const { deps, linear, run } = buildDeps();
    vi.mocked(linear.getIssue).mockResolvedValue(controlIssue());
    const server = createServer(deps);

    const res = await postComment(server, commentPayload("thanks!"));

    expect(res.statusCode).toBe(200);
    expect(run).not.toHaveBeenCalled();
    expect(linear.postComment).not.toHaveBeenCalled();
  });

  it("ignores Nightforge's own reply comments (loop guard)", async () => {
    const { deps, linear, run } = buildDeps();
    vi.mocked(linear.getIssue).mockResolvedValue(controlIssue());
    const server = createServer(deps);

    const res = await postComment(
      server,
      commentPayload("⚙️ Registered projects:\n\n- test")
    );

    expect(res.statusCode).toBe(200);
    expect(run).not.toHaveBeenCalled();
    expect(linear.postComment).not.toHaveBeenCalled();
  });

  it("/approve on a non-control-team issue still reaches the approval path", async () => {
    const { deps, linear, run, approvalGet } = buildDeps();
    vi.mocked(linear.getIssue).mockResolvedValue({
      ...controlIssue(),
      teamId: "team-other",
      teamName: "Other Team",
    });
    const server = createServer(deps);

    const res = await postComment(
      server,
      commentPayload("/approve", { issueId: "issue-other" })
    );

    expect(res.statusCode).toBe(200);
    expect(approvalGet).toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it("does not double-run a redelivered comment within the dedupe window", async () => {
    const { deps, linear, run } = buildDeps();
    vi.mocked(linear.getIssue).mockResolvedValue(controlIssue());
    const server = createServer(deps);

    const first = await postComment(server, commentPayload("project list"));
    const second = await postComment(server, commentPayload("project list"));

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("ignores a comment when the issue cannot be fetched", async () => {
    const { deps, linear, run } = buildDeps();
    vi.mocked(linear.getIssue).mockResolvedValue(null);
    const server = createServer(deps);

    const res = await postComment(server, commentPayload("project list"));

    expect(res.statusCode).toBe(200);
    expect(run).not.toHaveBeenCalled();
    expect(linear.postComment).not.toHaveBeenCalled();
  });

  it("ignores an empty comment", async () => {
    const { deps, linear, run } = buildDeps();
    vi.mocked(linear.getIssue).mockResolvedValue(controlIssue());
    const server = createServer(deps);

    const res = await postComment(server, commentPayload("   "));

    expect(res.statusCode).toBe(200);
    expect(run).not.toHaveBeenCalled();
    expect(linear.postComment).not.toHaveBeenCalled();
  });

  it("returns 400 for a malformed comment payload", async () => {
    const { deps, linear, run } = buildDeps();
    const server = createServer(deps);

    const res = await postComment(server, { type: "Comment", action: "create" });

    expect(res.statusCode).toBe(400);
    expect(run).not.toHaveBeenCalled();
    expect(linear.getIssue).not.toHaveBeenCalled();
  });
});

describe("Linear comment console with a real project control (registry listing)", () => {
  let projectsDir = "";

  beforeEach(() => {
    vi.clearAllMocks();
    projectsDir = mkdtempSync(path.join(os.tmpdir(), "nf-ctrl-real-"));
    const markerDir = path.join(projectsDir, "myapp", ".nightforge");
    mkdirSync(markerDir, { recursive: true });
    writeFileSync(path.join(markerDir, "project.yaml"), "id: myapp\nname: myapp\n", "utf8");
    mkdirSync(path.join(projectsDir, "stray"), { recursive: true });
    mkdirSync(path.join(projectsDir, "releases"), { recursive: true });
  });

  afterEach(() => {
    rmSync(projectsDir, { recursive: true, force: true });
  });

  function realServer(): {
    server: ReturnType<typeof createServer>;
    linear: ReturnType<typeof linearClientMock>;
  } {
    const linear = linearClientMock();
    vi.mocked(linear.getIssue).mockResolvedValue(controlIssue());
    const projectControl = createProjectControl({
      linearClient: linear,
      projectsDir,
      publicBaseUrl: "https://getnightforge.com",
      webhookSecret: SECRET,
      defaultProjectId: "nightforge",
    });
    const deps: ServerDeps = {
      linearClient: linear,
      scheduler: schedulerMock(),
      webhookSecret: SECRET,
      projectId: "nightforge",
      controlTeam: "team-ctrl",
      projectControl,
      approvalStore: {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn(),
        remove: vi.fn(),
      },
    };
    return { server: createServer(deps), linear };
  }

  it("lists only registered projects from a real registry on the server", async () => {
    const { server, linear } = realServer();

    const res = await postComment(server, commentPayload("project list"));

    expect(res.statusCode).toBe(200);
    const [issueId, reply] = vi.mocked(linear.postComment).mock.calls[0];
    expect(issueId).toBe("issue-ctrl");
    expect(reply).toContain("⚙️ Registered projects:");
    expect(reply).toContain("- **myapp**");
    expect(reply).not.toContain("stray");
    expect(reply).not.toContain("nightforge-app");
    expect(reply).not.toContain("releases");
  });

  it("ignores a random chat comment on the control home with real wiring", async () => {
    const { server, linear } = realServer();

    const res = await postComment(server, commentPayload("just saying hi 👋"));

    expect(res.statusCode).toBe(200);
    expect(linear.postComment).not.toHaveBeenCalled();
  });
});