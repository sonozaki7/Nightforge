import { describe, it, expect } from "vitest";
import {
  complexityScore,
  resolveExecutionMode,
  DEFAULT_EXECUTION_MODE_CONFIG,
} from "../src/queue/execution-mode.js";
import type { TicketJob } from "../src/queue/scheduler.js";

function job(overrides: Partial<TicketJob>): TicketJob {
  return {
    ticketId: "T-1",
    projectId: "proj",
    title: "Fix the bug",
    description: "",
    labels: [],
    priority: 5,
    attempt: 1,
    ...overrides,
  };
}

describe("complexityScore", () => {
  it("scores a trivial ticket low", () => {
    const score = complexityScore(
      job({ title: "Fix typo", description: "Change 'teh' to 'the' in the header." })
    );
    expect(score).toBeLessThan(3);
  });

  it("scores a long, multi-step ticket high", () => {
    const description = [
      "Migrate the authentication flow to the new billing system.",
      "Acceptance: users can log in across the codebase.",
      "Acceptance: billing integration returns correct charges.",
      "Acceptance: security review passes.",
      "This is a breaking change and requires a database schema migration.",
    ].join("\n");
    const score = complexityScore(job({ title: "Auth + billing migration", description }));
    expect(score).toBeGreaterThanOrEqual(3);
  });

  it("adds points for risk labels", () => {
    const low = complexityScore(job({ description: "small change" }));
    const high = complexityScore(
      job({ description: "small change", labels: ["security"] })
    );
    expect(high).toBeGreaterThan(low);
  });

  it("adds points for explicit acceptance criteria", () => {
    const withCriteria = complexityScore(
      job({
        description:
          "Given a user logs in, When they click X, Then Y happens. Acceptance: Z works.",
      })
    );
    const without = complexityScore(job({ description: "just do it" }));
    expect(withCriteria).toBeGreaterThan(without);
  });
});

describe("resolveExecutionMode", () => {
  it("routes a trivial ticket to plain automatically (no label)", () => {
    const mode = resolveExecutionMode(
      job({ title: "Fix typo", description: "Small change." }),
      DEFAULT_EXECUTION_MODE_CONFIG
    );
    expect(mode).toBe("plain");
  });

  it("routes a complex ticket to agentic automatically (no label)", () => {
    const mode = resolveExecutionMode(
      job({
        title: "Auth migration",
        description: [
          "Migrate authentication across the codebase.",
          "Acceptance: login works. Acceptance: billing works. Acceptance: security.",
          "Breaking change with database schema migration.",
        ].join("\n"),
      }),
      DEFAULT_EXECUTION_MODE_CONFIG
    );
    expect(mode).toBe("agentic");
  });

  it("honors the 'agentic' label as a forced override", () => {
    const mode = resolveExecutionMode(
      job({ description: "tiny", labels: ["agentic"] }),
      DEFAULT_EXECUTION_MODE_CONFIG
    );
    expect(mode).toBe("agentic");
  });

  it("honors the 'plain' label as a forced override", () => {
    const mode = resolveExecutionMode(
      job({
        description: "huge migration with security and billing",
        labels: ["plain"],
      }),
      DEFAULT_EXECUTION_MODE_CONFIG
    );
    expect(mode).toBe("plain");
  });

  it("returns plain when auto-routing is disabled", () => {
    const mode = resolveExecutionMode(
      job({ description: "huge migration with security and billing" }),
      { ...DEFAULT_EXECUTION_MODE_CONFIG, autoRoute: false }
    );
    expect(mode).toBe("plain");
  });

  it("respects a custom threshold", () => {
    // Very low threshold: even small tickets go agentic.
    const mode = resolveExecutionMode(
      job({ description: "tiny" }),
      { ...DEFAULT_EXECUTION_MODE_CONFIG, agenticThreshold: 0 }
    );
    expect(mode).toBe("agentic");
  });
});