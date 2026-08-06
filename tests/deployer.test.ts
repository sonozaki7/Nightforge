import { describe, it, expect } from "vitest";
import type { ProjectConfig } from "../src/projects/registry.js";

/* eslint-disable @typescript-eslint/unbound-method */

function testProjectConfig(projectPath: string): ProjectConfig {
  return {
    id: "test-project",
    name: "Test Project",
    path: projectPath,
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
    concurrency: { maxWriteTasks: 1, maxReadonlyTasks: 1 },
    agent: {
      defaultModel: "test-model",
      maxAttempts: 1,
      maxRuntimeMinutes: 1,
      maxTicketCostUsd: 1,
    },
    permissions: { allowedServices: [], prohibitedActions: [] },
    risk: { approvalRequiredFor: [] },
  };
}

describe("deployer", () => {
  it("should create deployer instance", async () => {
    const { createDeployer } = await import("../src/projects/deployer.js");
    const deployer = createDeployer();

    expect(deployer).toBeDefined();
    expect(deployer.deploy).toBeTypeOf("function");
    expect(deployer.rollback).toBeTypeOf("function");
    expect(deployer.getCurrentRelease).toBeTypeOf("function");
    expect(deployer.listReleases).toBeTypeOf("function");
  });

  it("should return empty list for non-existent releases", async () => {
    const { createDeployer } = await import("../src/projects/deployer.js");
    const deployer = createDeployer();

    const releases = await deployer.listReleases("/non/existent/path");
    expect(releases).toEqual([]);
  });

  it("should return null for non-existent current release", async () => {
    const { createDeployer } = await import("../src/projects/deployer.js");
    const deployer = createDeployer();

    const current = await deployer.getCurrentRelease("/non/existent/path");
    expect(current).toBeNull();
  });

  it("should never copy node_modules or .git into a release", async () => {
    const { createDeployer } = await import("../src/projects/deployer.js");
    const { mkdtemp, mkdir, writeFile, symlink, readdir } = await import(
      "node:fs/promises"
    );
    const os = await import("node:os");
    const path = await import("node:path");

    const root = await mkdtemp(path.join(os.tmpdir(), "nf-deploy-"));
    const sourcePath = path.join(root, "worktree");
    await mkdir(path.join(sourcePath, "dist"), { recursive: true });
    await writeFile(path.join(sourcePath, "dist", "main.js"), "// app");
    // The worktree's node_modules is a symlink into the origin repo;
    // carrying it into a release let the release's npm ci wipe origin.
    const originModules = path.join(root, "origin-modules");
    await mkdir(originModules, { recursive: true });
    await writeFile(path.join(originModules, "dep.js"), "// dep");
    await symlink(originModules, path.join(sourcePath, "node_modules"), "dir");

    const deployer = createDeployer();
    const result = await deployer.deploy(
      testProjectConfig(path.join(root, "project")),
      sourcePath
    );

    expect(result.success).toBe(true);
    expect(result.releasePath).not.toBeNull();
    const entries = await readdir(result.releasePath ?? "");
    expect(entries).toContain("dist");
    expect(entries).not.toContain("node_modules");
    expect(entries).not.toContain(".git");
    // The origin's dependencies must survive the deploy.
    const originEntries = await readdir(originModules);
    expect(originEntries).toContain("dep.js");
  });
});

describe("health checker", () => {
  it("should create health checker instance", async () => {
    const { createHealthChecker } = await import(
      "../src/integrations/health.js"
    );
    const checker = createHealthChecker();

    expect(checker).toBeDefined();
    expect(checker.verify).toBeTypeOf("function");
    expect(checker.checkHttp).toBeTypeOf("function");
  });
});
