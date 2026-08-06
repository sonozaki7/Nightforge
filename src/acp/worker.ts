/**
 * ACP Worker — executes tickets using external ACP agents (Claude Code, Codex)
 * via the Agent Client Protocol.
 *
 * This is an alternative execution path to the internal agentic-worker.
 * When a ticket has an "acp" label, it's routed here instead of the normal
 * LLM loop. The ACP agent handles its own tool-use loop internally —
 * Nightforge just provides the task and handles permission requests.
 *
 * Key benefit: Users with existing Claude/Codex subscriptions can use
 * Nightforge without buying additional API credits.
 */
import pino from "pino";
import type { TicketJob } from "../queue/scheduler.js";
import type { ApprovalHandler } from "../tools/types.js";
import { AcpClient } from "./client.js";
import { getAdapter, resolveAcpAdapter, getInstallInstructions } from "./adapters.js";
import type {
  AcpAdapterId,
  AcpWorkerResult,
  PermissionRequest,
  PermissionResponse,
  SessionUpdateNotification,
  StopReason,
} from "./types.js";

const logger = pino({ name: "nightforge-acp-worker" });

export interface AcpWorkerConfig {
  /** Working directory for the ACP session (project root) */
  cwd: string;
  /** Approval handler for permission requests */
  approvalHandler: ApprovalHandler;
  /** Timeout for the entire ACP session (ms). Default: 30 minutes */
  sessionTimeoutMs?: number;
  /** Whether to auto-approve all permission requests */
  autoApprove?: boolean;
}

const DEFAULT_SESSION_TIMEOUT = 1_800_000; // 30 minutes

/**
 * Execute a ticket using an ACP agent adapter.
 *
 * Flow:
 * 1. Resolve which adapter to use from ticket labels
 * 2. Spawn the adapter subprocess
 * 3. Initialize + create session
 * 4. Send the ticket as a prompt
 * 5. Collect session updates (progress, tool calls)
 * 6. Handle permission requests through the approval handler
 * 7. Return the final result
 */
export async function executeAcpWorker(
  job: TicketJob,
  config: AcpWorkerConfig
): Promise<AcpWorkerResult> {
  const startTime = Date.now();
  const log = logger.child({ ticketId: job.ticketId, projectId: job.projectId });

  // Resolve adapter from labels
  const adapterId = resolveAcpAdapter(job.labels);
  if (!adapterId) {
    return {
      success: false,
      summary: "No ACP adapter specified. Add label 'acp:claude' or 'acp:codex'.",
      output: "",
      toolCalls: [],
      stopReason: "refusal",
      durationMs: Date.now() - startTime,
      adapter: "claude",
    };
  }

  const adapter = getAdapter(adapterId);
  log.info({ adapter: adapterId, displayName: adapter.displayName }, "Starting ACP worker");

  // Collect results from session updates
  const outputChunks: string[] = [];
  const toolCallsMade: Array<{ name: string; status: string; title?: string }> = [];

  // Create the ACP client with permission handling
  const client = new AcpClient(adapter, {
    cwd: config.cwd,
    rpcTimeoutMs: config.sessionTimeoutMs ?? DEFAULT_SESSION_TIMEOUT,
    onPermissionRequest: createPermissionHandler(config, log),
  });

  // Listen for session updates
  client.on("session:update", (update: SessionUpdateNotification) => {
    handleSessionUpdate(update, outputChunks, toolCallsMade, log);
  });

  client.on("stderr", (data: string) => {
    log.debug({ stderr: data.slice(0, 500) }, "ACP adapter stderr");
  });

  try {
    // Connect and initialize
    await client.connect();

    // Create a session
    await client.createSession();

    // Build the prompt from the ticket
    const prompt = buildAcpPrompt(job);
    log.info({ promptLength: prompt.length }, "Sending prompt to ACP agent");

    // Send the prompt and wait for completion
    const response = await client.prompt(prompt);

    const durationMs = Date.now() - startTime;
    const success = response.stopReason === "end_turn";

    log.info(
      { stopReason: response.stopReason, durationMs, toolCalls: toolCallsMade.length },
      "ACP worker completed"
    );

    return {
      success,
      summary: buildSummary(outputChunks, toolCallsMade, response.stopReason),
      output: outputChunks.join("\n"),
      toolCalls: toolCallsMade,
      stopReason: response.stopReason,
      durationMs,
      adapter: adapterId,
    };
  } catch (err) {
    const error = err as Error;
    const durationMs = Date.now() - startTime;

    // Check if it's a "binary not found" error
    if (error.message.includes("ENOENT") || error.message.includes("spawn")) {
      log.error({ adapter: adapterId }, "ACP adapter binary not found");
      return {
        success: false,
        summary: `ACP adapter '${adapterId}' not installed.\n${getInstallInstructions(adapterId)}`,
        output: "",
        toolCalls: toolCallsMade,
        stopReason: "refusal",
        durationMs,
        adapter: adapterId,
      };
    }

    log.error({ err: error.message }, "ACP worker failed");
    return {
      success: false,
      summary: `ACP worker error: ${error.message}`,
      output: outputChunks.join("\n"),
      toolCalls: toolCallsMade,
      stopReason: "refusal",
      durationMs,
      adapter: adapterId,
    };
  } finally {
    await client.disconnect();
  }
}

