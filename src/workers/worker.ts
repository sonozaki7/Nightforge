import { execFile } from "node:child_process";
import { promisify } from "node:util";
import pino from "pino";
import type { TicketJob } from "../queue/scheduler.js";
import type { ProjectConfig } from "../projects/registry.js";
import type { GenerateOptions } from "../router/providers/base.js";
import { createPromptBuilder } from "../router/prompt-builder.js";
import { createContextManager } from "../memory/project-context.js";

const execFileAsync = promisify(execFile);
const logger = pino({ name: "nightforge-worker" });

export interface WorkerResult {
  success: boolean;
  summary: string;
  filesChanged: string[];
  testResults: string;
  tokensUsed: number;
  costUsd: number;
}

export interface ModelProvider {
  generate(prompt: string, options?: GenerateOptions): Promise<{
    content: string;
    tokensUsed: number;
    costUsd: number;
  }>;
}

export interface WorkerDeps {
  worktreePath: string;
  projectConfig: ProjectConfig;
  modelProvider: ModelProvider;
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

  // Build cache-optimized layered prompt
  const promptBuilder = createPromptBuilder();
  const contextManager = createContextManager();
  const projectContext = await contextManager.load(deps.worktreePath);
  const layers = promptBuilder.build(job, deps.projectConfig, projectContext);

  const generateOptions: GenerateOptions = {
    systemPromptBlocks: layers.systemBlocks,
  };

  log.info("Calling model provider");
  const modelResponse = await deps.modelProvider.generate(
    layers.userPrompt,
    generateOptions
  );

  log.info(
    { tokensUsed: modelResponse.tokensUsed },
    "Model response received"
  );

  const validationResults = await runValidation(
    deps.worktreePath,
    deps.projectConfig
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
    };
  }

  return {
    success: true,
    summary: `Implemented: ${job.title}`,
    filesChanged: [],
    testResults: validationResults.output,
    tokensUsed: modelResponse.tokensUsed,
    costUsd: modelResponse.costUsd,
  };
}

interface ValidationResult {
  allPassed: boolean;
  failureReason: string | null;
  output: string;
}

async function runValidation(
  worktreePath: string,
  config: ProjectConfig
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
