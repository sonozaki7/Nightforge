import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import { createServer } from "../src/server.js";
import type { LinearClient } from "../src/integrations/linear.js";
import type { Scheduler } from "../src/queue/scheduler.js";

/* eslint-disable @typescript-eslint/unbound-method */

describe("Linear webhook integration", () => {
  const webhookSecret = "test-secret";
  const projectId = "test-project";

  const mockLinearClient: LinearClient = {
    verifyWebhookSignature: vi.fn(),
    getIssue: vi.fn(),
    postComment: vi.fn(),
    updateIssueState: vi.fn(),
  };

  const mockScheduler: Scheduler = {
    enqueue: vi.fn(),
    getQueueStats: vi.fn(),
    close: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const createTestServer = (): FastifyInstance =>
    createServer({
      linearClient: mockLinearClient,
      scheduler: mockScheduler,
      webhookSecret,
      projectId,
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
      payload: { ...validPayload, type: "Comment" },
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
});
