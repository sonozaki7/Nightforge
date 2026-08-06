import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildRepoContext,
  renderRepoContext,
  DEFAULT_REPO_CONTEXT_BUDGET,
} from "../src/context/repo-context.js";

function makeRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "nf-repo-context-"));
  writeFileSync(
    join(root, "README.md"),
    "# Project\n\nIntro line.\n"
  );
  writeFileSync(
    join(root, "CONTRIBUTING.md"),
    Array.from({ length: 12 }, (_, i) => `contributing rule ${String(i)}`).join("\n") + "\n"
  );
  mkdirSync(join(root, "src"));
  writeFileSync(
    join(root, "src", "main.ts"),
    'console.log("hello");\n'
  );
  writeFileSync(join(root, "package-lock.json"), "{}\n");
  mkdirSync(join(root, "node_modules", "junk"), { recursive: true });
  writeFileSync(join(root, "node_modules", "junk", "index.js"), "x\n");
  return root;
}

describe("repo context", () => {
  it("includes full content of a file named in the ticket", async () => {
    const repo = makeRepo();
    const result = await buildRepoContext(
      repo,
      "Note the AGENTS.md quality gates in CONTRIBUTING.md"
    );

    const included = result.included.find((f) => f.path === "CONTRIBUTING.md");
    expect(included).toBeDefined();
    expect(included?.content).toContain("contributing rule 11");

    const paths = result.listing.map((f) => f.path);
    expect(paths).toContain("README.md");
    expect(paths).toContain("src/main.ts");
    expect(paths).not.toContain("package-lock.json");
    expect(paths.some((p) => p.startsWith("node_modules"))).toBe(false);
  });

  it("respects the included-file budget and never truncates content", async () => {
    const repo = makeRepo();
    const result = await buildRepoContext(repo, "project intro", {
      maxFiles: 1,
      maxLines: 4,
    });

    // Only the README (3 content lines + trailing newline = 4) fits;
    // CONTRIBUTING.md must be skipped entirely rather than truncated.
    expect(result.included.length).toBe(1);
    expect(result.included[0]?.path).toBe("README.md");
  });

  it("renders listing and file blocks for the prompt", async () => {
    const repo = makeRepo();
    const result = await buildRepoContext(
      repo,
      "Update CONTRIBUTING.md",
      DEFAULT_REPO_CONTEXT_BUDGET
    );
    const text = renderRepoContext(result);

    expect(text).toContain("### Repository Layout");
    expect(text).toContain("- README.md");
    expect(text).toContain("===== BEGIN FILE: CONTRIBUTING.md =====");
    expect(text).toContain("===== END FILE: CONTRIBUTING.md =====");
  });

  it("returns an empty context for a missing repository", async () => {
    const result = await buildRepoContext("/nonexistent/path/xyz", "anything");
    expect(result.listing).toEqual([]);
    expect(result.included).toEqual([]);
    expect(renderRepoContext(result)).toContain("(empty repository)");
  });
});
