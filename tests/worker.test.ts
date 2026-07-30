import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TicketJob } from "../src/queue/scheduler.js";
import type { ProjectConfig } from "../src/projects/registry.js";
import type { ModelProvider } from "../src/workers/worker.js";

/* eslint-disable @typescript-eslint/unbound-method */

describe("worker", () => {
  const mockJob: TicketJob = {
    ticketId: "ticket-123",
    projectId: "project-1",
    title: "Test ticket",
    description: "Implement a feature",
    labels: ["feature"],
    priority: 5,
    attempt: 1,
  };

  const mockProjectConfig: ProjectConfig = {
    id: "project-1",
    name: "Test Project",
    path: "/srv/apps/test",
    deployment: {
      policy: "direct-prod",
      testCommand: "echo test",
      lintCommand: "echo lint",
      typecheckCommand: "echo typecheck",
      buildCommand: "echo build",
      deployCommand: "echo deploy",
      healthcheckCommand: "echo health",
      rollbackCommand: "echo rollback",
    },
    concurrency: {
      maxWriteTasks: 1,
      maxReadonlyTasks: 3,
    },
    agent: {
      defaultModel: "qwen3.8",
      maxAttempts: 3,
      maxRuntimeMinutes: 90,
      maxTicketCostUsd: 8,
    },
    permissions: {
      allowedServices: [],
      prohibitedActions: [],
    },
    risk: {
      approvalRequiredFor: [],
    },
  };

  const mockModelProvider: ModelProvider = {
    generate: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return success when validation passes", async () => {
    vi.mocked(mockModelProvider.generate).mockResolvedValue({
      content: "Implementation code",
      tokensUsed: 1000,
      costUsd: 0.05,
    });

    const { executeWorker } = await import("../src/workers/worker.js");

    const result = await executeWorker(mockJob, {
      worktreePath: "/tmp/test-worktree",
      projectConfig: mockProjectConfig,
      modelProvider: mockModelProvider,
    });

    expect(mockModelProvider.generate).toHaveBeenCalledTimes(1);
    const firstCall = vi.mocked(mockModelProvider.generate).mock.calls[0] as
      | [string, { systemPromptBlocks: Array<{ text: string; cacheable?: boolean }> }]
      | undefined;
    expect(firstCall).toBeDefined();
    expect(firstCall?.[0]).toContain("Test ticket");
    expect(firstCall?.[1].systemPromptBlocks.length).toBeGreaterThan(0);
    expect(result.tokensUsed).toBe(1000);
    expect(result.costUsd).toBe(0.05);
  });

  it("should build layered prompt with ticket in user message and project in system blocks", async () => {
    vi.mocked(mockModelProvider.generate).mockResolvedValue({
      content: "Code",
      tokensUsed: 100,
      costUsd: 0.01,
    });

    const { executeWorker } = await import("../src/workers/worker.js");

    await executeWorker(mockJob, {
      worktreePath: "/tmp/test",
      projectConfig: mockProjectConfig,
      modelProvider: mockModelProvider,
    });

    const call = vi.mocked(mockModelProvider.generate).mock.calls[0] as
      | [string, { systemPromptBlocks?: Array<{ text: string; cacheable?: boolean }> }]
      | undefined;
    const userPrompt = call ? call[0] : "";
    const options = call ? call[1] : undefined;

    // User prompt contains ticket-specific content (Layer 4)
    expect(userPrompt).toContain("Test ticket");
    expect(userPrompt).toContain("Implement a feature");
    expect(userPrompt).toContain("feature");

    // System blocks contain stable project config (Layers 1-3)
    const blocks = options?.systemPromptBlocks ?? [];
    const allSystemText = blocks.map((b) => b.text).join("\n");
    expect(allSystemText).toContain("Test Project");
    expect(allSystemText).toContain("Nightforge");
    expect(blocks.every((b) => b.cacheable === true)).toBe(true);
  });
});

describe("worker pool", () => {
  it("should track active workers", async () => {
    const mockSandboxManager = {
      create: vi.fn().mockResolvedValue({
        worktreePath: "/tmp/test",
        cleanup: vi.fn().mockResolvedValue(undefined),
      }),
    };

    const { createWorkerPool } = await import("../src/workers/pool.js");

    const pool = createWorkerPool(
      mockSandboxManager,
      "/srv/apps/test",
      90
    );

    expect(pool.getActiveWorkers()).toBe(0);
  });

  it("should reject new tickets during shutdown", async () => {
    const mockSandboxManager = {
      create: vi.fn(),
    };

    const { createWorkerPool } = await import("../src/workers/pool.js");

    const pool = createWorkerPool(
      mockSandboxManager,
      "/srv/apps/test",
      90
    );

    await pool.shutdown();

    const mockJob: TicketJob = {
      ticketId: "ticket-1",
      projectId: "project-1",
      title: "Test",
      description: "",
      labels: [],
      priority: 5,
      attempt: 1,
    };

    await expect(
      pool.processTicket(mockJob, {} as ProjectConfig, {} as ModelProvider)
    ).rejects.toThrow("shutting down");
  });
});
