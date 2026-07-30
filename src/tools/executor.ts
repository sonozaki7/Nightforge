import pino from "pino";
import type { ToolRegistry } from "./registry.js";
import type {
  ToolCall,
  ToolResult,
  ApprovalHandler,
  ApprovalRequest,
} from "./types.js";

const logger = pino({ name: "nightforge-tool-executor" });

export interface ExecutorOptions {
  ticketId: string;
  approvalHandler: ApprovalHandler;
  /** Maximum execution time per tool call in ms */
  timeoutMs?: number;
}

export interface ToolExecutor {
  execute(call: ToolCall): Promise<ToolResult>;
  executeBatch(calls: ToolCall[]): Promise<ToolResult[]>;
}

const DEFAULT_TIMEOUT_MS = 60_000;

export function createToolExecutor(
  registry: ToolRegistry,
  options: ExecutorOptions
): ToolExecutor {
  const { ticketId, approvalHandler, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
  const log = logger.child({ ticketId });

  async function execute(call: ToolCall): Promise<ToolResult> {
    const start = Date.now();
    const tool = registry.get(call.name);

    if (!tool) {
      log.warn({ tool: call.name }, "Unknown tool requested");
      return {
        success: false,
        data: null,
        error: `Unknown tool: ${call.name}. Available tools: ${registry.getAll().map((t) => t.definition.name).join(", ")}`,
        durationMs: Date.now() - start,
      };
    }

    // Check permission tier
    const tier = registry.resolvePermission(call.name, call.arguments);

    if (tier === "forbidden") {
      log.warn({ tool: call.name, args: call.arguments }, "Forbidden tool blocked");
      return {
        success: false,
        data: null,
        error: `Tool "${call.name}" with these arguments is forbidden by policy. Choose an alternative approach.`,
        durationMs: Date.now() - start,
      };
    }

    if (tier === "approve") {
      const request: ApprovalRequest = {
        ticketId,
        toolName: call.name,
        args: call.arguments,
        reason: `Agent wants to call ${call.name}`,
        requestedAt: Date.now(),
      };

      log.info({ tool: call.name }, "Requesting human approval");
      const decision = await approvalHandler(request);

      if (decision !== "approved") {
        log.info({ tool: call.name, decision }, "Approval denied");
        return {
          success: false,
          data: null,
          error: `Action denied by human reviewer (${decision}). Try an alternative approach or ask for clarification.`,
          durationMs: Date.now() - start,
        };
      }

      log.info({ tool: call.name }, "Approval granted");
    }

    // Execute with timeout
    try {
      const result = await Promise.race([
        tool.execute(call.arguments),
        new Promise<ToolResult>((_, reject) => {
          setTimeout(() => {
            reject(new Error(`Tool "${call.name}" timed out after ${String(timeoutMs)}ms`));
          }, timeoutMs);
        }),
      ]);

      log.info(
        { tool: call.name, success: result.success, durationMs: result.durationMs },
        "Tool executed"
      );

      return result;
    } catch (err) {
      const error = err as Error;
      log.error({ tool: call.name, error: error.message }, "Tool execution failed");
      return {
        success: false,
        data: null,
        error: error.message,
        durationMs: Date.now() - start,
      };
    }
  }

  return {
    execute,

    async executeBatch(calls: ToolCall[]): Promise<ToolResult[]> {
      // Execute sequentially to respect approval flow ordering
      const results: ToolResult[] = [];
      for (const call of calls) {
        results.push(await execute(call));
      }
      return results;
    },
  };
}
