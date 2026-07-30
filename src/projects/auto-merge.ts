import { execFile } from "node:child_process";
import { promisify } from "node:util";
import pino from "pino";

const execFileAsync = promisify(execFile);
const logger = pino({ name: "nightforge-auto-merge" });

export interface AutoMergeResult {
  success: boolean;
  commitSha: string | null;
  mergeSha: string | null;
  tag: string | null;
  message: string;
}

export interface AutoMerger {
  /** Commit all changes in the worktree, merge to main, tag. No PR. */
  commitAndMerge(
    worktreePath: string,
    mainRepoPath: string,
    ticketId: string,
    summary: string
  ): Promise<AutoMergeResult>;
  /** Revert a merge commit on main (instant undo) */
  revertMerge(mainRepoPath: string, mergeSha: string): Promise<boolean>;
}

export function createAutoMerger(): AutoMerger {
  return {
    async commitAndMerge(
      worktreePath: string,
      mainRepoPath: string,
      ticketId: string,
      summary: string
    ): Promise<AutoMergeResult> {
      const log = logger.child({ ticketId, worktreePath });
      const branchName = `nightforge/${ticketId}`;
      const tag = `deploy/${ticketId}`;

      try {
        // Stage all changes in the worktree
        await execFileAsync("git", ["add", "-A"], { cwd: worktreePath });

        // Check if there are changes to commit
        const { stdout: statusOut } = await execFileAsync(
          "git",
          ["status", "--porcelain"],
          { cwd: worktreePath }
        );

        if (!statusOut.trim()) {
          log.info("No changes to commit");
          return {
            success: true,
            commitSha: null,
            mergeSha: null,
            tag: null,
            message: "No changes produced",
          };
        }

        // Commit in the worktree branch
        const commitMsg = `feat(${ticketId}): ${summary.slice(0, 72)}`;
        await execFileAsync(
          "git",
          ["commit", "-m", commitMsg, "--no-verify"],
          { cwd: worktreePath }
        );

        const { stdout: commitSha } = await execFileAsync(
          "git",
          ["rev-parse", "HEAD"],
          { cwd: worktreePath }
        );

        log.info({ commitSha: commitSha.trim() }, "Changes committed");

        // Merge into main from the main repo
        // First fetch the worktree branch
        await execFileAsync(
          "git",
          ["fetch", worktreePath, `HEAD:${branchName}`],
          { cwd: mainRepoPath }
        );

        // Checkout main and merge
        await execFileAsync("git", ["checkout", "main"], {
          cwd: mainRepoPath,
        });

        await execFileAsync(
          "git",
          ["merge", branchName, "--no-edit", "-m", `merge: ${ticketId} — ${summary.slice(0, 50)}`],
          { cwd: mainRepoPath }
        );

        const { stdout: mergeSha } = await execFileAsync(
          "git",
          ["rev-parse", "HEAD"],
          { cwd: mainRepoPath }
        );

        // Tag the deployment
        await execFileAsync(
          "git",
          ["tag", "-f", tag, "-m", `Auto-deployed: ${summary.slice(0, 50)}`],
          { cwd: mainRepoPath }
        );

        // Cleanup the temporary branch
        await execFileAsync("git", ["branch", "-D", branchName], {
          cwd: mainRepoPath,
        });

        log.info(
          { mergeSha: mergeSha.trim(), tag },
          "Auto-merged to main and tagged"
        );

        return {
          success: true,
          commitSha: commitSha.trim(),
          mergeSha: mergeSha.trim(),
          tag,
          message: `Merged to main, tagged ${tag}`,
        };
      } catch (err) {
        const error = err as Error;
        log.error({ err: error.message }, "Auto-merge failed");

        // Attempt to abort any in-progress merge
        try {
          await execFileAsync("git", ["merge", "--abort"], {
            cwd: mainRepoPath,
          });
        } catch {
          // No merge in progress, ignore
        }

        return {
          success: false,
          commitSha: null,
          mergeSha: null,
          tag: null,
          message: `Auto-merge failed: ${error.message}`,
        };
      }
    },

    async revertMerge(mainRepoPath: string, mergeSha: string): Promise<boolean> {
      const log = logger.child({ mergeSha });

      try {
        await execFileAsync("git", ["checkout", "main"], {
          cwd: mainRepoPath,
        });

        // Revert the merge commit (-m 1 = revert to first parent)
        await execFileAsync(
          "git",
          ["revert", "-m", "1", "--no-edit", mergeSha],
          { cwd: mainRepoPath }
        );

        log.info("Merge reverted successfully");
        return true;
      } catch (err) {
        const error = err as Error;
        log.error({ err: error.message }, "Revert failed");

        // Abort failed revert
        try {
          await execFileAsync("git", ["revert", "--abort"], {
            cwd: mainRepoPath,
          });
        } catch {
          // ignore
        }

        return false;
      }
    },
  };
}
