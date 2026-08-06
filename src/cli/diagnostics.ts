import { accessSync, constants, existsSync } from "node:fs";
import { loadConfig } from "../config.js";

/**
 * Diagnostics command (Roadmap Phase 7). Verifies that a Nightforge
 * installation is healthy enough to run: configuration validity, required
 * secrets, provider availability, and working directories. Pure checks are
 * exported for tests; the CLI runner prints a report and sets the exit
 * code. Secrets are only reported as present/missing, never printed.
 */

export type CheckStatus = "ok" | "warn" | "fail";

export interface DiagnosticCheck {
  name: string;
  status: CheckStatus;
  message: string;
}

export interface DiagnosticsProbe {
  env: Record<string, string | undefined>;
  pathExists: (path: string) => boolean;
  pathWritable: (path: string) => boolean;
  /** Injectable so tests can stub config loading. */
  loadConfig: (env: Record<string, string | undefined>) => {
    redis: { url: string };
    paths: { projectsDir: string; worktreesDir: string };
    server: { port: number };
  };
}

function isSet(value: string | undefined): boolean {
  return value !== undefined && value.trim() !== "";
}

export function runDiagnostics(probe: DiagnosticsProbe): DiagnosticCheck[] {
  const checks: DiagnosticCheck[] = [];

  let config: ReturnType<DiagnosticsProbe["loadConfig"]> | null = null;
  try {
    config = probe.loadConfig(probe.env);
    checks.push({
      name: "config",
      status: "ok",
      message: `Valid configuration (server port ${String(config.server.port)})`,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    checks.push({ name: "config", status: "fail", message });
  }

  if (isSet(probe.env.LINEAR_API_KEY) && isSet(probe.env.LINEAR_WEBHOOK_SECRET)) {
    checks.push({
      name: "linear",
      status: "ok",
      message: "API key and webhook secret are set",
    });
  } else {
    checks.push({
      name: "linear",
      status: "fail",
      message: "LINEAR_API_KEY and LINEAR_WEBHOOK_SECRET are both required",
    });
  }

  const providerNames = ["DASHSCOPE_API_KEY", "ANTHROPIC_API_KEY", "OPENROUTER_API_KEY"];
  const configured = providerNames.filter((key) => isSet(probe.env[key]));
  if (configured.length > 0) {
    checks.push({
      name: "providers",
      status: "ok",
      message: `${String(configured.length)} model provider key(s) configured`,
    });
  } else {
    checks.push({
      name: "providers",
      status: "warn",
      message: "No provider keys configured — tickets fall back to the mock provider",
    });
  }

  const artifactsDir = ".nightforge/artifacts";
  if (probe.pathExists(artifactsDir)) {
    if (probe.pathWritable(artifactsDir)) {
      checks.push({ name: "artifacts", status: "ok", message: `${artifactsDir} is writable` });
    } else {
      checks.push({ name: "artifacts", status: "fail", message: `${artifactsDir} is not writable` });
    }
  } else {
    checks.push({
      name: "artifacts",
      status: "warn",
      message: `${artifactsDir} missing — created on first artifact save`,
    });
  }

  if (config !== null) {
    for (const [name, path] of [
      ["projects-dir", config.paths.projectsDir],
      ["worktrees-dir", config.paths.worktreesDir],
    ]) {
      if (probe.pathExists(path)) {
        checks.push({ name, status: "ok", message: path });
      } else {
        checks.push({ name, status: "warn", message: `${path} missing — create it before first run` });
      }
    }
    checks.push({ name: "redis", status: "ok", message: `Redis URL configured (${config.redis.url})` });
  }

  return checks;
}

export function formatChecks(checks: DiagnosticCheck[]): string[] {
  const icon: Record<CheckStatus, string> = { ok: "[ok]  ", warn: "[warn]", fail: "[fail]" };
  return checks.map((check) => `${icon[check.status]} ${check.name}: ${check.message}`);
}

export function createDefaultProbe(): DiagnosticsProbe {
  return {
    env: process.env,
    pathExists: (path: string): boolean => existsSync(path),
    pathWritable: (path: string): boolean => {
      try {
        accessSync(path, constants.W_OK);
        return true;
      } catch {
        return false;
      }
    },
    loadConfig: (env): ReturnType<DiagnosticsProbe["loadConfig"]> => loadConfig(env),
  };
}

export function runDiagnosticsCli(): void {
  if (existsSync(".env")) process.loadEnvFile(".env");
  const checks = runDiagnostics(createDefaultProbe());
  for (const line of formatChecks(checks)) {
    console.log(line);
  }
  const failures = checks.filter((check) => check.status === "fail").length;
  console.log(
    failures > 0
      ? `Diagnostics finished with ${String(failures)} failure(s).`
      : "Diagnostics finished — no failures."
  );
  process.exitCode = failures > 0 ? 1 : 0;
}

const invokedDirectly = process.argv[1].endsWith("diagnostics.ts");
if (invokedDirectly) {
  runDiagnosticsCli();
}
