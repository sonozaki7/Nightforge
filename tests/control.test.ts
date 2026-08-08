import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createProjectControl, parseControlCommand, resolveRepoRef, type ControlDeps } from "../src/projects/control.js";
import type { LinearClient } from "../src/integrations/linear.js";

/* eslint-disable @typescript-eslint/unbound-method */

function mockLinearClient(): LinearClient {
  return {
    verifyWebhookSignature: vi.fn(),
    getIssue: vi.fn(),
    getChildIssues: vi.fn(),
    postComment: vi.fn(),
    updateIssueState: vi.fn(),
    listTeams: vi.fn().mockResolvedValue([{ id: "team-existing", name: "existing" }]),
    createTeam: vi.fn().mockResolvedValue({ id: "team-new", name: "my-app" }),
    createWebhook: vi.fn().mockResolvedValue(undefined),
    createIssue: vi.fn().mockResolvedValue(undefined),
    listTeamIssues: vi.fn().mockResolvedValue([]),
    listTeamStates: vi.fn(),
  };
}

describe("parseControlCommand", () => {
  it("parses add commands with a repo URL", () => {
    const cmd = parseControlCommand("project add https://github.com/sonozaki7/my-app");
    expect(cmd.kind).toBe("add");
    if (cmd.kind === "add") {
      expect(cmd.repoUrl).toBe("https://github.com/sonozaki7/my-app");
      expect(cmd.teamName).toBe("my-app");
    }
  });

  it("parses add without the project prefix using a repo URL", () => {
    const cmd = parseControlCommand("add https://github.com/sonozaki7/my-app");
    expect(cmd.kind).toBe("add");
    if (cmd.kind === "add") {
      expect(cmd.repoUrl).toBe("https://github.com/sonozaki7/my-app");
      expect(cmd.teamName).toBe("my-app");
    }
  });

  it("parses remove commands", () => {
    const cmd = parseControlCommand("project remove my-app");
    expect(cmd.kind).toBe("remove");
    if (cmd.kind === "remove") {
      expect(cmd.projectId).toBe("my-app");
    }
  });

  it("parses list commands", () => {
    expect(parseControlCommand("project list").kind).toBe("list");
  });

  it("parses discover commands", () => {
    expect(parseControlCommand("project discover").kind).toBe("discover");
  });

  it("parses status commands", () => {
    const cmd = parseControlCommand("project status my-app");
    expect(cmd.kind).toBe("status");
    if (cmd.kind === "status") {
      expect(cmd.projectId).toBe("my-app");
    }
  });

  it("parses link commands", () => {
    const cmd = parseControlCommand("project link taviaverify:src/lib.ts -> nightforge");
    expect(cmd.kind).toBe("link");
    if (cmd.kind === "link") {
      expect(cmd.sourceProject).toBe("taviaverify");
      expect(cmd.filePath).toBe("src/lib.ts");
      expect(cmd.targetProject).toBe("nightforge");
    }
  });

  it("returns help for unknown input", () => {
    expect(parseControlCommand("some random ticket").kind).toBe("help");
  });

  it("parses a bare pasted URL as an add", () => {
    const cmd = parseControlCommand("https://github.com/sonozaki7/browser-use");
    expect(cmd.kind).toBe("add");
    if (cmd.kind === "add") {
      expect(cmd.repoUrl).toBe("https://github.com/sonozaki7/browser-use");
      expect(cmd.teamName).toBe("browser-use");
    }
  });

  it("parses a bare repo name as an add", () => {
    const cmd = parseControlCommand("browser-use");
    expect(cmd.kind).toBe("add");
    if (cmd.kind === "add") {
      expect(cmd.repoName).toBe("browser-use");
      expect(cmd.teamName).toBe("browser-use");
      expect(cmd.repoUrl).toBeUndefined();
    }
  });

  it("parses an owner/name as an add", () => {
    const cmd = parseControlCommand("sonozaki7/browser-use");
    expect(cmd.kind).toBe("add");
    if (cmd.kind === "add") {
      expect(cmd.repoName).toBe("sonozaki7/browser-use");
      expect(cmd.teamName).toBe("browser-use");
    }
  });

  it("parses add with a bare repo name", () => {
    const cmd = parseControlCommand("add browser-use");
    expect(cmd.kind).toBe("add");
    if (cmd.kind === "add") {
      expect(cmd.repoName).toBe("browser-use");
      expect(cmd.teamName).toBe("browser-use");
    }
  });

  it("parses project add with a bare repo name", () => {
    const cmd = parseControlCommand("project add browser-use");
    expect(cmd.kind).toBe("add");
    if (cmd.kind === "add") {
      expect(cmd.repoName).toBe("browser-use");
      expect(cmd.teamName).toBe("browser-use");
    }
  });

  it("parses project add with owner/name", () => {
    const cmd = parseControlCommand("project add sonozaki7/browser-use");
    expect(cmd.kind).toBe("add");
    if (cmd.kind === "add") {
      expect(cmd.repoName).toBe("sonozaki7/browser-use");
      expect(cmd.teamName).toBe("browser-use");
    }
  });

  it("keeps bare command words as commands, not adds", () => {
    expect(parseControlCommand("list").kind).toBe("list");
    expect(parseControlCommand("discover").kind).toBe("discover");
    expect(parseControlCommand("help").kind).toBe("help");
    expect(parseControlCommand("status").kind).toBe("help");
    expect(parseControlCommand("remove").kind).toBe("help");
    expect(parseControlCommand("some random ticket text").kind).toBe("help");
  });
});

