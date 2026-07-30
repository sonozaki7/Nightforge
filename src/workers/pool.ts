import pino from "pino";
import type { TicketJob } from "../queue/scheduler.js";
import type { ProjectConfig } from "../projects/registry.js";
import type { SandboxManager } from "./sandbox.js";
import { executeWorker, type ModelProvider, type WorkerResult } from "./worker.js";
import { resolveTicketMode } from "../tools/types.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { AgenticModelProvider, AgenticWorkerResult } from "./agentic-worker.js";
import { executeAgenticWorker } from "./agentic-worker.js";
import type { ApprovalHandler } from "../tools/types.js";
import { executeAcpWorker, shouldUseAcp, type AcpWorkerConfig } from "../acp/worker.js";
import type { AcpWorkerResult } from "../acp/types.js";

const logger = pino({ name: "nightforge-pool" });

export interface WorkerPool {
  processTicket(
    job: TicketJob,
    projectConfig: ProjectConfig,
    modelProvider: ModelProvider
  ): Promise<WorkerResult>;
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

export function createWorkerPool(
  sandboxManager: SandboxManager,
  projectPath: string,
  maxRuntimeMinutes: number
): WorkerPool {
  let activeWorkers = 0;
  let isShuttingDown = false;

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

      const sandbox = await sandboxManager.create(
        projectPath,
        job.projectId,
        job.ticketId
      );

      const timeoutMs = maxRuntimeMinutes * 60 * 1000;

      try {
        const result = await Promise.race([
          executeWorker(job, {
            worktreePath: sandbox.worktreePath,
            projectConfig,
            modelProvider,
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
        await sandbox.cleanup();
        log.info({ activeWorkers }, "Ticket processing finished");
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
