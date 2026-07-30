/**
 * ACP (Agent Client Protocol) type definitions.
 * Based on https://agentclientprotocol.com/protocol/v1/schema
 *
 * ACP uses JSON-RPC 2.0 over stdio. Nightforge acts as the Client,
 * spawning ACP agent adapters (claude-agent-acp, codex-acp) as subprocesses.
 */

/* --- JSON-RPC 2.0 envelope --- */

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: JsonRpcError;
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

/* --- Protocol version --- */

export type ProtocolVersion = "1" | "1.1" | "1.2";

export const LATEST_PROTOCOL_VERSION: ProtocolVersion = "1.2";

/* --- Initialization --- */

export interface Implementation {
  name: string;
  version: string;
}

export interface ClientCapabilities {
  fs?: {
    readTextFile?: boolean;
    writeTextFile?: boolean;
  };
  terminal?: boolean;
}

export interface InitializeRequest {
  protocolVersion: ProtocolVersion;
  clientInfo?: Implementation;
  clientCapabilities?: ClientCapabilities;
}

export interface AgentCapabilities {
  loadSession?: boolean;
  promptCapabilities?: {
    image?: boolean;
    audio?: boolean;
    embeddedContext?: boolean;
  };
  mcpCapabilities?: {
    http?: boolean;
    sse?: boolean;
  };
  sessionCapabilities?: {
    close?: boolean;
    list?: boolean;
    delete?: boolean;
    resume?: boolean;
  };
  auth?: Record<string, unknown>;
}

export interface AuthMethod {
  id: string;
  type: string;
  name?: string;
}

export interface InitializeResponse {
  protocolVersion: ProtocolVersion;
  agentInfo?: Implementation;
  agentCapabilities?: AgentCapabilities;
  authMethods?: AuthMethod[];
}

/* --- Session --- */

export type SessionId = string;

export interface McpServer {
  name: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
}

export interface NewSessionRequest {
  cwd: string;
  mcpServers: McpServer[];
  additionalDirectories?: string[];
}

export interface NewSessionResponse {
  sessionId: SessionId;
  modes?: SessionModeState;
  configOptions?: SessionConfigOption[];
}

export interface SessionModeState {
  current?: string;
  available?: Array<{ id: string; name: string }>;
}

export interface SessionConfigOption {
  id: string;
  name: string;
  value?: unknown;
}

/* --- Prompt turn --- */

export interface ContentBlock {
  type: "text" | "image" | "resource" | "resource_link";
  text?: string;
  mimeType?: string;
  data?: string;
  uri?: string;
}

export interface PromptRequest {
  sessionId: SessionId;
  prompt: ContentBlock[];
}

export type StopReason =
  | "end_turn"
  | "max_tokens"
  | "cancelled"
  | "refusal";

export interface PromptResponse {
  stopReason: StopReason;
}

/* --- Session updates (notifications from agent) --- */

export type SessionUpdateKind =
  | "agent_message_chunk"
  | "agent_thought_chunk"
  | "tool_call"
  | "tool_call_update"
  | "plan"
  | "mode_change";

export interface SessionUpdateNotification {
  sessionId: SessionId;
  update: SessionUpdate;
}

export interface SessionUpdate {
  kind: SessionUpdateKind;
  /** For message chunks */
  content?: ContentBlock;
  /** For tool calls */
  toolCall?: ToolCallUpdate;
}

export interface ToolCallUpdate {
  id: string;
  name: string;
  kind?: string;
  status?: "pending" | "running" | "completed" | "failed";
  /** Human-readable description of what the tool is doing */
  title?: string;
  result?: string;
}

/* --- Permission requests (agent → client) --- */

export interface PermissionRequest {
  sessionId: SessionId;
  permissionId: string;
  toolName: string;
  description: string;
  /** The tool call details for display */
  input?: Record<string, unknown>;
}

export type PermissionResponse = "allow" | "deny" | "allow_always";

/* --- Cancel --- */

export interface CancelNotification {
  sessionId: SessionId;
}

/* --- ACP adapter configuration --- */

export type AcpAdapterId = "claude" | "codex";

export interface AcpAdapterConfig {
  id: AcpAdapterId;
  /** npm package or binary name */
  command: string;
  /** Arguments passed to the command */
  args: string[];
  /** Environment variables required */
  requiredEnv: string[];
  /** Human-readable name */
  displayName: string;
  /** Permission mode: auto = skip approvals, approve = ask for risky ops */
  permissionMode: "auto" | "smart-approve" | "approve";
}

/* --- ACP worker result --- */

export interface AcpWorkerResult {
  success: boolean;
  summary: string;
  /** All text content produced by the agent */
  output: string;
  /** Tool calls the agent made (for reporting) */
  toolCalls: Array<{ name: string; status: string; title?: string }>;
  /** Stop reason from the final prompt response */
  stopReason: StopReason;
  /** Duration of the entire session */
  durationMs: number;
  /** Which adapter was used */
  adapter: AcpAdapterId;
}
