import { describe, expect, it } from "vitest";
import { createReviewer, type ReviewInput } from "../src/queue/reviewer.js";

function input(overrides: Partial<ReviewInput>): ReviewInput {
  return {
    filesChanged: ["src/billing.ts"],
    allowedPaths: ["src/"],
    prohibitedPaths: ["infra/"],
    testResults: "12 passed",
    ...overrides,
  };
}

describe("createReviewer", () => {
  it("should approve a clean change inside ownership", async () => {
    const verdict = await createReviewer().review(input({}));
    expect(verdict.approved).toBe(true);
    expect(verdict.findings).toEqual([]);
  });

  it("should block when validation reports failures", async () => {
    const verdict = await createReviewer().review(
      input({ testResults: "3 failed, 9 passed" })
    );
    expect(verdict.approved).toBe(false);
    expect(verdict.findings.map((f) => f.rule)).toContain("tests-failing");
  });

  it("should block changes touching prohibited paths", async () => {
    const verdict = await createReviewer().review(
      input({ filesChanged: ["src/billing.ts", "infra/prod.yaml"] })
    );
    expect(verdict.approved).toBe(false);
    expect(verdict.findings.map((f) => f.rule)).toContain("prohibited-path");
  });

  it("should warn but not block on out-of-scope files", async () => {
    const verdict = await createReviewer().review(
      input({ filesChanged: ["src/billing.ts", "docs/readme.md"] })
    );
    expect(verdict.approved).toBe(true);
    expect(verdict.findings).toEqual([
      expect.objectContaining({ rule: "out-of-scope", severity: "warning" }),
    ]);
  });

  it("should skip scope checks when no ownership is declared", async () => {
    const verdict = await createReviewer().review(
      input({ allowedPaths: [], filesChanged: ["anything.txt"] })
    );
    expect(verdict.approved).toBe(true);
    expect(verdict.findings).toEqual([]);
  });

  it("should flag a success with zero changed files", async () => {
    const verdict = await createReviewer().review(input({ filesChanged: [] }));
    expect(verdict.approved).toBe(true);
    expect(verdict.findings.map((f) => f.rule)).toEqual(["no-changes"]);
  });
});
