import { describe, expect, it } from "vitest";
import {
  createProviderHealth,
  DEFAULT_PROVIDER_HEALTH_CONFIG,
} from "../src/router/provider-health.js";

const BASE = 1_000_000;
const config = { windowMs: 1000, failureThreshold: 3 };

describe("createProviderHealth", () => {
  it("treats unknown families as healthy", () => {
    const health = createProviderHealth(config);
    expect(health.isHealthy("qwen", BASE)).toBe(true);
    expect(health.unhealthyFamilies(BASE)).toEqual([]);
  });

  it("marks a family unhealthy at the failure threshold", () => {
    const health = createProviderHealth(config);
    health.recordOutcome("qwen", false, BASE);
    health.recordOutcome("qwen", false, BASE + 10);
    expect(health.isHealthy("qwen", BASE + 20)).toBe(true);
    health.recordOutcome("qwen", false, BASE + 30);
    expect(health.isHealthy("qwen", BASE + 40)).toBe(false);
    expect(health.unhealthyFamilies(BASE + 40)).toEqual(["qwen"]);
  });

  it("resets the streak on success", () => {
    const health = createProviderHealth(config);
    health.recordOutcome("qwen", false, BASE);
    health.recordOutcome("qwen", false, BASE + 10);
    health.recordOutcome("qwen", true, BASE + 20);
    health.recordOutcome("qwen", false, BASE + 30);
    expect(health.isHealthy("qwen", BASE + 40)).toBe(true);
  });

  it("decays failures out of the window", () => {
    const health = createProviderHealth(config);
    health.recordOutcome("qwen", false, BASE);
    health.recordOutcome("qwen", false, BASE + 10);
    health.recordOutcome("qwen", false, BASE + 20);
    expect(health.isHealthy("qwen", BASE + 30)).toBe(false);
    expect(health.isHealthy("qwen", BASE + 20 + config.windowMs)).toBe(true);
  });

  it("tracks families independently", () => {
    const health = createProviderHealth(config);
    for (let index = 0; index < 3; index += 1) {
      health.recordOutcome("deepseek", false, BASE + index);
    }
    health.recordOutcome("openai", false, BASE);
    expect(health.isHealthy("deepseek", BASE + 10)).toBe(false);
    expect(health.isHealthy("openai", BASE + 10)).toBe(true);
  });

  it("has a sane default configuration", () => {
    expect(DEFAULT_PROVIDER_HEALTH_CONFIG.failureThreshold).toBeGreaterThan(1);
    expect(DEFAULT_PROVIDER_HEALTH_CONFIG.windowMs).toBeGreaterThan(0);
  });
});
