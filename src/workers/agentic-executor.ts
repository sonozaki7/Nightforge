import { execFile } from "node:child_process";
import { promisify } from "node:util";
import pino from "pino";
import type { TicketJob } from "../queue/scheduler.js";
import type { ProjectConfig } from "../projects/registry.js";
import type { Sandbox } from "../sandbox/types.js";
import type { AgenticModelProvider, AgenticWorkerResult } from "./agentic-worker.js";
import { executeAgenticWorker } from "./agentic-worker.js";
import type { WorkerResult } from "./worker.js";
import { runValidation } from "./worker.js";
import { buildToolRegistry } from "../tools/assembly.js";
import type { ApprovalHandler } from "../tools/types.js";

const execFileAsync = promisify(execFile);
const logger = pino({ name: "nightforge-agentic-executor" });

export interface AgenticExecutorConfig {
  sandbox: Sandbox;
  agenticProvider: AgenticModelProvider;
  approvalHandler: ApprovalHandler;
  maxIterations: number;
  readOnlyPaths?: string[];
}

/**
 * Run a ticket through the agentic (tool-use) worker, then require the same
 * deterministic validation gates the normal worker enforces. The tool loop
 * can fix its own failures; validation cannot be bypassed by the model.
 */
export async function executeAgenticTicket(
  job: TicketJob,
  projectConfig: ProjectConfig,
  worktreePath: string,
  config: AgenticExecutorConfig
): Promise<WorkerResult> {
  const log = logger.child({ ticketId: job.ticketId, projectId: job.projectId });

  const registry = buildToolRegistry({
    sandbox: config.sandbox,
    worktreePath,
    readOnlyPaths: config.readOnlyPaths,
  });

  log.info(
    { tools: registry.getAll().map((t) => t.definition.name) },
    "Running agentic worker"
  );

  const workerResult: AgenticWorkerResult = await executeAgenticWorker(
    job,
    config.agenticProvider,
    registry,
    {
      maxIterations: config.maxIterations,
      approvalHandler: config.approvalHandler,
    }
  );

  if (!workerResult.success) {
    log.warn({ summary: workerResult.summary }, "Agentic worker failed");
    return {
      success: false,
      summary: workerResult.summary,
      filesChanged: [],
      testResults: "",
      tokensUsed: workerResult.tokensUsed,
      costUsd: workerResult.costUsd,
    };
  }

  // The model claiming success is never enough — run the real gates.
  const filesChanged = await changedFiles(worktreePath);
  const validation = await runValidation(worktreePath, projectConfig, config.sandbox);

  if (!validation.allPassed) {
    log.warn({ reason: validation.failureReason }, "Validation failed after agentic run");
    return {
      success: false,
      summary: `Validation failed: ${validation.failureReason ?? "unknown"}`,
      filesChanged,
      testResults: validation.output,
      tokensUsed: workerResult.tokensUsed,
      costUsd: workerResult.costUsd,
    };
  }

  return {
    success: true,
    summary: `Implemented: ${job.title}`,
    filesChanged,
    testResults: validation.output,
    tokensUsed: workerResult.tokensUsed,
    costUsd: workerResult.costUsd,
  };
}

/** Files changed in the worktree vs HEAD (relative paths). */
async function changedFiles(worktreePath: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["status", "--porcelain"],
      { cwd: worktreePath, timeout: 30_000 }
    );
    return stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => line.replace(/^\S+\s+/, "").split(" -> ").pop() ?? "");
  } catch (err) {
    const error = err as Error;
    logger.warn({ err: error.message }, "Could not list changed files");
    return [];
  }
}