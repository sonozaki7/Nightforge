import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  const validEnv = {
    REDIS_URL: "redis://localhost:6379",
    LINEAR_API_KEY: "lin_test_key",
    LINEAR_WEBHOOK_SECRET: "webhook_secret",
    DASHSCOPE_API_KEY: "dash_key",
    ANTHROPIC_API_KEY: "anth_key",
    OPENROUTER_API_KEY: "or_key",
    PROJECTS_DIR: "/srv/apps",
    WORKTREES_DIR: "/srv/nightforge/worktrees",
    MAX_CONCURRENT_WORKERS: "6",
    MAX_DAILY_BUDGET_USD: "50",
    TIMEZONE: "Asia/Bangkok",
    PORT: "3000",
    HOST: "0.0.0.0",
  };

  it("should load valid configuration", () => {
    const config = loadConfig(validEnv);

    expect(config.redis.url).toBe("redis://localhost:6379");
    expect(config.linear.apiKey).toBe("lin_test_key");
    expect(config.linear.webhookSecret).toBe("webhook_secret");
    expect(config.providers.dashscope.apiKey).toBe("dash_key");
    expect(config.providers.anthropic.apiKey).toBe("anth_key");
    expect(config.limits.maxConcurrentWorkers).toBe(6);
    expect(config.limits.maxDailyBudgetUsd).toBe(50);
    expect(config.timezone).toBe("Asia/Bangkok");
    expect(config.server.port).toBe(3000);
  });

  it("should apply default values for optional fields", () => {
    const minimalEnv = {
      LINEAR_API_KEY: "lin_test_key",
      LINEAR_WEBHOOK_SECRET: "webhook_secret",
      DASHSCOPE_API_KEY: "dash_key",
      ANTHROPIC_API_KEY: "anth_key",
      OPENROUTER_API_KEY: "or_key",
    };

    const config = loadConfig(minimalEnv);

    expect(config.redis.url).toBe("redis://localhost:6379");
    expect(config.paths.projectsDir).toBe("/srv/apps");
    expect(config.paths.worktreesDir).toBe("/srv/nightforge/worktrees");
    expect(config.limits.maxConcurrentWorkers).toBe(6);
    expect(config.limits.maxDailyBudgetUsd).toBe(50);
    expect(config.timezone).toBe("Asia/Bangkok");
    expect(config.server.port).toBe(3000);
    expect(config.server.host).toBe("0.0.0.0");
  });

  it("should throw on missing required fields", () => {
    const incompleteEnv = {
      REDIS_URL: "redis://localhost:6379",
    };

    expect(() => loadConfig(incompleteEnv)).toThrow(
      "Configuration validation failed"
    );
  });

  it("should throw with descriptive error for missing LINEAR_API_KEY", () => {
    const envWithoutLinear = {
      ...validEnv,
      LINEAR_API_KEY: undefined,
    };

    expect(() => loadConfig(envWithoutLinear)).toThrow("linear.apiKey");
  });

  it("should coerce numeric strings to numbers", () => {
    const config = loadConfig({
      ...validEnv,
      MAX_CONCURRENT_WORKERS: "10",
      MAX_DAILY_BUDGET_USD: "100",
      PORT: "8080",
    });

    expect(config.limits.maxConcurrentWorkers).toBe(10);
    expect(config.limits.maxDailyBudgetUsd).toBe(100);
    expect(config.server.port).toBe(8080);
  });
});
