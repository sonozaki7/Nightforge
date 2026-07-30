import pino from "pino";
import type {
  Tool,
  ToolDefinition,
  PermissionTier,
  PermissionRule,
} from "./types.js";

const logger = pino({ name: "nightforge-tool-registry" });

export interface ToolRegistry {
  register(tool: Tool): void;
  get(name: string): Tool | undefined;
  getAll(): Tool[];
  getDefinitions(): ToolDefinition[];
  resolvePermission(
    toolName: string,
    args: Record<string, unknown>
  ): PermissionTier;
  setPermissionRules(rules: PermissionRule[]): void;
}

/** Default permission rules — override per project as needed */
const DEFAULT_RULES: PermissionRule[] = [
  // Reads are always safe
  { pattern: "*:GET:*", tier: "auto" },
  // Financial mutations need approval
  { pattern: "stripe:POST:/v1/charges", tier: "approve" },
  { pattern: "stripe:POST:/v1/refunds", tier: "approve" },
  { pattern: "stripe:POST:/v1/transfers", tier: "forbidden" },
  { pattern: "stripe:DELETE:*", tier: "approve" },
  // Deployments need approval
  { pattern: "cloudflare:POST:*", tier: "approve" },
  { pattern: "cloudflare:PUT:*", tier: "approve" },
  { pattern: "cloudflare:DELETE:*", tier: "approve" },
  // Email sending needs approval
  { pattern: "google:send:*", tier: "approve" },
  // Browser actions need approval (unpredictable)
  { pattern: "browser:*:*", tier: "approve" },
  // Crawling/search is safe
  { pattern: "crawl:*:*", tier: "auto" },
  { pattern: "search:*:*", tier: "auto" },
];

function matchPattern(
  pattern: string,
  service: string,
  method: string,
  path: string
): boolean {
  const parts = pattern.split(":");
  const pService = parts[0] ?? "";
  const pMethod = parts[1] ?? "";
  const pPath = parts[2] ?? "";
  const serviceMatch = pService === "*" || pService === service;
  const methodMatch = pMethod === "*" || pMethod === method;
  const pathMatch =
    pPath === "*" || pPath === path || (pPath.endsWith("*") && path.startsWith(pPath.slice(0, -1)));
  return serviceMatch && methodMatch && pathMatch;
}

export function createToolRegistry(): ToolRegistry {
  const tools = new Map<string, Tool>();
  let permissionRules: PermissionRule[] = [...DEFAULT_RULES];

  return {
    register(tool: Tool): void {
      tools.set(tool.definition.name, tool);
      logger.info(
        { tool: tool.definition.name, service: tool.definition.service },
        "Tool registered"
      );
    },

    get(name: string): Tool | undefined {
      return tools.get(name);
    },

    getAll(): Tool[] {
      return Array.from(tools.values());
    },

    getDefinitions(): ToolDefinition[] {
      return Array.from(tools.values()).map((t) => t.definition);
    },

    resolvePermission(
      toolName: string,
      args: Record<string, unknown>
    ): PermissionTier {
      const tool = tools.get(toolName);
      if (!tool) return "forbidden";

      const service = tool.definition.service;
      const method = (args["method"] as string | undefined) ?? "GET";
      const path = (args["path"] as string | undefined) ?? "*";

      // Check rules in order — first match wins
      for (const rule of permissionRules) {
        if (matchPattern(rule.pattern, service, method, path)) {
          return rule.tier;
        }
      }

      // Fall back to tool's own permission level
      return tool.definition.permission;
    },

    setPermissionRules(rules: PermissionRule[]): void {
      permissionRules = rules;
      logger.info({ count: rules.length }, "Permission rules updated");
    },
  };
}
