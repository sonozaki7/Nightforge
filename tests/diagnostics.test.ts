import { describe, expect, it } from "vitest";
import {
  formatChecks,
  runDiagnostics,
  type DiagnosticsProbe,
} from "../src/cli/diagnostics.js";

const fakeConfig = {
  redis: { url: "redis://localhost:6379" },
  paths: { projectsDir: "/srv/apps", worktreesDir: "/srv/nightforge/worktrees" },
  server: { port: 3000 },
};

function probe(
  env: Record<string, string | undefined>,
  options: {
    existing?: string[];
    unwritable?: string[];
    loadConfig?: DiagnosticsProbe["loadConfig"];
  } = {}
): DiagnosticsProbe {
  const existing = new Set(options.existing ?? ["/srv/apps", "/srv/nightforge/worktrees", ".nightforge/artifacts"]);
  const unwritable = new Set(options.unwritable ?? []);
  return {
    env,
    pathExists: (path: string): boolean => existing.has(path),
    pathWritable: (path: string): boolean => !unwritable.has(path),
    loadConfig: options.loadConfig ?? ((): typeof fakeConfig => fakeConfig),
  };
}

const fullEnv = {
  LINEAR_API_KEY: "lin-key",
  LINEAR_WEBHOOK_SECRET: "secret",
  DASHSCOPE_API_KEY: "ds-key",
};

function statusByName(checks: ReturnType<typeof runDiagnostics>): Record<string, string> {
  return Object.fromEntries(checks.map((check) => [check.name, check.status]));
}

describe("runDiagnostics", () => {
  it("should report a fully healthy installation", () => {
    const statuses = statusByName(runDiagnostics(probe(fullEnv)));
    expect(statuses).toEqual({
      config: "ok",
      linear: "ok",
      providers: "ok",
      artifacts: "ok",
      "projects-dir": "ok",
      "worktrees-dir": "ok",
      redis: "ok",
    });
  });

  it("should fail when Linear credentials are missing", () => {
    const checks = runDiagnostics(probe({ DASHSCOPE_API_KEY: "ds-key" }));
    const statuses = statusByName(checks);
    expect(statuses.linear).toBe("fail");
    expect(checks.some((c) => c.status === "fail")).toBe(true);
  });

  it("should warn instead of fail when no provider keys exist", () => {
    const statuses = statusByName(
      runDiagnostics(probe({ LINEAR_API_KEY: "k", LINEAR_WEBHOOK_SECRET: "s" }))
    );
    expect(statuses.providers).toBe("warn");
  });

  it("should fail when the config cannot be parsed", () => {
    const failing = probe(fullEnv, {
      loadConfig: (): never => {
        throw new Error("Configuration validation failed");
      },
    });
    const checks = runDiagnostics(failing);
    const statuses = statusByName(checks);
    expect(statuses.config).toBe("fail");
    // directory and redis checks depend on a parsed config
    expect(statuses["projects-dir"]).toBeUndefined();
    expect(statuses.redis).toBeUndefined();
  });

  it("should fail on an unwritable artifacts directory", () => {
    const statuses = statusByName(
      runDiagnostics(probe(fullEnv, { unwritable: [".nightforge/artifacts"] }))
    );
    expect(statuses.artifacts).toBe("fail");
  });

  it("should warn about missing working directories", () => {
    const statuses = statusByName(
      runDiagnostics(probe(fullEnv, { existing: [".nightforge/artifacts"] }))
    );
    expect(statuses["projects-dir"]).toBe("warn");
    expect(statuses["worktrees-dir"]).toBe("warn");
  });
});

describe("formatChecks", () => {
  it("should render one prefixed line per check", () => {
    const lines = formatChecks([
      { name: "config", status: "ok", message: "fine" },
      { name: "linear", status: "fail", message: "missing" },
    ]);
    expect(lines[0]).toBe("[ok]   config: fine");
    expect(lines[1]).toBe("[fail] linear: missing");
  });
});
