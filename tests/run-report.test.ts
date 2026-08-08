import { describe, it, expect } from "vitest";
import { buildShippedComment } from "../src/integrations/run-report.js";
import type { PipelineResult } from "../src/projects/pipeline.js";

const pipeline: PipelineResult = {
  success: true,
  state: "shipped",
  merge: {
    success: true,
    commitSha: "c2328fa0a3a38f3ec5df59fa1791e3f71e09bece",
    mergeSha: "6b07d4d8d70cbb7eb01a46942b79ad0bf0cd4b67",
    tag: "deploy/abc-123",
    message: "Merged to main, tagged deploy/abc-123",
  },
  deploy: {
    success: true,
    releasePath: "/opt/nightforge/projects/releases/20260805-183532",
    previousReleasePath: null,
    message: "Deployed release 20260805-183532",
  },
  health: null,
  ciGate: null,
  durationMs: 4637,
  message: "Shipped. Tag: deploy/abc-123. Duration: 4637ms",
};

describe("buildShippedComment", () => {
  it("should report changes, model, token split, and cost", () => {
    const comment = buildShippedComment({
      summary: "Implemented: Add version line",
      filesChanged: ["README.md"],
      model: "qwen3.8-max",
      tokensUsed: 3398,
      inputTokens: 2870,
      outputTokens: 528,
      costUsd: 0.0001,
      durationMs: 115000,
      pipeline,
    });

    expect(comment).toContain("✅ Shipped: Implemented: Add version line");
    expect(comment).toContain("**Changes (1 file)**");
    expect(comment).toContain("- `README.md`");
    expect(comment).toContain("Commit: `c2328fa`");
    expect(comment).toContain("Tag: `deploy/abc-123`");
    expect(comment).toContain("Release: 20260805-183532");
    expect(comment).toContain("Model: qwen3.8-max");
    expect(comment).toContain("Tokens: 2870 in / 528 out (3398 total)");
    expect(comment).toContain("Cost: $0.0001");
    expect(comment).toContain("Duration: 115s");
  });

  it("should fall back to total tokens when the split is unknown", () => {
    const comment = buildShippedComment({
      summary: "Implemented: x",
      filesChanged: [],
      model: "qwen3-235b-a22b",
      tokensUsed: 500,
      costUsd: 0.01,
      durationMs: 4200,
      pipeline: null,
    });

    expect(comment).toContain("Tokens: 500 total");
    expect(comment).toContain("Pipeline: no deploy needed");
    expect(comment).not.toContain("**Changes");
  });
});
