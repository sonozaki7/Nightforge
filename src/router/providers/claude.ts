import pino from "pino";
import {
  type Provider,
  type GenerateOptions,
  type GenerateResult,
  type ProviderConfig,
  type SystemPromptBlock,
} from "./base.js";
import { withRetry } from "./retry.js";

const logger = pino({ name: "nightforge-claude" });

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-opus-5";
const ANTHROPIC_VERSION = "2023-06-01";

// Claude Opus 5 pricing
const COST_PER_MILLION_INPUT = 5.0;
const COST_PER_MILLION_OUTPUT = 25.0;
// Cached input tokens are 90% cheaper
const COST_PER_MILLION_CACHED_INPUT = 0.5;

interface AnthropicResponse {
  content: Array<{ type: string; text: string }>;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  model: string;
}

interface AnthropicSystemBlock {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
}

function buildSystemBlocks(options?: GenerateOptions): AnthropicSystemBlock[] {
  // Prefer structured blocks (cache-optimized)
  if (options?.systemPromptBlocks && options.systemPromptBlocks.length > 0) {
    return options.systemPromptBlocks.map(
      (block: SystemPromptBlock): AnthropicSystemBlock => ({
        type: "text",
        text: block.text,
        ...(block.cacheable ? { cache_control: { type: "ephemeral" as const } } : {}),
      })
    );
  }

  // Fallback: flat system prompt
  if (options?.systemPrompt) {
    return [{ type: "text", text: options.systemPrompt }];
  }

  return [];
}

export function createClaudeProvider(config: ProviderConfig): Provider {
  const model = config.model ?? DEFAULT_MODEL;

  return {
    name: "claude",
    modelName: model,

    async generate(
      prompt: string,
      options?: GenerateOptions
    ): Promise<GenerateResult> {
      const startTime = Date.now();

      logger.info({ model }, "Calling Claude API");

      const systemBlocks = buildSystemBlocks(options);

      const body: Record<string, unknown> = {
        model,
        max_tokens: options?.maxTokens ?? 8192,
        messages: [{ role: "user", content: prompt }],
      };

      if (systemBlocks.length > 0) {
        body.system = systemBlocks;
      }

      if (options?.temperature !== undefined) {
        body.temperature = options.temperature;
      }

      const response = await withRetry(
        () =>
          fetch(ANTHROPIC_API_URL, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": config.apiKey,
              "anthropic-version": ANTHROPIC_VERSION,
            },
            body: JSON.stringify(body),
          }),
        { maxAttempts: 4, baseDelayMs: 1000 }
      );

      if (!response.ok) {
        const errorText = await response.text();
        const error = new Error(
          `Claude API error ${String(response.status)}: ${errorText}`
        ) as Error & { status?: number };
        error.status = response.status;
        throw error;
      }

      const data = (await response.json()) as AnthropicResponse;
      const durationMs = Date.now() - startTime;

      const content = data.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("");

      const inputTokens = data.usage.input_tokens;
      const outputTokens = data.usage.output_tokens;
      const cachedInputTokens = data.usage.cache_read_input_tokens ?? 0;
      const cacheWriteTokens = data.usage.cache_creation_input_tokens ?? 0;
      const tokensUsed = inputTokens + outputTokens;

      // Cost calculation accounts for cached tokens at reduced rate
      const freshInputTokens = inputTokens - cachedInputTokens - cacheWriteTokens;
      const inputCost =
        (freshInputTokens / 1_000_000) * COST_PER_MILLION_INPUT +
        (cachedInputTokens / 1_000_000) * COST_PER_MILLION_CACHED_INPUT +
        (cacheWriteTokens / 1_000_000) * COST_PER_MILLION_INPUT * 1.25;
      const outputCost = (outputTokens / 1_000_000) * COST_PER_MILLION_OUTPUT;
      const costUsd = inputCost + outputCost;

      logger.info(
        { model, tokensUsed, cachedInputTokens, costUsd, durationMs },
        "Claude API response received"
      );

      return {
        content,
        tokensUsed,
        inputTokens,
        outputTokens,
        cachedInputTokens,
        costUsd,
        model,
        durationMs,
      };
    },

    getCostPerMillionInput(): number {
      return COST_PER_MILLION_INPUT;
    },

    getCostPerMillionOutput(): number {
      return COST_PER_MILLION_OUTPUT;
    },
  };
}
