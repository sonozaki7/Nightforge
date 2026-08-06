import pino from "pino";
import type { ModelProvider } from "../workers/worker.js";

const logger = pino({ name: "nightforge-mock-provider" });

/**
 * Placeholder provider used when a routed model's family has no configured
 * API key. Logs the call instead of spending tokens; replaced per family
 * as keys arrive.
 */
export function createMockModelProvider(): ModelProvider {
  return {
    generate(
      prompt: string
    ): Promise<{ content: string; tokensUsed: number; costUsd: number }> {
      logger.info({ promptLength: prompt.length }, "Mock model called");
      return Promise.resolve({
        content: "// Mock implementation",
        tokensUsed: 100,
        costUsd: 0.01,
      });
    },
  };
}
