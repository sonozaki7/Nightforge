import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import path from "node:path";
import pino from "pino";
import type { TicketJob } from "../queue/scheduler.js";
import type { ProjectConfig } from "../projects/registry.js";
import type { GenerateOptions } from "../router/providers/base.js";
import type { Sandbox } from "../sandbox/types.js";
import { createPromptBuilder } from "../router/prompt-builder.js";
import { createContextManager } from "../memory/project-context.js";
import { buildRepoContext, renderRepoContext } from "../context/repo-context.js";
import { parseFileChanges, applyFileChanges } from "./file-changes.js";

const execFileAsync = promisify(execFile);

const logger = pino({ name: "nightforge-worker" });

export interface WorkerResult {
  success: boolean;
  summary: string;
  filesChanged: string[];
  testResults: string;
  tokensUsed: number;
  costUsd: number;
  /** Provider-reported model id and token split (telemetry + reporting). */
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
}

export interface ModelProvider {
  generate(prompt: string, options?: GenerateOptions): Promise<{
    content: string;
    tokensUsed: number;
    costUsd: number;
    model?: string;
    inputTokens?: number;
    outputTokens?: number;
  }>;
}

export interface WorkerDeps {
  worktreePath: string;
  projectConfig: ProjectConfig;
  modelProvider: ModelProvider;
  /** OS-level sandbox for running validation commands. */
  sandbox?: Sandbox;
}

export async function executeWorker(
  job: TicketJob,
  deps: WorkerDeps
): Promise<WorkerResult> {
  const log = logger.child({
    ticketId: job.ticketId,
    projectId: job.projectId,
  });

  log.info("Worker started");

  // Build cache-optimized layered prompt. The repo snapshot (file listing +
  // full content of ticket-relevant files) is required so the model can
  // reproduce existing files verbatim when emitting full-file blocks.
  const promptBuilder = createPromptBuilder();
  const contextManager = createContextManager();
  const projectContext = await contextManager.load(deps.worktreePath);
  const repoContext = await buildRepoContext(
    deps.worktreePath,
    `${job.title}\n${job.description}`
  );
  const layers = promptBuilder.build(
    job,
    deps.projectConfig,
    projectContext,
    renderRepoContext(repoContext)
  );

  const generateOptions: GenerateOptions = {
    systemPromptBlocks: layers.systemBlocks,
  };

  log.info("Calling model provider");
  const modelResponse = await deps.modelProvider.generate(
    layers.userPrompt,
    generateOptions
  );

  log.info(
    { tokensUsed: modelResponse.tokensUsed, repoFiles: repoContext.included.length },
    "Model response received"
  );

  // Flow step 4 (IMPLEMENTATION.md 1.5): parse -> extract -> apply.
  const changes = parseFileChanges(modelResponse.content);
  if (changes.length === 0) {
    log.warn("Model response contained no file changes");
    return {
      success: false,
      summary: "No file changes extracted from model response",
      filesChanged: [],
      testResults: "",
      tokensUsed: modelResponse.tokensUsed,
      costUsd: modelResponse.costUsd,
      model: modelResponse.model,
      inputTokens: modelResponse.inputTokens,
      outputTokens: modelResponse.outputTokens,
    };
  }

  const applied = await applyFileChanges(deps.worktreePath, changes);
  if (applied.applied.length === 0) {
    log.warn({ rejected: applied.rejected }, "All file changes rejected");
    return {
      success: false,
      summary: `All file changes rejected: ${applied.rejected[0]?.reason ?? "unknown"}`,
      filesChanged: [],
      testResults: "",
      tokensUsed: modelResponse.tokensUsed,
      costUsd: modelResponse.costUsd,
      model: modelResponse.model,
      inputTokens: modelResponse.inputTokens,
      outputTokens: modelResponse.outputTokens,
    };
  }

  // Overwrite guard: full-file content must preserve what already exists.
  // A change that drops most of an existing file is a hallucinated rewrite,
  // and shipping it would destroy real content.
  const shrink = await detectDestructiveShrink(deps.worktreePath, applied.applied);
  if (shrink !== null) {
    log.warn({ path: shrink.path, before: shrink.beforeLines, after: shrink.afterLines }, "Destructive overwrite rejected");
    return {
      success: false,
      summary: `Destructive overwrite rejected: ${shrink.path} shrank from ${String(shrink.beforeLines)} to ${String(shrink.afterLines)} lines`,
      filesChanged: [],
      testResults: "",
      tokensUsed: modelResponse.tokensUsed,
      costUsd: modelResponse.costUsd,
      model: modelResponse.model,
      inputTokens: modelResponse.inputTokens,
      outputTokens: modelResponse.outputTokens,
    };
  }

  const validationResults = await runValidation(
    deps.worktreePath,
    deps.projectConfig,
    deps.sandbox
  );

  if (!validationResults.allPassed) {
    log.warn({ results: validationResults }, "Validation failed");
    return {
      success: false,
      summary: `Validation failed: ${validationResults.failureReason ?? "unknown"}`,
      filesChanged: [],
      testResults: validationResults.output,
      tokensUsed: modelResponse.tokensUsed,
      costUsd: modelResponse.costUsd,
      model: modelResponse.model,
      inputTokens: modelResponse.inputTokens,
      outputTokens: modelResponse.outputTokens,
    };
  }

  return {
    success: true,
    summary: `Implemented: ${job.title}`,
    filesChanged: applied.applied,
    testResults: validationResults.output,
    tokensUsed: modelResponse.tokensUsed,
    costUsd: modelResponse.costUsd,
    model: modelResponse.model,
    inputTokens: modelResponse.inputTokens,
    outputTokens: modelResponse.outputTokens,
  };
}

