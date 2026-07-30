import pino from "pino";
import type { TicketJob } from "../queue/scheduler.js";
import type { ToolDefinition, ToolCall, ApprovalHandler, TicketMode } from "../tools/types.js";
import { resolveTicketMode } from "../tools/types.js";
import type { ToolRegistry } from "../tools/registry.js";
import { createToolExecutor } from "../tools/executor.js";
import { getEffortConfig, resolveEffortLevel, type EffortLevel } from "./effort-levels.js";

const logger = pino({ name: "nightforge-agentic-worker" });

/** Message in the agentic conversation */
interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
}

/** LLM interface for tool-use (function calling) */
export interface AgenticModelProvider {
  generateWithTools(
    messages: Message[],
    tools: ToolDefinition[]
  ): Promise<{
    content: string | null;
    toolCalls: ToolCall[];
    tokensUsed: number;
    costUsd: number;
    finishReason: "stop" | "tool_calls" | "length";
  }>;
}

export interface AgenticWorkerConfig {
  maxIterations: number;
  approvalHandler: ApprovalHandler;
  /** Context compaction: summarize when messages exceed this count */
  compactionThreshold: number;
  /** Effort level controlling execution intensity */
  effortLevel?: EffortLevel;
  /** Token budget cap in USD (0 = unlimited) */
  tokenBudgetUsd?: number;
}

export interface AgenticWorkerResult {
  success: boolean;
  summary: string;
  toolCallsMade: number;
  tokensUsed: number;
  costUsd: number;
  iterations: number;
  effortLevel: EffortLevel;
  budgetExceeded: boolean;
}

const DEFAULT_CONFIG: AgenticWorkerConfig = {
  maxIterations: 30,
  compactionThreshold: 40,
  approvalHandler: () => Promise.resolve("approved"),
};

const ORCHESTRATOR_SYSTEM_PROMPT = `You are Nightforge, an autonomous operations agent. You complete tasks by calling tools in a loop until the objective is achieved.

RULES:
1. Break complex tasks into steps. Execute them one at a time.
2. After each tool call, verify the result before proceeding.
3. If a tool fails, analyze the error and try an alternative approach.
4. If 3 consecutive attempts fail on the same step, stop and report the failure.
5. Never repeat the exact same tool call with identical arguments.
6. When the task is complete, respond with a summary (no tool calls).
7. For actions that modify external state (payments, emails, deployments), explain what you're about to do before calling the tool.
8. Keep responses concise. Focus on actions, not explanations.

VERIFICATION PATTERN:
- After creating something → read it back to confirm
- After sending email → check the response confirms delivery
- After deploying → verify the endpoint responds
- After extracting data → validate the format is correct`;

/**
 * The agentic worker: a tool-use loop that runs until the LLM stops calling tools.
 * This is the core orchestration primitive — same pattern as Claude Code.
 */
export async function executeAgenticWorker(
  job: TicketJob,
  modelProvider: AgenticModelProvider,
  registry: ToolRegistry,
  config: Partial<AgenticWorkerConfig> = {}
): Promise<AgenticWorkerResult> {
  // Resolve mode + effort: mode from labels, effort from labels or explicit config
  const mode: TicketMode = job.mode === "automation" ? "automation" : resolveTicketMode(job.labels);
  const effortLevel = config.effortLevel ?? resolveEffortLevel(job.labels);
  const effort = getEffortConfig(mode, effortLevel);

  const cfg: AgenticWorkerConfig = {
    maxIterations: config.maxIterations ?? effort.maxIterations,
    compactionThreshold: config.compactionThreshold ?? effort.compactionThreshold,
    approvalHandler: config.approvalHandler ?? DEFAULT_CONFIG.approvalHandler,
    effortLevel,
    tokenBudgetUsd: config.tokenBudgetUsd ?? effort.tokenBudgetUsd,
  };

  const log = logger.child({ ticketId: job.ticketId, projectId: job.projectId, effort: effortLevel });

  const executor = createToolExecutor(registry, {
    ticketId: job.ticketId,
    approvalHandler: cfg.approvalHandler,
  });

  const tools = registry.getDefinitions();
  const systemPrompt = `${ORCHESTRATOR_SYSTEM_PROMPT}\n\n${effort.promptModifier}`;
  const messages: Message[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: buildTaskPrompt(job) },
  ];

  let totalTokens = 0;
  let totalCost = 0;
  let totalToolCalls = 0;
  let iteration = 0;

  log.info(
    { tools: tools.length, maxIterations: cfg.maxIterations, effort: effortLevel, budget: cfg.tokenBudgetUsd },
    "Agentic worker started"
  );

  while (iteration < cfg.maxIterations) {
    iteration++;

    // Check token budget
    if (cfg.tokenBudgetUsd && cfg.tokenBudgetUsd > 0 && totalCost >= cfg.tokenBudgetUsd) {
      log.warn({ totalCost, budget: cfg.tokenBudgetUsd }, "Token budget exceeded");
      return {
        success: false,
        summary: `Token budget exceeded ($${totalCost.toFixed(4)} / $${String(cfg.tokenBudgetUsd)}). Partial progress: ${String(totalToolCalls)} tool calls made.`,
        toolCallsMade: totalToolCalls,
        tokensUsed: totalTokens,
        costUsd: totalCost,
        iterations: iteration,
        effortLevel,
        budgetExceeded: true,
      };
    }

    // Compact context if it's getting too long
    if (messages.length > cfg.compactionThreshold) {
      compactMessages(messages);
      log.info({ messageCount: messages.length }, "Context compacted");
    }

    const response = await modelProvider.generateWithTools(messages, tools);
    totalTokens += response.tokensUsed;
    totalCost += response.costUsd;

    // If no tool calls, the agent is done
    if (response.finishReason === "stop" || response.toolCalls.length === 0) {
      log.info({ iterations: iteration, totalToolCalls, effort: effortLevel }, "Agent completed");
      return {
        success: true,
        summary: response.content ?? "Task completed",
        toolCallsMade: totalToolCalls,
        tokensUsed: totalTokens,
        costUsd: totalCost,
        iterations: iteration,
        effortLevel,
        budgetExceeded: false,
      };
    }

    // Add assistant message with tool calls
    messages.push({
      role: "assistant",
      content: response.content ?? "",
      toolCalls: response.toolCalls,
    });

    // Execute each tool call and add results
    for (const call of response.toolCalls) {
      totalToolCalls++;
      log.info({ tool: call.name, iteration }, "Executing tool");

      const result = await executor.execute(call);

      messages.push({
        role: "tool",
        content: JSON.stringify({
          success: result.success,
          data: result.data,
          error: result.error,
        }),
        toolCallId: call.id,
      });
    }
  }

  // Hit max iterations
  log.warn({ iterations: iteration, effort: effortLevel }, "Max iterations reached");
  return {
    success: false,
    summary: `Reached maximum iterations (${String(cfg.maxIterations)}) without completing the task.`,
    toolCallsMade: totalToolCalls,
    tokensUsed: totalTokens,
    costUsd: totalCost,
    iterations: iteration,
    effortLevel,
    budgetExceeded: false,
  };
}

