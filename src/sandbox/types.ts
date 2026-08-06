/**
 * OS-level sandbox for agent command execution.
 *
 * Nightforge runs project validation commands (lint, typecheck, test, build)
 * that are generated code — a malicious or buggy test script must never be
 * able to touch the host machine, other projects, or production systems.
 *
 * Two real isolation backends are provided:
 *   - Docker: namespaces, read-only rootfs, no-new-privileges, resource caps
 *   - Seatbelt (macOS): sandbox-exec kernel profile restricting writes/network
 *
 * `unsafe` mode is an explicit opt-out for development only.
 */

export type SandboxMode = "auto" | "docker" | "seatbelt" | "unsafe";

export interface SandboxConfig {
  mode: SandboxMode;
  /** Docker image used for the docker backend (default: node:22-alpine). */
  dockerImage: string;
  /** Memory limit in MB. */
  memoryMb: number;
  /** CPU limit (cores). */
  cpus: number;
  /** Allow outbound network inside the sandbox (default: false). */
  networkEnabled: boolean;
  /** Per-command timeout in ms. */
  timeoutMs: number;
}

export interface SandboxExecOptions {
  /** Absolute path to the writable worktree mounted into the sandbox. */
  worktreePath: string;
  /**
   * Host paths made available read-only inside the sandbox so symlinked
   * dependencies (origin node_modules) resolve. Mounted at their host path.
   */
  readOnlyPaths: string[];
  /** Working directory inside the sandbox, relative to the worktree root. */
  cwd: string;
  /** Command to run (e.g. "npm"). */
  command: string;
  /** Arguments to the command. */
  args: string[];
}

export interface SandboxExecResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
}

export interface Sandbox {
  /**
   * Run a command inside the OS-level sandbox. Never silently downgrades:
   * if the configured backend fails, the error is returned, not bypassed.
   */
  exec(options: SandboxExecOptions): Promise<SandboxExecResult>;
  close(): Promise<void>;
}