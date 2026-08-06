import pino from "pino";
import type { ToolRegistry } from "./registry.js";
import { createToolRegistry } from "./registry.js";
import type { Sandbox } from "../sandbox/types.js";
import { createBashTool } from "./services/bash.js";
import { createEditTool, createReadTool } from "./services/edit.js";
import { createStripeTool } from "./services/stripe.js";
import { createCloudflareTool } from "./services/cloudflare.js";
import { createGoogleTool } from "./services/google.js";
import { createBrowserTool } from "./services/browser.js";
import { createSearchTool } from "./services/crawler.js";

const logger = pino({ name: "nightforge-tool-assembly" });

export interface ToolAssemblyConfig {
  sandbox: Sandbox;
  worktreePath: string;
  readOnlyPaths?: string[];
  stripeApiKey?: string;
  cloudflareApiToken?: string;
  cloudflareAccountId?: string;
  googleAccessToken?: string;
  browserWsEndpoint?: string;
  crawl4aiUrl?: string;
  searxngUrl?: string;
}

/**
 * Build the complete tool registry for the agentic worker. The sandboxed
 * bash tool is always registered; external-service tools are registered only
 * when their credentials are present (never hardcoded, never empty).
 */
export function buildToolRegistry(
  config: ToolAssemblyConfig
): ToolRegistry {
  const registry = createToolRegistry();

  registry.register(
    createBashTool({
      sandbox: config.sandbox,
      worktreePath: config.worktreePath,
      readOnlyPaths: config.readOnlyPaths,
    })
  );

  registry.register(createEditTool({ worktreePath: config.worktreePath }));
  registry.register(createReadTool({ worktreePath: config.worktreePath }));

  if (config.stripeApiKey && config.stripeApiKey.length > 0) {
    registry.register(createStripeTool({ apiKey: config.stripeApiKey }));
  }
  if (
    config.cloudflareApiToken &&
    config.cloudflareApiToken.length > 0 &&
    config.cloudflareAccountId &&
    config.cloudflareAccountId.length > 0
  ) {
    registry.register(
      createCloudflareTool({
        apiToken: config.cloudflareApiToken,
        accountId: config.cloudflareAccountId,
      })
    );
  }
  if (config.googleAccessToken && config.googleAccessToken.length > 0) {
    registry.register(
      createGoogleTool({ accessToken: config.googleAccessToken })
    );
  }
  if (config.browserWsEndpoint && config.browserWsEndpoint.length > 0) {
    registry.register(createBrowserTool({ wsEndpoint: config.browserWsEndpoint }));
  }
  if (config.crawl4aiUrl && config.crawl4aiUrl.length > 0) {
    registry.register(
      createSearchTool({
        crawl4aiUrl: config.crawl4aiUrl,
        searxngUrl: config.searxngUrl ?? "http://localhost:8080",
      })
    );
  }

  logger.info(
    { tools: registry.getAll().map((t) => t.definition.name) },
    "Tool registry assembled"
  );
  return registry;
}