describe("createProjectControl", () => {
  let dir = "";
  let linear: LinearClient;

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "nightforge-ctrl-"));
    linear = mockLinearClient();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  function makeControl(githubToken?: string): ReturnType<typeof createProjectControl> {
    const deps: ControlDeps = {
      linearClient: linear,
      projectsDir: dir,
      publicBaseUrl: "https://getnightforge.com",
      webhookSecret: "secret",
      defaultProjectId: "nightforge",
      githubToken,
    };
    return createProjectControl(deps);
  }

  function makeRepo(name: string): string {
    const repoPath = path.join(dir, name, ".nightforge");
    mkdirSync(repoPath, { recursive: true });
    writeFileSync(
      path.join(repoPath, "project.yaml"),
      `id: ${name}
name: ${name}
path: ${path.join(dir, name)}
linearTeams: []
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
    return path.join(dir, name);
  }

  it("lists registered projects", async () => {
    makeRepo("alpha");
    makeRepo("beta");
    const control = makeControl();
    const reply = await control.run({ kind: "list" });
    expect(reply).toContain("alpha");
    expect(reply).toContain("beta");
  });

  it("reports an empty list when no projects exist", async () => {
    const control = makeControl();
    const reply = await control.run({ kind: "list" });
    expect(reply).toContain("No projects registered");
  });

  it("does not list Nightforge's internal reserved folders", async () => {
    makeRepo("alpha");
    mkdirSync(path.join(dir, "releases"), { recursive: true });
    const control = makeControl();
    const reply = await control.run({ kind: "list" });
    expect(reply).toContain("alpha");
    expect(reply).not.toContain("releases");
  });

  it("discover reports GitHub listing is disabled without a token", async () => {
    const control = makeControl();
    const reply = await control.run({ kind: "discover" });
    expect(reply).toContain("GITHUB_TOKEN");
  });

  it("discover lists GitHub repos and flags registered ones", async () => {
    makeRepo("alpha");
    const fetchMock = vi.fn<() => Promise<Response>>().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve([
          {
            full_name: "owner/alpha",
            html_url: "https://github.com/owner/alpha",
          },
          {
            full_name: "owner/beta",
            html_url: "https://github.com/owner/beta",
          },
        ] as Array<{ full_name: string; html_url: string }>),
    } as Response);
    vi.stubGlobal("fetch", fetchMock);

    try {
      const control = makeControl("my-token");
      const reply = await control.run({ kind: "discover" });
      expect(reply).toContain("owner/alpha ✅");
      expect(reply).toContain("owner/beta");
      expect(reply).not.toContain("owner/beta ✅");
      const [calledUrl, calledInit] = fetchMock.mock.calls[0] as [
        string,
        { headers: { Authorization: string } },
      ];
      expect(calledUrl).toBe("https://api.github.com/user/repos?per_page=100");
      expect(calledInit.headers.Authorization).toBe("Bearer my-token");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("removes a project folder", async () => {
    const repoPath = makeRepo("alpha");
    const control = makeControl();
    const reply = await control.run({ kind: "remove", projectId: "alpha" });
    expect(reply).toContain("removed");
    expect(existsSync(repoPath)).toBe(false);
  });

  it("returns an error when removing a missing project", async () => {
    const control = makeControl();
    const reply = await control.run({ kind: "remove", projectId: "ghost" });
    expect(reply).toContain("No project named **ghost** found");
  });

  it("reports status for an existing project", async () => {
    makeRepo("alpha");
    const control = makeControl();
    const reply = await control.run({ kind: "status", projectId: "alpha" });
    expect(reply).toContain("alpha");
    expect(reply).toContain("direct-prod");
  });

  it("returns help text for the help command", async () => {
    const control = makeControl();
    const reply = await control.run({ kind: "help" });
    expect(reply).toContain("project add");
  });

  it("copies a cross-project file reference with a warning", async () => {
    const src = makeRepo("source");
    const target = makeRepo("target");
    writeFileSync(path.join(src, "lib.ts"), "export const x = 1;\n");

    const control = makeControl();
    const reply = await control.run({
      kind: "link",
      sourceProject: "source",
      filePath: "lib.ts",
      targetProject: "target",
    });

    expect(reply).toContain("Copied");
    const refPath = path.join(target, ".nightforge", "references", "source", "lib.ts");
    expect(refPath).toBeTruthy();
  });

  it("adds a project: clones, provisions team, wires webhook", async () => {
    // Build a tiny local git repo to clone.
    const srcDir = mkdtempSync(path.join(os.tmpdir(), "nightforge-ctrl-src-"));
    execFileSync("git", ["init", "-q"], { cwd: srcDir });
    execFileSync("git", ["config", "user.email", "t@example.com"], { cwd: srcDir });
    execFileSync("git", ["config", "user.name", "T"], { cwd: srcDir });
    execFileSync("touch", ["README.md"], { cwd: srcDir });
    execFileSync("git", ["add", "-A"], { cwd: srcDir });
    execFileSync("git", ["commit", "-qm", "init"], { cwd: srcDir });

    const control = makeControl();
    const reply = await control.run({
      kind: "add",
      repoUrl: `file://${srcDir}`,
      teamName: "my-app",
    });

    expect(reply).toContain("added");
    expect(linear.createTeam).toHaveBeenCalled();
    expect(linear.createWebhook).toHaveBeenCalledWith(
      expect.objectContaining({
        teamId: "team-new",
        url: "https://getnightforge.com/webhooks/linear",
      })
    );

    rmSync(srcDir, { recursive: true, force: true });
  });

  it("adds a project by bare repo name resolved via the GitHub API", async () => {
    const srcDir = mkdtempSync(path.join(os.tmpdir(), "nightforge-ctrl-src-"));
    execFileSync("git", ["init", "-q"], { cwd: srcDir });
    execFileSync("git", ["config", "user.email", "t@example.com"], { cwd: srcDir });
    execFileSync("git", ["config", "user.name", "T"], { cwd: srcDir });
    execFileSync("touch", ["README.md"], { cwd: srcDir });
    execFileSync("git", ["add", "-A"], { cwd: srcDir });
    execFileSync("git", ["commit", "-qm", "init"], { cwd: srcDir });

    const fetchMock = vi.fn<() => Promise<Response>>().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve([
          {
            name: "my-app",
            full_name: "owner/my-app",
            clone_url: `file://${srcDir}`,
          },
        ] as Array<{ name: string; full_name: string; clone_url: string }>),
    } as Response);
    vi.stubGlobal("fetch", fetchMock);

    try {
      const control = makeControl("my-token");
      const reply = await control.run({
        kind: "add",
        repoName: "my-app",
        teamName: "my-app",
      });

      expect(reply).toContain("added");
      const [calledUrl, calledInit] = fetchMock.mock.calls[0] as [
        string,
        { headers: { Authorization: string } },
      ];
      expect(calledUrl).toBe("https://api.github.com/user/repos?per_page=100");
      expect(calledInit.headers.Authorization).toBe("Bearer my-token");
      expect(linear.createTeam).toHaveBeenCalled();
      expect(linear.createWebhook).toHaveBeenCalledWith(
        expect.objectContaining({
          teamId: "team-new",
          url: "https://getnightforge.com/webhooks/linear",
        })
      );
    } finally {
      vi.unstubAllGlobals();
      rmSync(srcDir, { recursive: true, force: true });
    }
  });

  it("reports when a bare repo name does not resolve on GitHub", async () => {
    const fetchMock = vi.fn<() => Promise<Response>>().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve([] as Array<{ name: string; full_name: string; clone_url: string }>),
    } as Response);
    vi.stubGlobal("fetch", fetchMock);

    try {
      const control = makeControl("my-token");
      const reply = await control.run({
        kind: "add",
        repoName: "missing-app",
        teamName: "missing-app",
      });
      expect(reply).toContain("Couldn't find a repo named **missing-app**");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("tells the user to paste a URL when GitHub is not connected", async () => {
    const control = makeControl();
    const reply = await control.run({
      kind: "add",
      repoName: "my-app",
      teamName: "my-app",
    });
    expect(reply).toContain("GitHub isn't connected");
  });
});

