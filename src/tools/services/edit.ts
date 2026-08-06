import path from "node:path";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import pino from "pino";
import type { Tool, ToolResult } from "../types.js";

const logger = pino({ name: "nightforge-tool-edit" });

export interface EditToolConfig {
  /** Writable worktree root. All writes are confined inside it. */
  worktreePath: string;
}

const PROHIBITED_ROOTS = new Set(["node_modules", ".git"]);

/**
 * File edit tool for the agentic worker. Writes are confined to the worktree
 * (path-traversal rejected), and secrets/lockfiles are never writable.
 */
export function createEditTool(config: EditToolConfig): Tool {
  return {
    definition: {
      name: "edit",
      description:
        "Create or overwrite a file inside the worktree with the given content. " +
        "Use this to write code, config files, and other project files. " +
        "The path must be relative to the project root and stay inside it.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Relative path of the file to write (e.g. src/index.ts)",
          },
          content: {
            type: "string",
            description: "Full file content to write",
          },
        },
        required: ["path", "content"],
      },
      permission: "auto",
      service: "edit",
    },

    async execute(args: Record<string, unknown>): Promise<ToolResult> {
      const start = Date.now();
      const rawPath = (args["path"] as string | undefined) ?? "";
      const content = (args["content"] as string | undefined) ?? "";

      const reason = rejectReason(config.worktreePath, rawPath);
      if (reason !== null) {
        logger.warn({ path: rawPath, reason }, "Rejected edit");
        return {
          success: false,
          data: null,
          error: `Edit rejected: ${reason}`,
          durationMs: Date.now() - start,
        };
      }

      const target = path.resolve(config.worktreePath, rawPath);
      try {
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, content, "utf8");
        return {
          success: true,
          data: { path: rawPath, bytes: content.length },
          durationMs: Date.now() - start,
        };
      } catch (err) {
        const error = err as Error;
        return {
          success: false,
          data: null,
          error: `Write failed: ${error.message}`,
          durationMs: Date.now() - start,
        };
      }
    },
  };
}

/** Read the current content of a file inside the worktree (for the model). */
export function createReadTool(config: EditToolConfig): Tool {
  return {
    definition: {
      name: "read_file",
      description:
        "Read the current content of a file inside the project. " +
        "Use this to inspect existing code before editing it.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Relative path of the file to read (e.g. src/index.ts)",
          },
        },
        required: ["path"],
      },
      permission: "auto",
      service: "edit",
    },

    async execute(args: Record<string, unknown>): Promise<ToolResult> {
      const start = Date.now();
      const rawPath = (args["path"] as string | undefined) ?? "";

      const reason = rejectReason(config.worktreePath, rawPath);
      if (reason !== null) {
        return {
          success: false,
          data: null,
          error: `Read rejected: ${reason}`,
          durationMs: Date.now() - start,
        };
      }

      const target = path.resolve(config.worktreePath, rawPath);
      try {
        const content = await readFile(target, "utf8");
        return {
          success: true,
          data: { path: rawPath, content, bytes: content.length },
          durationMs: Date.now() - start,
        };
      } catch (err) {
        const error = err as Error;
        return {
          success: false,
          data: null,
          error: `Read failed: ${error.message}`,
          durationMs: Date.now() - start,
        };
      }
    },
  };
}

function rejectReason(worktreePath: string, rawPath: string): string | null {
  if (path.isAbsolute(rawPath)) {
    return "absolute paths are not allowed; use a path relative to the project root";
  }
  const normalized = path.normalize(rawPath);
  if (normalized.startsWith("..") || normalized === "..") {
    return "path escapes the worktree";
  }
  const resolved = path.resolve(worktreePath, normalized);
  if (!resolved.startsWith(path.resolve(worktreePath) + path.sep)) {
    return "path escapes the worktree";
  }
  const first = normalized.split(path.sep)[0] ?? "";
  if (PROHIBITED_ROOTS.has(first)) {
    return `writes into ${first} are not allowed`;
  }
  if (path.basename(normalized) === ".env" || path.basename(normalized).startsWith(".env.")) {
    return ".env files are not writable";
  }
  return null;
}