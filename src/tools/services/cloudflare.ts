import pino from "pino";
import type { Tool, ToolResult } from "../types.js";

const logger = pino({ name: "nightforge-tool-cloudflare" });

export interface CloudflareToolConfig {
  apiToken: string;
  accountId?: string;
  baseUrl?: string;
}

const DEFAULT_BASE_URL = "https://api.cloudflare.com/client/v4";

/**
 * Generic Cloudflare API v4 tool. Provides authenticated access to any
 * Cloudflare endpoint: Workers, DNS, KV, R2, Pages, etc.
 */
export function createCloudflareTool(config: CloudflareToolConfig): Tool {
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;

  return {
    definition: {
      name: "cloudflare_api",
      description:
        "Call any Cloudflare API v4 endpoint. You know the Cloudflare API from training. " +
        "Paths are relative to /client/v4. Examples: /zones, /accounts/{id}/workers/scripts, " +
        "/zones/{zone_id}/dns_records. Use account ID from config when needed.",
      parameters: {
        type: "object",
        properties: {
          method: {
            type: "string",
            description: "HTTP method",
            enum: ["GET", "POST", "PUT", "PATCH", "DELETE"],
          },
          path: {
            type: "string",
            description: "API path relative to /client/v4, e.g. /zones or /accounts/{id}/workers/scripts",
          },
          body: {
            type: "object",
            description: "JSON request body (for POST/PUT/PATCH)",
          },
        },
        required: ["method", "path"],
      },
      permission: "auto",
      service: "cloudflare",
    },

    async execute(args: Record<string, unknown>): Promise<ToolResult> {
      const start = Date.now();
      const method = args["method"] as string;
      let path = args["path"] as string;
      const body = args["body"] as Record<string, unknown> | undefined;

      // Substitute {account_id} placeholder if present
      if (config.accountId && path.includes("{account_id}")) {
        path = path.replace("{account_id}", config.accountId);
      }

      try {
        const url = `${baseUrl}${path}`;
        const headers: Record<string, string> = {
          Authorization: `Bearer ${config.apiToken}`,
          "Content-Type": "application/json",
        };

        const fetchOptions: RequestInit = { method, headers };

        if (body && ["POST", "PUT", "PATCH"].includes(method)) {
          fetchOptions.body = JSON.stringify(body);
        }

        const response = await fetch(url, fetchOptions);
        const data: unknown = await response.json();

        if (!response.ok) {
          const cfError = data as { errors?: Array<{ message?: string }> };
          const msg = cfError.errors?.[0]?.message ?? `Cloudflare API returned ${String(response.status)}`;
          logger.warn({ path, status: response.status }, "Cloudflare API error");
          return { success: false, data, error: msg, durationMs: Date.now() - start };
        }

        return { success: true, data, durationMs: Date.now() - start };
      } catch (err) {
        const error = err as Error;
        logger.error({ path, error: error.message }, "Cloudflare request failed");
        return {
          success: false,
          data: null,
          error: `Cloudflare request failed: ${error.message}`,
          durationMs: Date.now() - start,
        };
      }
    },
  };
}
