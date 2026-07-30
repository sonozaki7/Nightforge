import { describe, it, expect } from "vitest";

/* eslint-disable @typescript-eslint/unbound-method */

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
