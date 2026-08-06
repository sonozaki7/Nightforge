import pino from "pino";
import path from "node:path";
import { lstatSync, realpathSync, type Stats } from "node:fs";
import { symlink } from "node:fs/promises";
import type { TicketJob } from "../queue/scheduler.js";
import type { ProjectConfig } from "../projects/registry.js";
import type { SandboxManager, Sandbox } from "./sandbox.js";
import { executeWorker, type ModelProvider, type WorkerResult } from "./worker.js";
import { resolveTicketMode } from "../tools/types.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { AgenticModelProvider, AgenticWorkerResult } from "./agentic-worker.js";
import { executeAgenticWorker } from "./agentic-worker.js";
import type { ApprovalHandler } from "../tools/types.js";
import { executeAcpWorker, shouldUseAcp, type AcpWorkerConfig } from "../acp/worker.js";
import type { AcpWorkerResult } from "../acp/types.js";
import type { Sandbox as OssSandbox } from "../sandbox/types.js";
import { executeAgenticTicket } from "./agentic-executor.js";
import { resolveExecutionMode, type ExecutionModeConfig } from "../queue/execution-mode.js";

const logger = pino({ name: "nightforge-pool" });

function lstatOrNull(target: string): Stats | null {
  try {
    return lstatSync(target);
  } catch {
    return null;
  }
}

async function linkNodeModules(
  repoPath: string,
  worktreePath: string
): Promise<void> {
  const source = path.join(repoPath, "node_modules");
  const target = path.join(worktreePath, "node_modules");
  // lstat, not existsSync: a broken or self-referential symlink must be
  // detected, never followed.
  if (lstatOrNull(target) !== null) {
    return;
  }
  const stats = lstatOrNull(source);
  if (stats === null) {
    logger.warn({ repoPath }, "No node_modules in origin repo; gates may fail");
    return;
  }
  if (stats.isSymbolicLink()) {
    // A symlinked origin node_modules is a corrupted install — linking it
    // into worktrees propagates the corruption (or creates a self-loop).
    logger.warn({ repoPath }, "Origin node_modules is a symlink; refusing to link");
    return;
  }
  if (!stats.isDirectory()) {
    return;
  }
  try {
    await symlink(realpathSync(source), target, "dir");
  } catch (err) {
    const error = err as Error;
    logger.warn(
      { worktreePath, err: error.message },
      "Could not link node_modules into worktree"
    );
  }
}

export interface WorkerPool {
  processTicket(
    job: TicketJob,
    projectConfig: ProjectConfig,
    modelProvider: ModelProvider
  ): Promise<WorkerResult>;
  /**
   * Remove the ticket's sandbox after the release stage. The worktree must
   * outlive implementation: the pipeline commits, merges, and deploys from it.
   */
  releaseTicket(job: TicketJob): Promise<void>;
  processAgenticTicket(
    job: TicketJob,
    agenticProvider: AgenticModelProvider,
    registry: ToolRegistry,
    approvalHandler: ApprovalHandler,
    maxIterations: number
  ): Promise<AgenticWorkerResult>;
  processAcpTicket(
    job: TicketJob,
    acpConfig: AcpWorkerConfig
  ): Promise<AcpWorkerResult>;
  getActiveWorkers(): number;
  shutdown(): Promise<void>;
}

export interface WorkerPoolOptions {
  /**
   * When true, releaseTicket keeps the sandbox instead of deleting it.
   * Used for tickets awaiting a human approval that will re-run the
   * release stage on the same worktree.
   */
  shouldKeepWorktree?: (job: TicketJob) => Promise<boolean>;
  /** OS-level sandbox for running agent commands. */
  sandbox?: OssSandbox;
  /** Agentic (tool-use) provider; enables the opt-in "agentic" ticket path. */
  agenticProvider?: AgenticModelProvider;
  /** Human approval handler for the agentic tool loop. */
  approvalHandler?: ApprovalHandler;
  /** Max LLM iterations in the agentic loop. */
  maxAgenticIterations?: number;
  /**
   * Autonomous execution-mode routing. When omitted, tickets route by
   * complexity automatically (no label required).
   */
  executionModeConfig?: ExecutionModeConfig;
}