/**
 * Check if ACP execution should be used for a given ticket.
 * Returns the adapter ID if ACP labels are present, null otherwise.
 */
export function shouldUseAcp(labels: string[]): AcpAdapterId | null {
  return resolveAcpAdapter(labels);
}

/* --- Internal helpers --- */

function createPermissionHandler(
  config: AcpWorkerConfig,
  log: pino.Logger
): (request: PermissionRequest) => Promise<PermissionResponse> {
  return async (request: PermissionRequest): Promise<PermissionResponse> => {
    // Auto-approve mode: allow everything without asking
    if (config.autoApprove) {
      log.info({ tool: request.toolName }, "Auto-approving permission request");
      return "allow";
    }

    // Forward to Telegram approval handler
    log.info(
      { tool: request.toolName, description: request.description },
      "Requesting permission via approval handler"
    );

    const decision = await config.approvalHandler({
      ticketId: request.sessionId,
      toolName: request.toolName,
      args: request.input ?? {},
      reason: request.description,
      requestedAt: Date.now(),
    });

    if (decision === "approved") return "allow";
    return "deny";
  };
}

function handleSessionUpdate(
  update: SessionUpdateNotification,
  outputChunks: string[],
  toolCalls: Array<{ name: string; status: string; title?: string }>,
  log: pino.Logger
): void {
  const sessionUpdate = update.update;

  switch (sessionUpdate.kind) {
    case "agent_message_chunk":
      if (sessionUpdate.content?.text) {
        outputChunks.push(sessionUpdate.content.text);
      }
      break;

    case "tool_call":
      if (sessionUpdate.toolCall) {
        const tc = sessionUpdate.toolCall;
        toolCalls.push({
          name: tc.name,
          status: tc.status ?? "running",
          title: tc.title,
        });
        log.info({ tool: tc.name, status: tc.status }, "ACP agent tool call");
      }
      break;

    case "tool_call_update":
      if (sessionUpdate.toolCall) {
        const tc = sessionUpdate.toolCall;
        // Update existing tool call status
        const existing = toolCalls.find((t) => t.name === tc.name);
        if (existing && tc.status) {
          existing.status = tc.status;
        }
      }
      break;

    default:
      // agent_thought_chunk, plan, mode_change — log but don't collect
      break;
  }
}

function buildAcpPrompt(job: TicketJob): string {
  const parts: string[] = [
    `## Task: ${job.title}`,
    "",
    job.description,
    "",
  ];

  if (job.labels.length > 0) {
    parts.push(`Labels: ${job.labels.filter((l) => !l.startsWith("acp")).join(", ")}`);
    parts.push("");
  }

  parts.push(
    "Complete this task fully. When finished, provide a clear summary of what was accomplished.",
    "If you encounter blockers, explain what's needed to proceed."
  );

  return parts.join("\n");
}

function buildSummary(
  outputChunks: string[],
  toolCalls: Array<{ name: string; status: string }>,
  stopReason: StopReason
): string {
  const output = outputChunks.join("").trim();
  const completedTools = toolCalls.filter((t) => t.status === "completed").length;
  const failedTools = toolCalls.filter((t) => t.status === "failed").length;

  const parts: string[] = [];

  if (output) {
    // Take last 2000 chars of output as summary
    parts.push(output.length > 2000 ? `...${output.slice(-2000)}` : output);
  }

  parts.push("");
  parts.push(`---`);
  parts.push(`Stop reason: ${stopReason}`);
  parts.push(`Tool calls: ${String(toolCalls.length)} total, ${String(completedTools)} completed, ${String(failedTools)} failed`);

  return parts.join("\n");
}
