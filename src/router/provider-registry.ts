import pino from "pino";
import type { ModelDescriptor } from "./model-tiers.js";
import type { Provider } from "./providers/base.js";
import { createQwenProvider } from "./providers/qwen.js";
import { createClaudeProvider } from "./providers/claude.js";
import { createDeepSeekProvider } from "./providers/deepseek.js";
import { createOpenRouterProvider } from "./providers/openrouter.js";
import type { ModelProvider } from "../workers/worker.js";

const logger = pino({ name: "nightforge-provider-registry" });

/**
 * Resolves routed model descriptors (Guide §13 roster) into executable
 * providers. Keys come from configuration only — a family without a key
 * resolves to null so the caller can fall back, never to a hardcoded secret.
 */

export interface RegistryKeys {
  dashscopeApiKey: string;
  anthropicApiKey: string;
  openrouterApiKey: string;
  dashscopeBaseUrl?: string;
  openrouterBaseUrl?: string;
}

export interface ModelProviderRegistry {
  /** Null when the descriptor's family has no configured key. */
  resolve(descriptor: ModelDescriptor): ModelProvider | null;
  /** Families that currently have a usable key. */
  availableFamilies(): string[];
}

type Backend = "dashscope" | "anthropic" | "openrouter";

/**
 * Every roster family reaches a backend. The DashScope token plan serves
 * DeepSeek directly, so deepseek uses the dashscope key; remaining foreign
 * families go via OpenRouter.
 */
const FAMILY_BACKEND: Record<string, Backend | undefined> = {
  qwen: "dashscope",
  anthropic: "anthropic",
  openai: "openrouter",
  deepseek: "dashscope",
  glm: "openrouter",
  moonshot: "openrouter",
};

/**
 * Real endpoint names where the roster id is not accepted verbatim.
 * Roster ids outside this map pass through unchanged. The token-plan
 * endpoint accepts most roster ids as-is (verified against /models) but
 * pins the DeepSeek flash variant to its dated snapshot.
 */
const ENDPOINT_MODEL: Record<string, string> = {
  "deepseek-v4-flash": "deepseek-v4-flash-0731",
};

function adapt(provider: Provider): ModelProvider {
  return {
    // Pass the full GenerateResult through — the worker propagates model,
    // token split, and cost into telemetry and the Linear result comment.
    generate: async (prompt, options) => provider.generate(prompt, options),
  };
}

export function createModelProviderRegistry(
  keys: RegistryKeys
): ModelProviderRegistry {
  function keyFor(backend: Backend): string {
    if (backend === "dashscope") return keys.dashscopeApiKey;
    if (backend === "anthropic") return keys.anthropicApiKey;
    return keys.openrouterApiKey;
  }

  function buildProvider(descriptor: ModelDescriptor, apiKey: string): Provider {
    const backend = FAMILY_BACKEND[descriptor.family] ?? "openrouter";
    const model = ENDPOINT_MODEL[descriptor.id] ?? descriptor.id;
    if (backend === "dashscope") {
      if (descriptor.family === "deepseek") {
        return createDeepSeekProvider({
          apiKey,
          baseUrl: keys.dashscopeBaseUrl,
          model,
        });
      }
      return createQwenProvider({ apiKey, baseUrl: keys.dashscopeBaseUrl, model });
    }
    if (backend === "anthropic") {
      return createClaudeProvider({ apiKey, model });
    }
    return createOpenRouterProvider({
      apiKey,
      baseUrl: keys.openrouterBaseUrl,
      model,
    });
  }

  return {
    resolve(descriptor): ModelProvider | null {
      const backend = FAMILY_BACKEND[descriptor.family];
      if (backend === undefined) {
        logger.warn(
          { model: descriptor.id, family: descriptor.family },
          "No backend mapping for model family"
        );
        return null;
      }
      const apiKey = keyFor(backend);
      if (apiKey.length === 0) {
        logger.warn(
          { model: descriptor.id, backend },
          "No API key configured for backend"
        );
        return null;
      }
      return adapt(buildProvider(descriptor, apiKey));
    },

    availableFamilies(): string[] {
      return Object.entries(FAMILY_BACKEND)
        .filter(([, backend]) => backend !== undefined && keyFor(backend).length > 0)
        .map(([family]) => family);
    },
  };
}
