import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createTeamRouter } from "../src/projects/team-router.js";

describe("createTeamRouter", () => {
  let dir = "";

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "nightforge-router-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function addProject(projectId: string, linearTeams: string[]): void {
    const yamlDir = path.join(dir, projectId, ".nightforge");
    mkdirSync(yamlDir, { recursive: true });
    writeFileSync(
      path.join(yamlDir, "project.yaml"),
      `id: ${projectId}
name: ${projectId}
path: ${path.join(dir, projectId)}
linearTeams: [${linearTeams.map((t) => `"${t}"`).join(", ")}]
deployment:
  policy: direct-prod
  testCommand: echo
  lintCommand: echo
  typecheckCommand: echo
  buildCommand: echo
  deployCommand: echo
  healthcheckCommand: echo
  rollbackCommand: echo
`
    );
  }

  it("resolves a project by Linear team id", () => {
    addProject("project-a", ["TEAM-ABC"]);
    const router = createTeamRouter(dir);
    expect(router.resolveProjectForTeam("TEAM-ABC")).toBe("project-a");
  });

  it("matches team names case-insensitively", () => {
    addProject("project-a", ["Design"]);
    const router = createTeamRouter(dir);
    expect(router.resolveProjectForTeam("design")).toBe("project-a");
  });

  it("returns null for unmapped teams", () => {
    addProject("project-a", ["TEAM-ABC"]);
    const router = createTeamRouter(dir);
    expect(router.resolveProjectForTeam("OTHER")).toBeNull();
  });

  it("routes multiple teams across projects", () => {
    addProject("frontend", ["FE"]);
    addProject("backend", ["BE"]);
    const router = createTeamRouter(dir);
    expect(router.resolveProjectForTeam("FE")).toBe("frontend");
    expect(router.resolveProjectForTeam("BE")).toBe("backend");
  });

  it("lists all project dirs", () => {
    addProject("frontend", []);
    addProject("backend", []);
    const router = createTeamRouter(dir);
    expect(router.listProjects().sort()).toEqual(["backend", "frontend"]);
  });

  it("handles an empty projects dir", () => {
    const router = createTeamRouter(dir);
    expect(router.listProjects()).toEqual([]);
    expect(router.resolveProjectForTeam("anything")).toBeNull();
  });
});