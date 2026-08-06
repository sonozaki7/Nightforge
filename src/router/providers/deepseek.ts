import OpenAI from "openai";
import pino from "pino";
import {
  type Provider,
  type GenerateOptions,
  type GenerateResult,
  type ProviderConfig,
  calculateCost,
} from "./base.js";
import { withRetry } from "./retry.js";

const logger = pino({ name: "nightforge-deepseek" });

const DEFAULT_MODEL = "deepseek/deepseek-v3.2";
const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";

// OpenRouter pricing for DeepSeek V3.2 (permissive, best code quality per $)
const COST_PER_MILLION_INPUT = 0.27;
const COST_PER_MILLION_OUTPUT = 0.4;

/**
 * Build system message from structured blocks (cache-friendly ordering).
 * OpenRouter auto-caches long prefixes for supported models.
 */
function buildSystemMessage(options?: GenerateOptions): string | undefined {
  if (options?.systemPromptBlocks && options.systemPromptBlocks.length > 0) {
    return options.systemPromptBlocks.map((b) => b.text).join("\n\n");
  }
  return options?.systemPrompt;
}

export function createDeepSeekProvider(config: ProviderConfig): Provider {
  const model = config.model ?? DEFAULT_MODEL;
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;

  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: baseUrl,
  });

  return {
    name: "deepseek",
    modelName: model,

    async generate(
      prompt: string,
      options?: GenerateOptions
    ): Promise<GenerateResult> {
      const startTime = Date.now();

      logger.info({ model }, "Calling DeepSeek API");

      const systemMessage = buildSystemMessage(options);
      const messages: Array<{ role: "system" | "user"; content: string }> = [];

      if (systemMessage) {
        messages.push({ role: "system", content: systemMessage });
      }

      messages.push({ role: "user", content: prompt });

      const response = await withRetry(
        () =>
          client.chat.completions.create({
            model,
            messages,
            max_tokens: options?.maxTokens ?? 8192,
            temperature: options?.temperature ?? 0.3,
          }),
        { maxAttempts: 4, baseDelayMs: 1000 }
      );

      const durationMs = Date.now() - startTime;
      const content = response.choices[0]?.message.content ?? "";
      const inputTokens = response.usage?.prompt_tokens ?? 0;
      const outputTokens = response.usage?.completion_tokens ?? 0;
      const cachedInputTokens =
        (response.usage as { prompt_tokens_details?: { cached_tokens?: number } })
          .prompt_tokens_details?.cached_tokens ?? 0;
      const tokensUsed = inputTokens + outputTokens;

      const costUsd = calculateCost(
        inputTokens,
        outputTokens,
        COST_PER_MILLION_INPUT,
        COST_PER_MILLION_OUTPUT
      );

      logger.info(
        { model, tokensUsed, cachedInputTokens, costUsd, durationMs },
        "DeepSeek API response received"
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