export function createWorkerPool(
  sandboxManager: SandboxManager,
  projectsDir: string,
  maxRuntimeMinutes: number,
  options: WorkerPoolOptions = {}
): WorkerPool {
  let activeWorkers = 0;
  let isShuttingDown = false;
  const liveSandboxes = new Map<string, Sandbox>();

  const ticketKey = (job: TicketJob): string =>
    `${job.projectId}/${job.ticketId}`;

  async function cleanupSandbox(key: string): Promise<void> {
    const sandbox = liveSandboxes.get(key);
    if (sandbox === undefined) {
      return;
    }
    liveSandboxes.delete(key);
    await sandbox.cleanup();
  }

  return {
    async processTicket(
      job: TicketJob,
      projectConfig: ProjectConfig,
      modelProvider: ModelProvider
    ): Promise<WorkerResult> {
      if (isShuttingDown) {
        throw new Error("Worker pool is shutting down");
      }

      activeWorkers++;
      const log = logger.child({
        ticketId: job.ticketId,
        projectId: job.projectId,
      });

      log.info({ activeWorkers }, "Processing ticket");

      const key = ticketKey(job);
      // A retry for the same ticket replaces the previous sandbox.
      await cleanupSandbox(key);

      const repoPath = path.join(projectsDir, job.projectId);
      const sandbox = await sandboxManager.create(
        repoPath,
        job.projectId,
        job.ticketId
      );

      // Worktrees share no files with the origin checkout; link the
      // origin's node_modules so validation gates (lint/test/build) run.
      await linkNodeModules(repoPath, sandbox.worktreePath);
      liveSandboxes.set(key, sandbox);

      const timeoutMs = maxRuntimeMinutes * 60 * 1000;
      const isAgentic =
        resolveExecutionMode(job, options.executionModeConfig) === "agentic";
      const defaultApprover: ApprovalHandler = () => Promise.resolve("approved");

      try {
        if (
          isAgentic &&
          options.agenticProvider !== undefined &&
          options.sandbox !== undefined
        ) {
          log.info("Ticket uses agentic tool-use path");
          const result = await Promise.race([
            executeAgenticTicket(job, projectConfig, sandbox.worktreePath, {
              sandbox: options.sandbox,
              agenticProvider: options.agenticProvider,
              approvalHandler: options.approvalHandler ?? defaultApprover,
              maxIterations: options.maxAgenticIterations ?? 30,
            }),
            new Promise<never>((_, reject) => {
              setTimeout(() => {
                reject(new Error(`Worker timeout after ${String(maxRuntimeMinutes)} minutes`));
              }, timeoutMs);
            }),
          ]);
          return result;
        }

        const result = await Promise.race([
          executeWorker(job, {
            worktreePath: sandbox.worktreePath,
            projectConfig,
            modelProvider,
            sandbox: options.sandbox,
          }),
          new Promise<never>((_, reject) => {
            setTimeout(() => {
              reject(new Error(`Worker timeout after ${String(maxRuntimeMinutes)} minutes`));
            }, timeoutMs);
          }),
        ]);

        return result;
      } catch (err) {
        const error = err as Error;
        log.error({ err: error.message }, "Worker failed");

        return {
          success: false,
          summary: `Worker error: ${error.message}`,
          filesChanged: [],
          testResults: "",
          tokensUsed: 0,
          costUsd: 0,
        };
      } finally {
        activeWorkers--;
        // No cleanup here: the release stage still needs the worktree.
        // Callers must invoke releaseTicket once the ticket finishes.
        log.info({ activeWorkers }, "Ticket processing finished");
      }
    },

    async releaseTicket(job: TicketJob): Promise<void> {
      try {
        if (
          options.shouldKeepWorktree !== undefined &&
          (await options.shouldKeepWorktree(job))
        ) {
          logger.info(
            { ticketId: job.ticketId },
            "Worktree kept for pending approval"
          );
          return;
        }
        await cleanupSandbox(ticketKey(job));
      } catch (err) {
        const error = err as Error;
        logger.warn(
          { ticketId: job.ticketId, err: error.message },
          "Sandbox cleanup failed"
        );
      }
    },

    async processAgenticTicket(
      job: TicketJob,
      agenticProvider: AgenticModelProvider,
      registry: ToolRegistry,
      approvalHandler: ApprovalHandler,
      maxIterations: number
    ): Promise<AgenticWorkerResult> {
      if (isShuttingDown) {
        throw new Error("Worker pool is shutting down");
      }

      activeWorkers++;
      const log = logger.child({
        ticketId: job.ticketId,
        projectId: job.projectId,
        mode: job.mode ?? resolveTicketMode(job.labels),
      });

      log.info({ activeWorkers }, "Processing agentic ticket");

      try {
        return await executeAgenticWorker(job, agenticProvider, registry, {
          maxIterations,
          approvalHandler,
        });
      } catch (err) {
        const error = err as Error;
        log.error({ err: error.message }, "Agentic worker failed");
        return {
          success: false,
          summary: `Agentic worker error: ${error.message}`,
          toolCallsMade: 0,
          tokensUsed: 0,
          costUsd: 0,
          iterations: 0,
          effortLevel: job.effort ?? "high",
          budgetExceeded: false,
        };
      } finally {
        activeWorkers--;
        log.info({ activeWorkers }, "Agentic ticket processing finished");
      }
    },

    async processAcpTicket(
      job: TicketJob,
      acpConfig: AcpWorkerConfig
    ): Promise<AcpWorkerResult> {
      if (isShuttingDown) {
        throw new Error("Worker pool is shutting down");
      }

      activeWorkers++;
      const log = logger.child({
        ticketId: job.ticketId,
        projectId: job.projectId,
        adapter: shouldUseAcp(job.labels),
      });

      log.info({ activeWorkers }, "Processing ACP ticket");

      try {
        return await executeAcpWorker(job, acpConfig);
      } catch (err) {
        const error = err as Error;
        log.error({ err: error.message }, "ACP worker failed");
        return {
          success: false,
          summary: `ACP worker error: ${error.message}`,
          output: "",
          toolCalls: [],
          stopReason: "refusal",
          durationMs: 0,
          adapter: shouldUseAcp(job.labels) ?? "claude",
        };
      } finally {
        activeWorkers--;
        log.info({ activeWorkers }, "ACP ticket processing finished");
      }
    },

    getActiveWorkers(): number {
      return activeWorkers;
    },

    async shutdown(): Promise<void> {
      isShuttingDown = true;
      logger.info("Worker pool shutdown initiated");

      while (activeWorkers > 0) {
        await new Promise((resolve) => {
          setTimeout(resolve, 1000);
        });
      }

      logger.info("Worker pool shutdown complete");
    },
  };
}
