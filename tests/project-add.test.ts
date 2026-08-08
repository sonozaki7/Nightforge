import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  parseRepoUrl,
  slugify,
  detectProjectType,
  renderProjectYaml,
  addProject,
} from "../src/cli/project-add.js";
import { parseProjectConfig } from "../src/projects/registry.js";
import { parse } from "yaml";

describe("parseRepoUrl", () => {
  it("parses GitHub https URLs", () => {
    expect(parseRepoUrl("https://github.com/sonozaki7/Nightforge.git")).toEqual({
      host: "github.com",
      owner: "sonozaki7",
      name: "Nightforge",
    });
  });

  it("parses GitHub ssh URLs", () => {
    expect(parseRepoUrl("git@github.com:sonozaki7/Nightforge.git")).toEqual({
      host: "github.com",
      owner: "sonozaki7",
      name: "Nightforge",
    });
  });

  it("parses GitLab URLs", () => {
    expect(parseRepoUrl("https://gitlab.com/group/project.git")).toEqual({
      host: "gitlab.com",
      owner: "group",
      name: "project",
    });
  });

  it("returns null for malformed URLs", () => {
    expect(parseRepoUrl("not a url")).toBeNull();
  });
});

describe("slugify", () => {
  it("lowercases and kebab-cases", () => {
    expect(slugify("My Awesome Repo")).toBe("my-awesome-repo");
  });

  it("trims leading/trailing dashes", () => {
    expect(slugify("!Repo!!")).toBe("repo");
  });
});

describe("detectProjectType", () => {
  let dir = "";

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "nightforge-type-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("detects a node project by package.json", () => {
    execFileSync("touch", ["package.json"], { cwd: dir });
    expect(detectProjectType(dir)).toBe("node");
  });

  it("falls back to other", () => {
    expect(detectProjectType(dir)).toBe("other");
  });
});

describe("renderProjectYaml", () => {
  it("generates a valid project config", () => {
    const yaml = renderProjectYaml("my-app", "my-app", "/tmp/my-app", "node");
    const parsed: unknown = parse(yaml);
    const config = parseProjectConfig(parsed);
    expect(config.id).toBe("my-app");
    expect(config.linearTeams).toEqual([]);
    expect(config.deployment.testCommand).toBe("npm test");
  });
});

describe("addProject", () => {
  let dir = "";

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "nightforge-add-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("rejects malformed URLs", async () => {
    const result = await addProject(dir, "not-a-url");
    expect(result.success).toBe(false);
  });

  it("rejects when the project dir already exists", async () => {
    const repoPath = path.join(dir, "existing");
    execFileSync("mkdir", ["-p", repoPath], { cwd: dir });
    const result = await addProject(dir, "https://github.com/owner/existing.git");
    expect(result.success).toBe(false);
    expect(result.message).toContain("already exists");
  });

  it("clones a repo and writes a valid project.yaml", async () => {
    // Build a tiny local git repo to clone.
    const srcDir = mkdtempSync(path.join(os.tmpdir(), "nightforge-src-"));
    execFileSync("git", ["init", "-q"], { cwd: srcDir });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: srcDir });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: srcDir });
    execFileSync("touch", ["README.md"], { cwd: srcDir });
    execFileSync("git", ["add", "-A"], { cwd: srcDir });
    execFileSync("git", ["commit", "-qm", "init"], { cwd: srcDir });

    const result = await addProject(dir, `file://${srcDir}`);
    expect(result.success).toBe(true);
    expect(result.projectId).toBeTruthy();

    const yamlPath = path.join(result.repoPath, ".nightforge", "project.yaml");
    const content = readFileSync(yamlPath, "utf8");
    const parsedConfig = parseProjectConfig(parse(content));
    expect(parsedConfig.id).toBe(result.projectId);

    rmSync(srcDir, { recursive: true, force: true });
  });
});