describe("resolveRepoRef", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns null for an empty token", async () => {
    expect(await resolveRepoRef("", "browser-use")).toBeNull();
  });

  it("resolves a bare repo name found on the account", async () => {
    const fetchMock = vi.fn<() => Promise<Response>>().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve([
          {
            name: "browser-use",
            full_name: "sonozaki7/browser-use",
            clone_url: "https://github.com/sonozaki7/browser-use.git",
          },
        ]),
    } as Response);
    vi.stubGlobal("fetch", fetchMock);

    const resolved = await resolveRepoRef("tok", "browser-use");
    expect(resolved).toEqual({
      url: "https://github.com/sonozaki7/browser-use.git",
      fullName: "sonozaki7/browser-use",
    });
  });

  it("resolves an owner/name ref via the repo endpoint", async () => {
    const fetchMock = vi.fn<() => Promise<Response>>().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          full_name: "sonozaki7/browser-use",
          clone_url: "https://github.com/sonozaki7/browser-use.git",
        }),
    } as Response);
    vi.stubGlobal("fetch", fetchMock);

    const resolved = await resolveRepoRef("tok", "sonozaki7/browser-use");
    expect(resolved).toEqual({
      url: "https://github.com/sonozaki7/browser-use.git",
      fullName: "sonozaki7/browser-use",
    });
    const [calledUrl] = fetchMock.mock.calls[0] as [string, unknown];
    expect(calledUrl).toBe("https://api.github.com/repos/sonozaki7/browser-use");
  });

  it("returns null when a bare name is not in the account's repos", async () => {
    const fetchMock = vi.fn<() => Promise<Response>>().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve([
          {
            name: "alpha",
            full_name: "owner/alpha",
            clone_url: "https://github.com/owner/alpha.git",
          },
        ]),
    } as Response);
    vi.stubGlobal("fetch", fetchMock);

    expect(await resolveRepoRef("tok", "missing")).toBeNull();
  });

  it("returns null when multiple repos share the same name", async () => {
    const fetchMock = vi.fn<() => Promise<Response>>().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve([
          {
            name: "my-app",
            full_name: "owner-a/my-app",
            clone_url: "https://github.com/owner-a/my-app.git",
          },
          {
            name: "my-app",
            full_name: "owner-b/my-app",
            clone_url: "https://github.com/owner-b/my-app.git",
          },
        ]),
    } as Response);
    vi.stubGlobal("fetch", fetchMock);

    expect(await resolveRepoRef("tok", "my-app")).toBeNull();
  });

  it("returns null when the owner/name endpoint 404s", async () => {
    const fetchMock = vi.fn<() => Promise<Response>>().mockResolvedValue({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ message: "Not Found" }),
    } as Response);
    vi.stubGlobal("fetch", fetchMock);

    expect(await resolveRepoRef("tok", "someone/nope")).toBeNull();
  });
});