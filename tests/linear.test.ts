import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import { createServer } from "../src/server.js";
import type { LinearClient } from "../src/integrations/linear.js";
import type { Scheduler } from "../src/queue/scheduler.js";
import type { EpicDispatch } from "../src/epic/epic-dispatch.js";
import type { ApprovalStore, ApprovalRecord } from "../src/queue/approvals.js";
import type { TeamRouter } from "../src/projects/team-router.js";

/* eslint-disable @typescript-eslint/unbound-method */

describe("Linear webhook integration", () => {
  const webhookSecret = "test-secret";
  const projectId = "test-project";

  const mockLinearClient: LinearClient = {
    verifyWebhookSignature: vi.fn(),
    getIssue: vi.fn(),
    getChildIssues: vi.fn(),
    postComment: vi.fn(),
    updateIssueState: vi.fn(),
    listTeams: vi.fn(),
    createTeam: vi.fn(),
    createWebhook: vi.fn(),
    listWebhooks: vi.fn(),
    updateWebhook: vi.fn(),
    createIssue: vi.fn(),
    listTeamIssues: vi.fn(),
    listTeamStates: vi.fn(),
  };

  const mockScheduler: Scheduler = {
    enqueue: vi.fn(),
    enqueueAndWait: vi.fn(),
    getQueueStats: vi.fn(),
    close: vi.fn(),
  };

  const mockApprovalStore: ApprovalStore = {
    save: vi.fn(),
    get: vi.fn(),
    remove: vi.fn(),
    list: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const createTestServer = (epicDispatch?: EpicDispatch): FastifyInstance =>
    createServer({
      linearClient: mockLinearClient,
      scheduler: mockScheduler,
      webhookSecret,
      projectId,
      approvalStore: mockApprovalStore,
      epicDispatch,
    });

  const validPayload = {
    action: "update",
    type: "Issue",
    data: {
      id: "issue-123",
      title: "Test ticket",
      description: "Test description",
      priority: 2,
      state: { name: "Ready for AI" },
      labels: [{ name: "feature" }],
    },
  };

  it("should return 401 when signature is missing", async () => {
    const server = createTestServer();

    const response = await server.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: validPayload,
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "Missing signature" });
  });

  it("should return 401 when signature is invalid", async () => {
    vi.mocked(mockLinearClient.verifyWebhookSignature).mockReturnValue(false);

    const server = createTestServer();

    const response = await server.inject({
      method: "POST",
      url: "/webhooks/linear",
      headers: { "linear-signature": "invalid" },
      payload: validPayload,
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "Invalid signature" });
  });

  it("should ignore non-Issue webhooks", async () => {
    vi.mocked(mockLinearClient.verifyWebhookSignature).mockReturnValue(true);

    const server = createTestServer();

    const response = await server.inject({
      method: "POST",
      url: "/webhooks/linear",
      headers: { "linear-signature": "valid" },
      payload: { ...validPayload, type: "IssueLabel" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ message: "Ignored" });
    expect(mockScheduler.enqueue).not.toHaveBeenCalled();
  });

  it("should ignore non-trigger state changes", async () => {
    vi.mocked(mockLinearClient.verifyWebhookSignature).mockReturnValue(true);

    const server = createTestServer();

    const response = await server.inject({
      method: "POST",
      url: "/webhooks/linear",
      headers: { "linear-signature": "valid" },
      payload: {
        ...validPayload,
        data: { ...validPayload.data, state: { name: "In Progress" } },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ message: "State not triggered" });
    expect(mockScheduler.enqueue).not.toHaveBeenCalled();
  });

  it("should enqueue ticket and post comment on valid webhook", async () => {
    vi.mocked(mockLinearClient.verifyWebhookSignature).mockReturnValue(true);
    vi.mocked(mockScheduler.enqueue).mockResolvedValue("job-123");
    vi.mocked(mockLinearClient.postComment).mockResolvedValue(undefined);

    const server = createTestServer();

    const response = await server.inject({
      method: "POST",
      url: "/webhooks/linear",
      headers: { "linear-signature": "valid" },
      payload: validPayload,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ message: "Ticket enqueued" });

    expect(mockScheduler.enqueue).toHaveBeenCalledWith({
      ticketId: "issue-123",
      projectId: "test-project",
      title: "Test ticket",
      description: "Test description",
      labels: ["feature"],
      priority: 2,
      attempt: 1,
    });

    expect(mockLinearClient.postComment).toHaveBeenCalledWith(
      "issue-123",
      expect.stringContaining("Nightforge claimed")
    );
  });

  it("should route a ticket to the project mapped to its Linear team", async () => {
    vi.mocked(mockLinearClient.verifyWebhookSignature).mockReturnValue(true);
    vi.mocked(mockScheduler.enqueue).mockResolvedValue("job-123");
    vi.mocked(mockLinearClient.postComment).mockResolvedValue(undefined);

    const mockTeamRouter: TeamRouter = {
      resolveProjectForTeam: vi.fn().mockImplementation((team: string) => {
        return team === "TEAM-ABC" ? "backend" : null;
      }),
      listProjects: vi.fn().mockReturnValue(["backend"]),
    };

    const server = createServer({
      linearClient: mockLinearClient,
      scheduler: mockScheduler,
      webhookSecret,
      projectId,
      approvalStore: mockApprovalStore,
      teamRouter: mockTeamRouter,
    });

    const response = await server.inject({
      method: "POST",
      url: "/webhooks/linear",
      headers: { "linear-signature": "valid" },
      payload: {
        ...validPayload,
        data: {
          ...validPayload.data,
          team: { id: "TEAM-ABC", name: "Backend" },
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(mockScheduler.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "backend" })
    );
  });

  it("should fall back to the default project for unmapped teams", async () => {
    vi.mocked(mockLinearClient.verifyWebhookSignature).mockReturnValue(true);
    vi.mocked(mockScheduler.enqueue).mockResolvedValue("job-123");
    vi.mocked(mockLinearClient.postComment).mockResolvedValue(undefined);

    const mockTeamRouter: TeamRouter = {
      resolveProjectForTeam: vi.fn().mockReturnValue(null),
      listProjects: vi.fn().mockReturnValue([]),
    };

    const server = createServer({
      linearClient: mockLinearClient,
      scheduler: mockScheduler,
      webhookSecret,
      projectId,
      approvalStore: mockApprovalStore,
      teamRouter: mockTeamRouter,
    });

    const response = await server.inject({
      method: "POST",
      url: "/webhooks/linear",
      headers: { "linear-signature": "valid" },
      payload: {
        ...validPayload,
        data: {
          ...validPayload.data,
          team: { id: "OTHER", name: "Other" },
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(mockScheduler.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "test-project" })
    );
  });

  it("routes control-team tickets to the project control handler", async () => {
    vi.mocked(mockLinearClient.verifyWebhookSignature).mockReturnValue(true);
    vi.mocked(mockLinearClient.postComment).mockResolvedValue(undefined);

    const controlRun = vi.fn().mockResolvedValue(
      "✅ Project **backend** added and ready."
    );

    const server = createServer({
      linearClient: mockLinearClient,
      scheduler: mockScheduler,
      webhookSecret,
      projectId,
      approvalStore: mockApprovalStore,
      controlTeam: "Nightforge Control",
      projectControl: { run: controlRun },
    });

    const response = await server.inject({
      method: "POST",
      url: "/webhooks/linear",
      headers: { "linear-signature": "valid" },
      payload: {
        ...validPayload,
        data: {
          ...validPayload.data,
          team: { id: "ctrl-team", name: "Nightforge Control" },
          title: "project add https://github.com/sonozaki7/backend",
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(mockScheduler.enqueue).not.toHaveBeenCalled();
    expect(controlRun).toHaveBeenCalled();
    expect(mockLinearClient.postComment).toHaveBeenCalledWith(
      "issue-123",
      expect.stringContaining("Project **backend** added")
    );
  });

  it("should route epic-labeled issues through the epic dispatch", async () => {
    vi.mocked(mockLinearClient.verifyWebhookSignature).mockReturnValue(true);
    vi.mocked(mockLinearClient.postComment).mockResolvedValue(undefined);

    const mockEpicDispatch: EpicDispatch = {
      isEpic: vi.fn().mockReturnValue(true),
      handle: vi.fn().mockResolvedValue({
        epicId: "issue-123",
        atomic: false,
        atomizerReason: "Decomposed into 2 tasks with exclusive ownership",
        epic: { message: "All 2 tasks completed" },
        state: "accepted",
      }),
    };

    const server = createTestServer(mockEpicDispatch);

    const response = await server.inject({
      method: "POST",
      url: "/webhooks/linear",
      headers: { "linear-signature": "valid-signature" },
      payload: {
        ...validPayload,
        data: { ...validPayload.data, labels: [{ name: "epic" }] },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ message: "Epic accepted" });
    expect(mockEpicDispatch.handle).toHaveBeenCalled();
    expect(mockScheduler.enqueue).not.toHaveBeenCalled();
    expect(mockLinearClient.postComment).toHaveBeenCalledWith(
      "issue-123",
      expect.stringContaining("Epic accepted")
    );
  });

  it("should return health status", async () => {
    const server = createTestServer();

    const response = await server.inject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveProperty("status", "ok");
    expect(response.json()).toHaveProperty("uptime");
  });
});

describe("Linear comment approval", () => {
  const webhookSecret = "test-secret";
  const projectId = "test-project";

  const mockLinearClient: LinearClient = {
    verifyWebhookSignature: vi.fn().mockReturnValue(true),
    getIssue: vi.fn().mockResolvedValue({
      id: "issue-123",
      identifier: "TEST-1",
      title: "Test",
      description: "",
      priority: 0,
      labels: [],
      stateName: "Todo",
      teamId: "team-other",
      teamName: "Other Team",
    }),
    getChildIssues: vi.fn(),
    postComment: vi.fn().mockResolvedValue(undefined),
    updateIssueState: vi.fn(),
    createIssue: vi.fn(),
    listTeamIssues: vi.fn(),
    listTeamStates: vi.fn(),
    listWebhooks: vi.fn(),
    updateWebhook: vi.fn(),
  };

  const mockScheduler: Scheduler = {
    enqueue: vi.fn().mockResolvedValue("job-1"),
    enqueueAndWait: vi.fn(),
    getQueueStats: vi.fn(),
    close: vi.fn(),
  };

  const pendingRecord = {
    job: { ticketId: "issue-123", projectId, title: "Test", description: "", labels: [], priority: 5, attempt: 1 },
    contract: {},
    worktreePath: "/tmp/worktree",
    summary: "implemented",
    riskReason: "high-risk classes detected",
    createdAt: 1,
    expiresAt: Date.now() + 3600_000,
  } as unknown as ApprovalRecord;

  const mockApprovalStore: ApprovalStore = {
    save: vi.fn(),
    get: vi.fn(),
    remove: vi.fn(),
    list: vi.fn(),
  };

  const commentPayload = {
    action: "create",
    type: "Comment",
    data: { id: "comment-1", body: "/approve", issueId: "issue-123" },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mockLinearClient.verifyWebhookSignature).mockReturnValue(true);
    vi.mocked(mockLinearClient.postComment).mockResolvedValue(undefined);
    vi.mocked(mockScheduler.enqueue).mockResolvedValue("job-1");
  });

  const createServer_ = (): FastifyInstance =>
    createServer({
      linearClient: mockLinearClient,
      scheduler: mockScheduler,
      webhookSecret,
      projectId,
      approvalStore: mockApprovalStore,
    });

  it("should enqueue a release job when a comment approves a pending ticket", async () => {
    vi.mocked(mockApprovalStore.get).mockResolvedValue(pendingRecord);

    const server = createServer_();
    const response = await server.inject({
      method: "POST",
      url: "/webhooks/linear",
      headers: { "linear-signature": "valid" },
      payload: commentPayload,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ message: "Approval queued" });
    expect(mockApprovalStore.get).toHaveBeenCalledWith("issue-123");
    expect(mockScheduler.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        ticketId: "issue-123",
        approvalGranted: true,
      })
    );
    expect(mockLinearClient.postComment).toHaveBeenCalledWith(
      "issue-123",
      expect.stringContaining("Approval received")
    );
  });

  it("should ignore comments without the approve trigger", async () => {
    const server = createServer_();
    const response = await server.inject({
      method: "POST",
      url: "/webhooks/linear",
      headers: { "linear-signature": "valid" },
      payload: {
        ...commentPayload,
        data: { ...commentPayload.data, body: "Looks good to me" },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      message: "Ignored (no approval trigger)",
    });
    expect(mockScheduler.enqueue).not.toHaveBeenCalled();
  });

  it("should ignore approvals when no ticket is pending", async () => {
    vi.mocked(mockApprovalStore.get).mockResolvedValue(null);

    const server = createServer_();
    const response = await server.inject({
      method: "POST",
      url: "/webhooks/linear",
      headers: { "linear-signature": "valid" },
      payload: commentPayload,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      message: "No pending approval for ticket",
    });
    expect(mockScheduler.enqueue).not.toHaveBeenCalled();
  });

  it("should honor an explicit ticket id in the approve comment", async () => {
    vi.mocked(mockApprovalStore.get).mockResolvedValue(pendingRecord);

    const server = createServer_();
    await server.inject({
      method: "POST",
      url: "/webhooks/linear",
      headers: { "linear-signature": "valid" },
      payload: {
        ...commentPayload,
        data: { ...commentPayload.data, body: "/approve other-ticket" },
      },
    });

    expect(mockApprovalStore.get).toHaveBeenCalledWith("other-ticket");
  });

  it("should ignore comment update events", async () => {
    vi.mocked(mockApprovalStore.get).mockResolvedValue(pendingRecord);

    const server = createServer_();
    const response = await server.inject({
      method: "POST",
      url: "/webhooks/linear",
      headers: { "linear-signature": "valid" },
      payload: { ...commentPayload, action: "update" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ message: "Ignored" });
    expect(mockScheduler.enqueue).not.toHaveBeenCalled();
  });
});

describe("Linear signature verification", () => {
  it("should verify valid HMAC-SHA256 signature", async () => {
    const { createLinearClient } = await import(
      "../src/integrations/linear.js"
    );
    const client = createLinearClient("test-key");

    const payload = '{"test": "data"}';
    const secret = "my-secret";
    const signature = crypto
      .createHmac("sha256", secret)
      .update(payload)
      .digest("hex");

    const result = client.verifyWebhookSignature(payload, signature, secret);
    expect(result).toBe(true);
  });

  it("should reject invalid signature", async () => {
    const { createLinearClient } = await import(
      "../src/integrations/linear.js"
    );
    const client = createLinearClient("test-key");

    const payload = '{"test": "data"}';
    const secret = "my-secret";
    const invalidSignature = "a".repeat(64);

    const result = client.verifyWebhookSignature(
      payload,
      invalidSignature,
      secret
    );
    expect(result).toBe(false);
  });

  it("should reject malformed signatures without throwing", async () => {
    const { createLinearClient } = await import(
      "../src/integrations/linear.js"
    );
    const client = createLinearClient("test-key");

    const payload = '{"test": "data"}';
    const secret = "my-secret";

    for (const malformed of ["", "short", "base64-not-hex=="]) {
      const result = client.verifyWebhookSignature(payload, malformed, secret);
      expect(result).toBe(false);
    }
  });
});