/**
 * Spawn concurrent sub-agents for deep-task decomposition.
 * Each sub-agent gets its own message history and tool access.
 */
export async function spawnSubAgents(
  subTasks: Array<{ title: string; description: string }>,
  modelProvider: AgenticModelProvider,
  registry: ToolRegistry,
  config: Partial<AgenticWorkerConfig> = {}
): Promise<AgenticWorkerResult[]> {
  const log = logger.child({ subTaskCount: subTasks.length });
  log.info("Spawning concurrent sub-agents");

  const results = await Promise.allSettled(
    subTasks.map((task) => {
      const job: TicketJob = {
        ticketId: `sub-${task.title.slice(0, 20).replace(/\s/g, "-")}`,
        projectId: "sub-agent",
        title: task.title,
        description: task.description,
        labels: [],
        priority: 5,
        attempt: 1,
      };
      return executeAgenticWorker(job, modelProvider, registry, {
        ...config,
        maxIterations: Math.min(config.maxIterations ?? 20, 20),
      });
    })
  );

  return results.map((r) =>
    r.status === "fulfilled"
      ? r.value
      : {
          success: false,
          summary: `Sub-agent crashed: ${(r.reason as Error).message}`,
          toolCallsMade: 0,
          tokensUsed: 0,
          costUsd: 0,
          iterations: 0,
          effortLevel: config.effortLevel ?? "high",
          budgetExceeded: false,
        }
  );
}

function buildTaskPrompt(job: TicketJob): string {
  return [
    `## Task: ${job.title}`,
    "",
    job.description,
    "",
    job.labels.length > 0 ? `Labels: ${job.labels.join(", ")}` : "",
    "",
    "Complete this task using the available tools. When finished, provide a summary of what was accomplished.",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Context compaction: keep system prompt + first user message + last N messages.
 * Summarize the middle section into a single condensed message.
 * This prevents context window overflow on long-running tasks.
 */
function compactMessages(messages: Message[]): void {
  // Keep: [0] system, [1] first user message, last 20 messages
  const keepTail = 20;
  if (messages.length <= keepTail + 2) return;

  const head = messages.slice(0, 2);
  const tail = messages.slice(-keepTail);
  const middle = messages.slice(2, -keepTail);

  // Summarize middle section
  const toolCallsInMiddle = middle.filter((m) => m.role === "tool").length;
  const errorsInMiddle = middle.filter(
    (m) => m.role === "tool" && m.content.includes('"success":false')
  ).length;

  const summary: Message = {
    role: "user",
    content: `[CONTEXT SUMMARY: ${String(middle.length)} previous messages compacted. ` +
      `${String(toolCallsInMiddle)} tool calls were made, ${String(errorsInMiddle)} had errors. ` +
      `Continue from the most recent messages below.]`,
  };

  // Replace messages in-place
  messages.length = 0;
  messages.push(...head, summary, ...tail);
}
