export interface SystemPromptBlock {
  text: string;
  /** Mark this block for provider-side caching (stable content only) */
  cacheable?: boolean;
}

export interface GenerateOptions {
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
  /** Structured system prompt blocks ordered for cache efficiency */
  systemPromptBlocks?: SystemPromptBlock[];
}

export interface GenerateResult {
  content: string;
  tokensUsed: number;
  inputTokens: number;
  outputTokens: number;
  /** Tokens served from provider cache (cheaper rate) */
  cachedInputTokens: number;
  costUsd: number;
  model: string;
  durationMs: number;
}

export interface Provider {
  readonly name: string;
  readonly modelName: string;
  generate(prompt: string, options?: GenerateOptions): Promise<GenerateResult>;
  getCostPerMillionInput(): number;
  getCostPerMillionOutput(): number;
}

export interface ProviderConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
}

export function calculateCost(
  inputTokens: number,
  outputTokens: number,
  costPerMillionInput: number,
  costPerMillionOutput: number
): number {
  const inputCost = (inputTokens / 1_000_000) * costPerMillionInput;
  const outputCost = (outputTokens / 1_000_000) * costPerMillionOutput;
  return inputCost + outputCost;
}

/* --- Tool-use (function calling) interfaces for the agentic worker --- */

/** Tool definition in OpenAI function-calling format (sent to the model) */
export interface FunctionToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/** A tool call returned by the model */
export interface ModelToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

/** Message format for multi-turn tool-use conversations */
export interface ToolUseMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ModelToolCall[];
  tool_call_id?: string;
}

/** Response from a tool-use generation call */
export interface ToolUseResponse {
  content: string | null;
  toolCalls: ModelToolCall[];
  finishReason: "stop" | "tool_calls" | "length";
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

/** Extended provider interface supporting tool-use (function calling) */
export interface ToolUseProvider extends Provider {
  generateWithTools(
    messages: ToolUseMessage[],
    tools: FunctionToolDef[]
  ): Promise<ToolUseResponse>;
}
