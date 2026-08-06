import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TicketJob } from "../src/queue/scheduler.js";
import type { ProjectConfig } from "../src/projects/registry.js";
import type { ModelProvider } from "../src/workers/worker.js";

/* eslint-disable @typescript-eslint/unbound-method */

describe("worker overwrite guard", () => {
  const mockJob: TicketJob = {
    ticketId: "ticket-guard",
    projectId: "project-1",
    title: "Test ticket",
    description: "Implement a feature",
    labels: ["feature"],
    priority: 5,
    attempt: 1,
  };

  const mockProjectConfig: ProjectConfig = {
    id: "project-1",
    name: "Project 1",
    path: "/tmp/project-1",
    deployment: {
      policy: "direct-prod",
      testCommand: "true",
      lintCommand: "true",
      typecheckCommand: "true",
      buildCommand: "true",
      deployCommand: "true",
      healthcheckCommand: "true",
      rollbackCommand: "true",
    },
    concurrency: { maxWriteTasks: 2, maxReadonlyTasks: 3 },
    agent: {
      defaultModel: "qwen3.8",
      maxAttempts: 3,
      maxRuntimeMinutes: 90,
      maxTicketCostUsd: 8,
    },
    permissions: { allowedServices: [], prohibitedActions: [] },
    risk: { approvalRequiredFor: [] },
  };

  const mockModelProvider: ModelProvider = { generate: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function repoWithCommittedFile(relPath: string, content: string): string {
    const worktree = mkdtempSync(join(tmpdir(), "nf-worker-guard-"));
    writeFileSync(join(worktree, relPath), content);
    execFileSync("git", ["init", "-q"], { cwd: worktree });
    execFileSync("git", ["add", "-A"], { cwd: worktree });
    execFileSync(
      "git",
      ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "init"],
      { cwd: worktree }
    );
    return worktree;
  }

  it("should reject a change that destroys most of an existing file", async () => {
    const original = Array.from({ length: 30 }, (_, i) => `line ${String(i)}`).join("\n") + "\n";
    const worktree = repoWithCommittedFile("README.md", original);
    vi.mocked(mockModelProvider.generate).mockResolvedValue({
      content: "```file:README.md\none line only\n```",
      tokensUsed: 10,
      costUsd: 0.001,
    });

    const { executeWorker } = await import("../src/workers/worker.js");
    const result = await executeWorker(mockJob, {
      worktreePath: worktree,
      projectConfig: mockProjectConfig,
      modelProvider: mockModelProvider,
    });

    expect(result.success).toBe(false);
    expect(result.summary).toContain("Destructive overwrite rejected");
    expect(result.summary).toContain("README.md");
  });

  it("should allow changes that preserve most of an existing file", async () => {
    const original = Array.from({ length: 20 }, (_, i) => `line ${String(i)}`).join("\n") + "\n";
    const worktree = repoWithCommittedFile("README.md", original);
    const updated = original + "added line\n";
    vi.mocked(mockModelProvider.generate).mockResolvedValue({
      content: `\`\`\`file:README.md\n${updated}\`\`\``,
      tokensUsed: 10,
      costUsd: 0.001,
    });

    const { executeWorker } = await import("../src/workers/worker.js");
    const result = await executeWorker(mockJob, {
      worktreePath: worktree,
      projectConfig: mockProjectConfig,
      modelProvider: mockModelProvider,
    });

    expect(result.success).toBe(true);
    expect(result.filesChanged).toContain("README.md");
  });
});
