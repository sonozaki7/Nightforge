import { describe, it, expect, vi, beforeEach } from "vitest";
import { createExecutionPipeline, type PipelineDeps } from "../src/projects/pipeline.js";
import type { Deployer, DeployResult } from "../src/projects/deployer.js";
import type { AutoMerger, AutoMergeResult } from "../src/projects/auto-merge.js";
import type { HealthChecker, HealthCheckResult } from "../src/integrations/health.js";
import type { ProjectConfig } from "../src/projects/registry.js";

/* eslint-disable @typescript-eslint/unbound-method */

function mockProjectConfig(): ProjectConfig {
  return {
    id: "test-project",
    name: "Test Project",
    path: "/srv/apps/test/repository",
    deployment: {
      policy: "direct-prod",
      testCommand: "npm test",
      lintCommand: "npm run lint",
      typecheckCommand: "npx tsc --noEmit",
      buildCommand: "npm run build",
      deployCommand: "echo deploy",
      healthcheckCommand: "echo health",
      rollbackCommand: "echo rollback",
    },
    concurrency: { maxWriteTasks: 1, maxReadonlyTasks: 3 },
    agent: {
      defaultModel: "qwen3.8",
      maxAttempts: 3,
      maxRuntimeMinutes: 90,
      maxTicketCostUsd: 8,
    },
    permissions: { allowedServices: [], prohibitedActions: [] },
    risk: { approvalRequiredFor: [] },
  };
}

function mockMergeResult(overrides?: Partial<AutoMergeResult>): AutoMergeResult {
  return {
    success: true,
    commitSha: "abc123",
    mergeSha: "def456",
    tag: "deploy/TICKET-1",
    message: "Merged to main",
    ...overrides,
  };
}

function mockDeployResult(overrides?: Partial<DeployResult>): DeployResult {
  return {
    success: true,
    releasePath: "/srv/apps/test/releases/20260730-120000",
    previousReleasePath: "/srv/apps/test/releases/20260729-120000",
    message: "Deployed",
    ...overrides,
  };
}

function mockHealthResult(overrides?: Partial<HealthCheckResult>): HealthCheckResult {
  return {
    healthy: true,
    checks: [{ name: "healthcheck-command", passed: true, message: "ok", durationMs: 100 }],
    ...overrides,
  };
}

describe("ExecutionPipeline", () => {
  let deps: PipelineDeps;
  let mockAutoMerger: AutoMerger;
  let mockDeployer: Deployer;
  let mockHealthChecker: HealthChecker;

  beforeEach(() => {
    mockAutoMerger = {
      commitAndMerge: vi.fn().mockResolvedValue(mockMergeResult()),
      revertMerge: vi.fn().mockResolvedValue(true),
    };
    mockDeployer = {
      deploy: vi.fn().mockResolvedValue(mockDeployResult()),
      rollback: vi.fn().mockResolvedValue(mockDeployResult()),
      getCurrentRelease: vi.fn().mockResolvedValue("/srv/apps/test/releases/prev"),
      listReleases: vi.fn().mockResolvedValue(["release-1", "release-2"]),
    };
    mockHealthChecker = {
      verify: vi.fn().mockResolvedValue(mockHealthResult()),
      checkHttp: vi.fn().mockResolvedValue(true),
    };
    deps = {
      autoMerger: mockAutoMerger,
      deployer: mockDeployer,
      healthChecker: mockHealthChecker,
    };
  });

  it("ships successfully when all steps pass", async () => {
    const pipeline = createExecutionPipeline(deps);
    const result = await pipeline.execute(
      "/worktrees/test-TICKET-1",
      mockProjectConfig(),
      "TICKET-1",
      "Implemented feature X"
    );

    expect(result.success).toBe(true);
    expect(result.state).toBe("shipped");
    expect(result.merge?.tag).toBe("deploy/TICKET-1");
    expect(result.deploy?.success).toBe(true);
    expect(result.health?.healthy).toBe(true);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("returns merge_failed when auto-merge fails", async () => {
    (mockAutoMerger.commitAndMerge as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockMergeResult({ success: false, message: "Conflict detected", mergeSha: null })
    );

    const pipeline = createExecutionPipeline(deps);
    const result = await pipeline.execute(
      "/worktrees/test-TICKET-2",
      mockProjectConfig(),
      "TICKET-2",
      "Bad changes"
    );

    expect(result.success).toBe(false);
    expect(result.state).toBe("merge_failed");
    expect(result.deploy).toBeNull();
    expect(mockDeployer.deploy).not.toHaveBeenCalled();
  });

  it("reverts merge when deploy fails", async () => {
    (mockDeployer.deploy as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockDeployResult({ success: false, message: "Deploy command failed" })
    );

    const pipeline = createExecutionPipeline(deps);
    const result = await pipeline.execute(
      "/worktrees/test-TICKET-3",
      mockProjectConfig(),
      "TICKET-3",
      "Feature that breaks deploy"
    );

    expect(result.success).toBe(false);
    expect(result.state).toBe("deploy_failed");
    expect(mockAutoMerger.revertMerge).toHaveBeenCalledWith(
      "/srv/apps/test/repository",
      "def456"
    );
  });

  it("rolls back deploy AND reverts merge when health check fails", async () => {
    (mockHealthChecker.verify as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockHealthResult({ healthy: false })
    );

    const pipeline = createExecutionPipeline(deps);
    const result = await pipeline.execute(
      "/worktrees/test-TICKET-4",
      mockProjectConfig(),
      "TICKET-4",
      "Feature that breaks health"
    );

    expect(result.success).toBe(false);
    expect(result.state).toBe("rolled_back");
    expect(mockDeployer.rollback).toHaveBeenCalled();
    expect(mockAutoMerger.revertMerge).toHaveBeenCalledWith(
      "/srv/apps/test/repository",
      "def456"
    );
  });

  it("handles no-changes case gracefully", async () => {
    (mockAutoMerger.commitAndMerge as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockMergeResult({ mergeSha: null, commitSha: null, tag: null, message: "No changes produced" })
    );

    const pipeline = createExecutionPipeline(deps);
    const result = await pipeline.execute(
      "/worktrees/test-TICKET-5",
      mockProjectConfig(),
      "TICKET-5",
      "Ops-only ticket"
    );

    expect(result.success).toBe(true);
    expect(result.state).toBe("shipped");
    expect(result.deploy).toBeNull();
    expect(mockDeployer.deploy).not.toHaveBeenCalled();
  });
});
