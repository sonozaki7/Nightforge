import pino from "pino";
import type { Tool, ToolResult } from "../types.js";
import type { Sandbox } from "../../sandbox/types.js";

const logger = pino({ name: "nightforge-tool-bash" });

export interface BashToolConfig {
  /** OS-level sandbox the command runs inside. */
  sandbox: Sandbox;
  /** Writable worktree the command may touch. */
  worktreePath: string;
  /** Host paths available read-only (origin node_modules etc). */
  readOnlyPaths?: string[];
  /** Default timeout in ms. */
  timeoutMs?: number;
}

/**
 * Sandboxed shell tool for the agentic worker. Every command runs inside the
 * OS-level sandbox (Docker or Seatbelt) so a risky command cannot touch the
 * host, other projects, or production systems.
 */
export function createBashTool(config: BashToolConfig): Tool {
  return {
    definition: {
      name: "bash",
      description:
        "Run a shell command inside an OS-level sandbox. Use for running tests, build tools, git, and other CLI work. " +
        "The command is confined to the worktree and cannot access the host or network.",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "The shell command to run",
          },
        },
        required: ["command"],
      },
      permission: "auto",
      service: "bash",
    },

    async execute(args: Record<string, unknown>): Promise<ToolResult> {
      const start = Date.now();
      const command = (args["command"] as string | undefined) ?? "";

      if (command.trim().length === 0) {
        return {
          success: false,
          data: null,
          error: "bash requires a non-empty 'command' string",
          durationMs: Date.now() - start,
        };
      }

      try {
        const result = await config.sandbox.exec({
          worktreePath: config.worktreePath,
          readOnlyPaths: config.readOnlyPaths ?? [],
          cwd: ".",
          command: "sh",
          args: ["-c", command],
        });

        const output = [result.stdout, result.stderr].filter(Boolean).join("\n");

        if (result.timedOut) {
          logger.warn({ command }, "Sandboxed command timed out");
          return {
            success: false,
            data: null,
            error: `Command timed out:\n${output.slice(0, 4000)}`,
            durationMs: Date.now() - start,
          };
        }

        return {
          success: result.exitCode === 0,
          data: { exitCode: result.exitCode, output },
          error:
            result.exitCode === 0
              ? undefined
              : `Exit code ${String(result.exitCode)}:\n${output.slice(0, 4000)}`,
          durationMs: Date.now() - start,
        };
      } catch (err) {
        const error = err as Error;
        logger.error({ command, err: error.message }, "Sandboxed command failed");
        return {
          success: false,
          data: null,
          error: `Sandbox execution failed: ${error.message}`,
          durationMs: Date.now() - start,
        };
      }
    },
  };
}