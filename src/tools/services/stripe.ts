import pino from "pino";
import type { Tool, ToolResult } from "../types.js";

const logger = pino({ name: "nightforge-tool-stripe" });

export interface StripeToolConfig {
  apiKey: string;
  baseUrl?: string;
}

const DEFAULT_BASE_URL = "https://api.stripe.com";

/**
 * Generic Stripe API tool. The LLM knows Stripe's API from training —
 * this just provides authenticated access to any endpoint.
 */
export function createStripeTool(config: StripeToolConfig): Tool {
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;

  return {
    definition: {
      name: "stripe_api",
      description:
        "Call any Stripe API endpoint. You know the Stripe API from training. " +
        "Use standard REST paths like /v1/customers, /v1/products, /v1/prices, /v1/invoices. " +
        "POST to create, GET to read, DELETE to remove. " +
        "Request bodies use standard Stripe parameter names.",
      parameters: {
        type: "object",
        properties: {
          method: {
            type: "string",
            description: "HTTP method",
            enum: ["GET", "POST", "DELETE"],
          },
          path: {
            type: "string",
            description: "API path e.g. /v1/customers or /v1/products/prod_123",
          },
          body: {
            type: "object",
            description: "Request body parameters (for POST). Use Stripe's parameter names.",
          },
        },
        required: ["method", "path"],
      },
      permission: "auto",
      service: "stripe",
    },

    async execute(args: Record<string, unknown>): Promise<ToolResult> {
      const start = Date.now();
      const method = args["method"] as string;
      const path = args["path"] as string;
      const body = args["body"] as Record<string, unknown> | undefined;

      try {
        const url = `${baseUrl}${path}`;
        const headers: Record<string, string> = {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
        };

        const fetchOptions: RequestInit = { method, headers };

        if (method === "POST" && body) {
          // Stripe uses form-encoded bodies, not JSON
          fetchOptions.body = flattenToFormEncoded(body);
        }

        const response = await fetch(url, fetchOptions);
        const data: unknown = await response.json();

        if (!response.ok) {
          const errorData = data as { error?: { message?: string } };
          logger.warn({ path, status: response.status }, "Stripe API error");
          return {
            success: false,
            data,
            error: errorData.error?.message ?? `Stripe API returned ${String(response.status)}`,
            durationMs: Date.now() - start,
          };
        }

        return { success: true, data, durationMs: Date.now() - start };
      } catch (err) {
        const error = err as Error;
        logger.error({ path, error: error.message }, "Stripe request failed");
        return {
          success: false,
          data: null,
          error: `Stripe request failed: ${error.message}`,
          durationMs: Date.now() - start,
        };
      }
    },
  };
}

/** Flatten nested objects to Stripe's form-encoded format (e.g. metadata[key]=value) */
function flattenToFormEncoded(
  obj: Record<string, unknown>,
  prefix = ""
): string {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}[${key}]` : key;

    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      const nested = flattenToFormEncoded(value as Record<string, unknown>, fullKey);
      for (const [nk, nv] of new URLSearchParams(nested)) {
        params.set(nk, nv);
      }
    } else if (Array.isArray(value)) {
      value.forEach((item, i) => {
        params.set(`${fullKey}[${String(i)}]`, String(item));
      });
    } else {
      params.set(fullKey, String(value));
    }
  }

  return params.toString();
}
