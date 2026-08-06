import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import pino from "pino";
import type {
  Sandbox,
  SandboxConfig,
  SandboxExecOptions,
  SandboxExecResult,
} from "./types.js";

const logger = pino({ name: "nightforge-sandbox-docker" });

/**
 * Docker-backed sandbox: runs the agent command inside a throwaway container
 * with a read-only root filesystem, no network, no privilege escalation,
 * resource limits, and only the worktree mounted writable.
 *
 * The container image must provide the runtime the project needs (node, npm,
 * python, ...). `node:22-alpine` is the default; set `dockerImage` per stack.
 */
export function createDockerSandbox(config: SandboxConfig): Sandbox {
  const image = config.dockerImage;

  async function exec(
    options: SandboxExecOptions
  ): Promise<SandboxExecResult> {
    const containerName = `nightforge-sandbox-${randomUUID().slice(0, 8)}`;

    const dockerArgs = [
      "run",
      "--rm",
      "--name",
      containerName,
      // Resource limits
      `--memory=${String(config.memoryMb)}m`,
      `--cpus=${String(config.cpus)}`,
      "--pids-limit=256",
      // No network by default
      ...(config.networkEnabled ? [] : ["--network", "none"]),
      // Read-only root filesystem; only tmp + worktree writable
      "--read-only",
      "--tmpfs",
      "/tmp:rw,noexec,nosuid,size=128m",
      // No privilege escalation
      "--cap-drop=ALL",
      "--security-opt=no-new-privileges",
      // Do not run as root inside the container
      "--user=10000:10000",
      // Runtime
      "--workdir",
      "/work",
      // Writable worktree
      "-v",
      `${options.worktreePath}:/work`,
      // Read-only host paths (origin node_modules resolves via symlinks)
      ...options.readOnlyPaths.flatMap((p) => ["-v", `${p}:${p}:ro`]),
      image,
    ];

    const innerCommand = `cd /work${options.cwd !== "." ? `/${options.cwd}` : ""} && exec ${options.command} ${options.args.join(" ")}`;
    dockerArgs.push("sh", "-c", innerCommand);

    return runProcess("docker", dockerArgs, config.timeoutMs, () => {
      void cleanupContainer(containerName);
    });
  }

  return { exec, close: async (): Promise<void> => {} };
}

function runProcess(
  command: string,
  args: string[],
  timeoutMs: number,
  onTimeout: () => void
): Promise<SandboxExecResult> {
  return new Promise<SandboxExecResult>((resolve) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      onTimeout();
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (err: Error) => {
      clearTimeout(timer);
      logger.error({ err: err.message }, "Sandbox process failed to start");
      resolve({ stdout, stderr, exitCode: null, timedOut });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code, timedOut });
    });
  });
}

async function cleanupContainer(name: string): Promise<void> {
  try {
    await runProcess("docker", ["rm", "-f", name], 10_000, () => {});
  } catch {
    // Best effort; the container is already being torn down.
  }
}