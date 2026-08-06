import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { writeFile, rm, realpath } from "node:fs/promises";
import path from "node:path";
import pino from "pino";
import type {
  Sandbox,
  SandboxConfig,
  SandboxExecOptions,
  SandboxExecResult,
} from "./types.js";

const logger = pino({ name: "nightforge-sandbox-seatbelt" });

/**
 * Resolve symlinks (e.g. /tmp -> /private/tmp on macOS) so profile subpaths
 * match the canonical paths the kernel enforces.
 */
async function canonicalPath(p: string): Promise<string> {
  try {
    return await realpath(p);
  } catch {
    return p;
  }
}

/**
 * Build a macOS Seatbelt (sandbox-exec) profile that:
 *  - denies writes outside the worktree and system temp dirs
 *  - denies outbound network unless enabled
 *  - allows reads only of system paths + worktree + read-only host paths
 *
 * Seatbelt clauses must be attached to the SAME `(allow ...)` / `(deny ...)`
 * statement — a bare `(allow file-write*)` permits all writes.
 */
export function buildSeatbeltProfile(
  options: SandboxExecOptions,
  config: SandboxConfig
): string {
  const systemReadPaths = [
    "/bin",
    "/usr",
    "/sbin",
    "/System",
    "/Library",
    "/private",
    "/var",
    "/dev",
  ];

  const readSubpaths = [
    options.worktreePath,
    ...options.readOnlyPaths,
    ...systemReadPaths,
  ];
  const readClauses = readSubpaths
    .map((p) => `(subpath "${escapePath(p)}")`)
    .join(" ");

  const writeSubpaths = [options.worktreePath, tmpdir()];
  const writeClauses = writeSubpaths
    .map((p) => `(subpath "${escapePath(p)}")`)
    .join(" ");

  const networkRule = config.networkEnabled
    ? "(allow network* (remote tcp) (remote udp))"
    : "(deny network*)";

  return `(version 1)
(import "system.sb")
(deny default)
(allow process*)
(allow sysctl-read)
(allow mach-lookup)
(allow ipc-posix*)
${networkRule}
(allow file-read* ${readClauses})
(allow file-read-metadata)
(allow file-write* ${writeClauses})
(allow signal)
(allow process-fork)
(allow process-exec)
`;
}

function escapePath(p: string): string {
  return p.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function createSeatbeltSandbox(config: SandboxConfig): Sandbox {
  async function exec(
    options: SandboxExecOptions
  ): Promise<SandboxExecResult> {
    const canonicalWorktree = await canonicalPath(options.worktreePath);
    const canonicalReadOnly = await Promise.all(
      options.readOnlyPaths.map((p) => canonicalPath(p))
    );
    const canonicalOptions: SandboxExecOptions = {
      ...options,
      worktreePath: canonicalWorktree,
      readOnlyPaths: canonicalReadOnly,
    };

    const profile = buildSeatbeltProfile(canonicalOptions, config);
    const profileFile = path.join(
      tmpdir(),
      `nightforge-sandbox-${Date.now().toString(36)}.sb`
    );
    await writeFile(profileFile, profile, "utf8");

    const cwd = path.join(canonicalWorktree, options.cwd);

    const child = spawn(
      "sandbox-exec",
      ["-f", profileFile, options.command, ...options.args],
      { cwd, stdio: ["ignore", "pipe", "pipe"] }
    );

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
        logger.error({ err: err.message }, "Seatbelt launch failed");
        void rm(profileFile, { force: true }).catch(() => {});
        resolve({ stdout, stderr, exitCode: null, timedOut });
      });

      child.on("close", (code) => {
        clearTimeout(timer);
        void rm(profileFile, { force: true }).catch(() => {});
        resolve({ stdout, stderr, exitCode: code, timedOut });
      });
    });
  }

  return { exec, close: async (): Promise<void> => {} };
}