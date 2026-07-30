/**
 * Core type definitions for the Nightforge tool orchestration system.
 * Tools are generic capabilities the agentic worker can invoke dynamically.
 */

/** Permission tier determines whether a tool call needs human approval */
export type PermissionTier = "auto" | "approve" | "forbidden";

/** JSON Schema subset for tool parameter definitions (sent to LLM) */
export interface ToolParameterSchema {
  type: "object";
  properties: Record<string, ToolPropertyDef>;
  required?: string[];
}

export interface ToolPropertyDef {
  type: "string" | "number" | "boolean" | "object" | "array";
  description: string;
  enum?: string[];
  items?: { type: string };
}

/** A tool definition exposed to the LLM for function calling */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolParameterSchema;
  /** Permission tier for this tool (default: "auto") */
  permission: PermissionTier;
  /** Service category for grouping (e.g. "stripe", "cloudflare", "crawl") */
  service: string;
}

/** Result of executing a tool */
export interface ToolResult {
  success: boolean;
  data: unknown;
  error?: string;
  durationMs: number;
}

/** A tool call requested by the LLM */
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** Executable tool: definition + implementation */
export interface Tool {
  definition: ToolDefinition;
  execute(args: Record<string, unknown>): Promise<ToolResult>;
}

/** Approval request sent to Telegram for "approve" tier tools */
export interface ApprovalRequest {
  ticketId: string;
  toolName: string;
  args: Record<string, unknown>;
  reason: string;
  requestedAt: number;
}

export type ApprovalDecision = "approved" | "denied" | "timeout";

/** Callback for requesting human approval via Telegram */
export type ApprovalHandler = (
  request: ApprovalRequest
) => Promise<ApprovalDecision>;

/** Configuration for the tool permission system */
export interface PermissionRule {
  /** Glob pattern: "service:method:path" e.g. "stripe:POST:/v1/charges" */
  pattern: string;
  tier: PermissionTier;
}

/** Execution mode: automation (routine/recurring) or ticket (problem to solve) */
export type TicketMode = "automation" | "ticket";

/** Determines ticket mode from labels */
export function resolveTicketMode(labels: string[]): TicketMode {
  const lower = labels.map((l) => l.toLowerCase());
  if (lower.includes("automation") || lower.includes("ops") || lower.includes("routine")) return "automation";
  return "ticket";
}
