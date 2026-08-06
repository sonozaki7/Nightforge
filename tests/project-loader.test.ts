import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { loadProjectConfig, repoPathFor } from "../src/projects/project-loader.js";

describe("project loader", () => {
  let projectsDir: string;

  beforeEach(() => {
    projectsDir = mkdtempSync(path.join(os.tmpdir(), "nf-projects-"));
  });

  afterEach(() => {
    rmSync(projectsDir, { recursive: true, force: true });
  });

  it("falls back to defaults when no project.yaml exists", () => {
    const config = loadProjectConfig(projectsDir, "ghost-project");

    expect(config.id).toBe("ghost-project");
    expect(config.path).toBe(path.join(projectsDir, "ghost-project"));
    expect(config.deployment.testCommand).toBe("npm test");
  });

  it("loads a valid project.yaml and overrides the path", () => {
    const repoDir = path.join(projectsDir, "nightforge", ".nightforge");
    mkdirSync(repoDir, { recursive: true });
    writeFileSync(
      path.join(repoDir, "project.yaml"),
      [
        "id: nightforge",
        "name: Nightforge",
        "path: /somewhere/else",
        "deployment:",
        "  policy: direct-prod",
        "  testCommand: npm test",
        "  lintCommand: npm run lint",
        "  typecheckCommand: npx tsc --noEmit",
        "  buildCommand: npm run build",
        "  deployCommand: bash ops/prepare-release.sh",
        "  healthcheckCommand: bash ops/self-verify.sh",
        "  rollbackCommand: node -e process.exit(0)",
      ].join("\n")
    );

    const config = loadProjectConfig(projectsDir, "nightforge");

    expect(config.id).toBe("nightforge");
    // Runtime layout wins over the checked-in path value.
    expect(config.path).toBe(path.join(projectsDir, "nightforge"));
    expect(config.deployment.deployCommand).toBe("bash ops/prepare-release.sh");
  });

  it("falls back to defaults when project.yaml violates the schema", () => {
    const repoDir = path.join(projectsDir, "broken", ".nightforge");
    mkdirSync(repoDir, { recursive: true });
    writeFileSync(path.join(repoDir, "project.yaml"), "id: broken\n");

    const config = loadProjectConfig(projectsDir, "broken");

    expect(config.id).toBe("broken");
    expect(config.deployment.testCommand).toBe("npm test");
  });

  it("derives the repo path from projects dir and project id", () => {
    expect(repoPathFor("/srv/apps", "nightforge")).toBe(
      "/srv/apps/nightforge"
    );
  });
});
