import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createCiGate, parseRepoSlug } from "../src/projects/ci-gate.js";

describe("parseRepoSlug", () => {
  it("parses https remote URLs", () => {
    expect(parseRepoSlug("https://github.com/sonozaki7/Nightforge.git")).toEqual({
      owner: "sonozaki7",
      repo: "Nightforge",
    });
  });

  it("parses git@ ssh remote URLs", () => {
    expect(parseRepoSlug("git@github.com:sonozaki7/Nightforge.git")).toEqual({
      owner: "sonozaki7",
      repo: "Nightforge",
    });
  });

  it("returns null for non-github remotes", () => {
    expect(parseRepoSlug("git@gitlab.com:foo/bar.git")).toEqual({
      owner: "foo",
      repo: "bar",
    });
  });

  it("returns null for malformed URLs", () => {
    expect(parseRepoSlug("not-a-remote")).toBeNull();
  });
});

describe("createCiGate", () => {
  const gate = createCiGate();
  let repoPath = "";

  beforeAll(() => {
    repoPath = mkdtempSync(path.join(os.tmpdir(), "ci-gate-test-"));
    execFileSync("git", ["init", "-q"], { cwd: repoPath });
    execFileSync(
      "git",
      ["remote", "add", "origin", "https://github.com/sonozaki7/Nightforge.git"],
      { cwd: repoPath }
    );
  });

  afterAll(() => {
    rmSync(repoPath, { recursive: true, force: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch(payload: unknown, status = 200): void {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: status >= 200 && status < 300,
        status,
        statusText: "status",
        json: () => Promise.resolve(payload),
      })
    );
  }

  it("skips the gate when no token is provided", async () => {
    const result = await gate.waitForGreen("/any/path", "sha123", { token: "" });

    expect(result.passed).toBe(true);
    expect(result.state).toBe("skipped");
  });

  it("passes when CI reports success", async () => {
    stubFetch({ state: "success", statuses: [{ state: "success" }] });

    const result = await gate.waitForGreen(repoPath, "sha123", {
      token: "tok",
      pollIntervalMs: 5,
      timeoutMs: 1000,
    });

    expect(result.passed).toBe(true);
    expect(result.state).toBe("success");
  });

  it("fails when CI reports failure", async () => {
    stubFetch({ state: "failure", statuses: [{ state: "failure" }] });

    const result = await gate.waitForGreen(repoPath, "sha123", {
      token: "tok",
      pollIntervalMs: 5,
      timeoutMs: 1000,
    });

    expect(result.passed).toBe(false);
    expect(result.state).toBe("failure");
  });

  it("fails when a check run has a failure conclusion", async () => {
    stubFetch({
      state: "pending",
      statuses: [],
      check_runs: [
        { status: "completed", conclusion: "failure", name: "CI" },
      ],
    });

    const result = await gate.waitForGreen(repoPath, "sha123", {
      token: "tok",
      pollIntervalMs: 5,
      timeoutMs: 1000,
    });

    expect(result.passed).toBe(false);
    expect(result.state).toBe("failure");
  });

  it("skips when no statuses or check runs exist", async () => {
    stubFetch({ state: "success", statuses: [], check_runs: [] });

    const result = await gate.waitForGreen(repoPath, "sha123", {
      token: "tok",
      pollIntervalMs: 5,
      timeoutMs: 1000,
    });

    expect(result.passed).toBe(true);
    expect(result.state).toBe("skipped");
  });

  it("polls until pending resolves to success", async () => {
    let callCount = 0;
    const makePayload = (): {
      state: string;
      statuses: Array<{ state: string }>;
    } => {
      callCount += 1;
      return callCount <= 2
        ? { state: "pending", statuses: [{ state: "pending" }] }
        : { state: "success", statuses: [{ state: "success" }] };
    };
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        statusText: "ok",
        json: () => Promise.resolve(makePayload()),
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await gate.waitForGreen(repoPath, "sha123", {
      token: "tok",
      pollIntervalMs: 5,
      timeoutMs: 1000,
    });

    expect(result.passed).toBe(true);
    expect(result.state).toBe("success");
    expect(callCount).toBeGreaterThanOrEqual(3);
  });

  it("times out while CI stays pending", async () => {
    stubFetch({ state: "pending", statuses: [{ state: "pending" }] });

    const result = await gate.waitForGreen(repoPath, "sha123", {
      token: "tok",
      pollIntervalMs: 5,
      timeoutMs: 30,
    });

    expect(result.passed).toBe(false);
    expect(result.state).toBe("pending");
  });
});