export interface ValidationResult {
  allPassed: boolean;
  failureReason: string | null;
  output: string;
}

interface ShrinkInfo {
  path: string;
  beforeLines: number;
  afterLines: number;
}

/**
 * Returns the first applied change that destroyed existing content:
 * a file that had >= 10 lines and now keeps fewer than half.
 * New files and small files are never flagged.
 */
async function detectDestructiveShrink(
  worktreePath: string,
  appliedPaths: string[]
): Promise<ShrinkInfo | null> {
  for (const relPath of appliedPaths) {
    const target = path.resolve(worktreePath, relPath);
    const original = await originalContent(worktreePath, relPath);
    if (original === null) {
      continue; // new file — nothing to destroy
    }
    const beforeLines = countLines(original);
    if (beforeLines < 10) {
      continue;
    }
    const updated = await readFile(target, "utf8").catch((): string | null => null);
    if (updated === null) {
      continue;
    }
    const afterLines = countLines(updated);
    if (afterLines * 2 < beforeLines) {
      return { path: relPath, beforeLines, afterLines };
    }
  }
  return null;
}

/** Content of the file at HEAD, or null for files the commit doesn't know. */
async function originalContent(
  worktreePath: string,
  relPath: string
): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["show", `HEAD:${relPath}`],
      { cwd: worktreePath }
    );
    return stdout;
  } catch {
    return null;
  }
}

function countLines(text: string): number {
  return text.length === 0 ? 0 : text.split("\n").length;
}

export async function runValidation(
  worktreePath: string,
  config: ProjectConfig,
  sandbox?: Sandbox
): Promise<ValidationResult> {
  const commands = [
    { name: "lint", command: config.deployment.lintCommand },
    { name: "typecheck", command: config.deployment.typecheckCommand },
    { name: "test", command: config.deployment.testCommand },
    { name: "build", command: config.deployment.buildCommand },
  ];

  const outputs: string[] = [];

  for (const { name, command } of commands) {
    try {
      const [cmd = "", ...args] = command.split(" ");

      if (sandbox !== undefined) {
        const result = await sandbox.exec({
          worktreePath,
          readOnlyPaths: [],
          cwd: ".",
          command: cmd,
          args,
        });
        outputs.push(`[${name}] ${result.exitCode === 0 ? "PASS" : "FAIL"}\n${result.stdout}`);
        if (result.stderr) outputs.push(`[${name} stderr]\n${result.stderr}`);
        if (result.timedOut) {
          return {
            allPassed: false,
            failureReason: `${name} timed out`,
            output: outputs.join("\n---\n"),
          };
        }
        if (result.exitCode !== 0) {
          return {
            allPassed: false,
            failureReason: `${name} failed (exit ${String(result.exitCode)})`,
            output: outputs.join("\n---\n"),
          };
        }
        continue;
      }

      const { stdout, stderr } = await execFileAsync(cmd, args, {
        cwd: worktreePath,
        timeout: 300000,
      });
      outputs.push(`[${name}] PASS\n${stdout}`);
      if (stderr) outputs.push(`[${name} stderr]\n${stderr}`);
    } catch (err) {
      const error = err as { stdout?: string; stderr?: string; message: string };
      outputs.push(`[${name}] FAIL\n${error.stdout ?? ""}\n${error.stderr ?? ""}`);
      return {
        allPassed: false,
        failureReason: `${name} failed`,
        output: outputs.join("\n---\n"),
      };
    }
  }

  return {
    allPassed: true,
    failureReason: null,
    output: outputs.join("\n---\n"),
  };
}
