import { describe, it, expect } from "vitest";
import { parseProjectConfig } from "../src/projects/registry.js";

describe("parseProjectConfig", () => {
  const validConfig = {
    id: "my-saas",
    name: "My SaaS Product",
    path: "/srv/apps/my-saas/repository",
    deployment: {
      policy: "direct-prod",
      testCommand: "npm test",
      lintCommand: "npm run lint",
      typecheckCommand: "npx tsc --noEmit",
      buildCommand: "npm run build",
      deployCommand: "./ops/deploy.sh",
      healthcheckCommand: "./ops/healthcheck.sh",
      rollbackCommand: "./ops/rollback.sh",
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
      allowedServices: ["github", "sentry"],
      prohibitedActions: ["delete-production-database"],
    },
    risk: {
      approvalRequiredFor: ["billing", "authentication"],
    },
  };

  it("should parse valid project configuration", () => {
    const config = parseProjectConfig(validConfig);

    expect(config.id).toBe("my-saas");
    expect(config.name).toBe("My SaaS Product");
    expect(config.path).toBe("/srv/apps/my-saas/repository");
    expect(config.deployment.policy).toBe("direct-prod");
    expect(config.deployment.testCommand).toBe("npm test");
    expect(config.concurrency.maxWriteTasks).toBe(1);
    expect(config.agent.defaultModel).toBe("qwen3.8");
    expect(config.agent.maxAttempts).toBe(3);
    expect(config.permissions.allowedServices).toContain("github");
    expect(config.risk.approvalRequiredFor).toContain("billing");
  });

  it("should apply default values for optional fields", () => {
    const minimalConfig = {
      id: "minimal",
      name: "Minimal Project",
      path: "/srv/apps/minimal",
      deployment: {
        policy: "staging-first",
        testCommand: "npm test",
        lintCommand: "npm run lint",
        typecheckCommand: "tsc --noEmit",
        buildCommand: "npm run build",
        deployCommand: "./deploy.sh",
        healthcheckCommand: "./health.sh",
        rollbackCommand: "./rollback.sh",
      },
    };

    const config = parseProjectConfig(minimalConfig);

    expect(config.concurrency.maxWriteTasks).toBe(1);
    expect(config.concurrency.maxReadonlyTasks).toBe(3);
    expect(config.agent.defaultModel).toBe("qwen3.8");
    expect(config.agent.maxAttempts).toBe(3);
    expect(config.agent.maxRuntimeMinutes).toBe(90);
    expect(config.agent.maxTicketCostUsd).toBe(8);
    expect(config.permissions.allowedServices).toEqual([]);
    expect(config.permissions.prohibitedActions).toEqual([]);
    expect(config.risk.approvalRequiredFor).toEqual([]);
  });

  it("should reject invalid deployment policy", () => {
    const invalidConfig = {
      ...validConfig,
      deployment: {
        ...validConfig.deployment,
        policy: "invalid-policy",
      },
    };

    expect(() => parseProjectConfig(invalidConfig)).toThrow(
      "Project configuration validation failed"
    );
  });

  it("should reject missing required fields", () => {
    const incompleteConfig = {
      id: "incomplete",
      name: "Incomplete Project",
    };

    expect(() => parseProjectConfig(incompleteConfig)).toThrow(
      "Project configuration validation failed"
    );
  });

  it("should reject empty id", () => {
    const emptyIdConfig = {
      ...validConfig,
      id: "",
    };

    expect(() => parseProjectConfig(emptyIdConfig)).toThrow(
      "Project configuration validation failed"
    );
  });

  it("should accept all valid deployment policies", () => {
    const policies = ["direct-prod", "staging-first", "manual-prod"] as const;

    for (const policy of policies) {
      const config = parseProjectConfig({
        ...validConfig,
        deployment: { ...validConfig.deployment, policy },
      });
      expect(config.deployment.policy).toBe(policy);
    }
  });
});
