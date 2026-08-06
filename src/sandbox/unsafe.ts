import { spawn } from "node:child_process";
import path from "node:path";
import pino from "pino";
import type {
  Sandbox,
  SandboxConfig,
  SandboxExecOptions,
  SandboxExecResult,
} from "./types.js";

const logger = pino({ name: "nightforge-sandbox-unsafe" });

/**
 * Deliberately unsandboxed execution. This is an EXPLICIT opt-out for local
 * development only — it provides zero isolation. Enabled solely via
 * SANDBOX_MODE=unsafe; never the default.
 */
export function createUnsafeSandbox(config: SandboxConfig): Sandbox {
  logger.warn(
    "Unsafe sandbox mode enabled — agent commands run with FULL host access. " +
      "Use only for local development. Never enable on a production VPS."
  );

  async function exec(
    options: SandboxExecOptions
  ): Promise<SandboxExecResult> {
    const cwd = path.join(options.worktreePath, options.cwd);

    const child = spawn(options.command, options.args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });

    return new Promise<SandboxExecResult>((resolve) => {
      let stdout = "";
      let stderr = "";
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, config.timeoutMs);

      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      child.on("error", (err: Error) => {
        clearTimeout(timer);
        logger.error({ err: err.message }, "Command launch failed");
        resolve({ stdout, stderr, exitCode: null, timedOut });
      });

      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ stdout, stderr, exitCode: code, timedOut });
      });
    });
  }

  return { exec, close: async (): Promise<void> => {} };
}