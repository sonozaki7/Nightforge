import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { rm } from "node:fs/promises";
import path from "node:path";
import pino from "pino";

const execFileAsync = promisify(execFile);
const logger = pino({ name: "nightforge-sandbox" });

export interface Sandbox {
  worktreePath: string;
  /** Branch name created for this sandbox */
  branchName: string;
  cleanup(): Promise<void>;
}

export interface SandboxManager {
  create(
    projectPath: string,
    projectId: string,
    ticketId: string
  ): Promise<Sandbox>;
  /** Create an isolated worktree for a sub-agent with its own branch */
  createSubAgent(
    projectPath: string,
    projectId: string,
    ticketId: string,
    subAgentIndex: number
  ): Promise<Sandbox>;
}

export function createSandboxManager(worktreesDir: string): SandboxManager {
  async function createWorktree(
    projectPath: string,
    worktreeName: string,
    branchName: string
  ): Promise<Sandbox> {
    const worktreePath = path.join(worktreesDir, worktreeName);

    logger.info(
      { projectPath, worktreePath, branchName },
      "Creating git worktree"
    );

    // Create worktree with a dedicated branch for isolation
    await execFileAsync("git", [
      "worktree",
      "add",
      "-f",
      "-b",
      branchName,
      worktreePath,
      "HEAD",
    ], {
      cwd: projectPath,
    });

    logger.info({ worktreePath, branchName }, "Worktree created");

    return {
      worktreePath,
      branchName,
      async cleanup(): Promise<void> {
        logger.info({ worktreePath, branchName }, "Cleaning up worktree");

        try {
          await execFileAsync("git", ["worktree", "remove", "-f", worktreePath], {
            cwd: projectPath,
          });
        } catch {
          logger.warn(
            { worktreePath },
            "Git worktree remove failed, attempting manual cleanup"
          );
          await rm(worktreePath, { recursive: true, force: true });
          await execFileAsync("git", ["worktree", "prune"], {
            cwd: projectPath,
          });
        }

        // Delete the temporary branch
        try {
          await execFileAsync("git", ["branch", "-D", branchName], {
            cwd: projectPath,
          });
        } catch {
          // Branch may already be deleted if merged
        }

        logger.info({ worktreePath }, "Worktree cleaned up");
      },
    };
  }

  return {
    async create(
      projectPath: string,
      projectId: string,
      ticketId: string
    ): Promise<Sandbox> {
      const worktreeName = `${projectId}-${ticketId}`;
      const branchName = `nightforge/${ticketId}`;
      return createWorktree(projectPath, worktreeName, branchName);
    },

    async createSubAgent(
      projectPath: string,
      projectId: string,
      ticketId: string,
      subAgentIndex: number
    ): Promise<Sandbox> {
      const worktreeName = `${projectId}-${ticketId}-sub${String(subAgentIndex)}`;
      const branchName = `nightforge/${ticketId}/sub-${String(subAgentIndex)}`;
      return createWorktree(projectPath, worktreeName, branchName);
    },
  };
}
