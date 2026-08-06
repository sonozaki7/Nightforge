import OpenAI from "openai";
import pino from "pino";
import { withRetry } from "./retry.js";
import type { AgenticModelProvider } from "../../workers/agentic-worker.js";
import type { ToolDefinition } from "../../tools/types.js";
import { calculateCost } from "./base.js";

const logger = pino({ name: "nightforge-agentic-provider" });

const DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
const DEFAULT_MODEL = "qwen3-235b-a22b";

// DashScope token-plan night rates (cheap inference).
const COST_PER_MILLION_INPUT = 0.005;
const COST_PER_MILLION_OUTPUT = 0.025;

export interface AgenticProviderConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
}

interface AgenticMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
}

interface AgenticToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * OpenAI-compatible function-calling provider for the agentic worker.
 * Works against DashScope (Qwen/DeepSeek) and OpenRouter endpoints — the
 * same endpoints nightforge already uses, so no extra credentials needed.
 */
export function createAgenticProvider(config: AgenticProviderConfig): AgenticModelProvider {
  const model = config.model ?? DEFAULT_MODEL;
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;

  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: baseUrl,
  });

  return {
    async generateWithTools(
      messages: AgenticMessage[],
      tools: ToolDefinition[]
    ): Promise<{
      content: string | null;
      toolCalls: AgenticToolCall[];
      tokensUsed: number;
      costUsd: number;
      finishReason: "stop" | "tool_calls" | "length";
    }> {
      const startTime = Date.now();

      const openAiMessages = messages.map((m) => {
        if (m.role === "tool") {
          return { role: "tool" as const, content: m.content, tool_call_id: m.toolCallId ?? "" };
        }
        if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
          return {
            role: "assistant" as const,
            content: m.content,
            tool_calls: m.toolCalls.map((tc) => ({
              id: tc.id,
              type: "function" as const,
              function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
            })),
          };
        }
        return { role: m.role, content: m.content };
      });

      const openAiTools = tools.map((t) => ({
        type: "function" as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters as unknown as Record<string, unknown>,
        },
      }));

      const response = await withRetry(
        () =>
          client.chat.completions.create({
            model,
            messages: openAiMessages,
            tools: openAiTools,
            tool_choice: "auto",
            max_tokens: 8192,
            temperature: 0.2,
            stream: false,
          }),
        { maxAttempts: 4, baseDelayMs: 1000 }
      );

      const durationMs = Date.now() - startTime;
      const choice = response.choices[0];
      const content = choice.message.content ?? "";
      const rawToolCalls = choice.message.tool_calls ?? [];

      const toolCalls: AgenticToolCall[] = rawToolCalls.map((tc) => {
        let argumentsParsed: Record<string, unknown> = {};
        try {
          argumentsParsed = JSON.parse(tc.function.arguments) as Record<string, unknown>;
        } catch {
          argumentsParsed = { raw: tc.function.arguments };
        }
        return { id: tc.id, name: tc.function.name, arguments: argumentsParsed };
      });

      const inputTokens = response.usage?.prompt_tokens ?? 0;
      const outputTokens = response.usage?.completion_tokens ?? 0;
      const tokensUsed = inputTokens + outputTokens;
      const costUsd = calculateCost(
        inputTokens,
        outputTokens,
        COST_PER_MILLION_INPUT,
        COST_PER_MILLION_OUTPUT
      );

      const finishReason = choice.finish_reason as string;
      const mappedFinishReason =
        finishReason === "tool_calls"
          ? ("tool_calls" as const)
          : finishReason === "length"
            ? ("length" as const)
            : ("stop" as const);

      logger.info(
        { model, tokensUsed, toolCalls: toolCalls.length, finishReason: mappedFinishReason, durationMs },
        "Agentic provider response received"
      );

      return {
        content,
        toolCalls,
        tokensUsed,
        costUsd,
        finishReason: mappedFinishReason,
      };
    },
  };
}