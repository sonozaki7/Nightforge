/**
 * ACP Adapter Registry — configurations for supported ACP agent adapters.
 * Each adapter wraps an official CLI tool (Claude Code, Codex) and exposes
 * it over the Agent Client Protocol.
 *
 * Users with existing subscriptions (Claude Pro/Max, ChatGPT Plus/Pro) can
 * use those subscriptions through ACP without buying separate API credits.
 */
import type { AcpAdapterConfig, AcpAdapterId } from "./types.js";

/**
 * Claude ACP adapter — wraps the official Claude Agent SDK.
 * Uses the same Claude subscription as the `claude` CLI.
 *
 * Requirements:
 * - Node.js and npm
 * - Active Claude Code subscription (Pro $20/mo, Max $100-200/mo)
 * - Authenticated `claude` CLI (`claude` command works in terminal)
 *
 * Install: npm install -g @agentclientprotocol/claude-agent-acp
 */
const CLAUDE_ADAPTER: AcpAdapterConfig = {
  id: "claude",
  command: "claude-agent-acp",
  args: [],
  requiredEnv: [], // Uses claude CLI auth (OAuth token stored locally)
  displayName: "Claude Code (subscription)",
  permissionMode: "smart-approve",
};

/**
 * Codex ACP adapter — wraps the official Codex CLI.
 * Uses the same ChatGPT subscription as the `codex` CLI.
 *
 * Requirements:
 * - Node.js and npm
 * - Active ChatGPT Plus/Pro subscription or OpenAI API credits
 * - Authenticated `codex` CLI (`codex` command works in terminal)
 *
 * Install: npm install -g @agentclientprotocol/codex-acp
 */
const CODEX_ADAPTER: AcpAdapterConfig = {
  id: "codex",
  command: "codex-acp",
  args: [],
  requiredEnv: [], // Uses codex CLI auth (ChatGPT OAuth or OPENAI_API_KEY)
  displayName: "Codex (ChatGPT subscription)",
  permissionMode: "auto",
};

/** All registered ACP adapters */
const ADAPTERS: Record<AcpAdapterId, AcpAdapterConfig> = {
  claude: CLAUDE_ADAPTER,
  codex: CODEX_ADAPTER,
};

export function getAdapter(id: AcpAdapterId): AcpAdapterConfig {
  return ADAPTERS[id];
}

export function listAdapters(): AcpAdapterConfig[] {
  return Object.values(ADAPTERS);
}

/**
 * Resolve which ACP adapter to use based on ticket labels.
 * Labels: "acp:claude" → Claude adapter, "acp:codex" → Codex adapter.
 * Returns null if no ACP label is present (ticket uses normal routing).
 */
export function resolveAcpAdapter(labels: string[]): AcpAdapterId | null {
  const lower = labels.map((l) => l.toLowerCase());

  if (lower.includes("acp:claude") || lower.includes("acp-claude")) return "claude";
  if (lower.includes("acp:codex") || lower.includes("acp-codex")) return "codex";

  // Generic "acp" label uses the configured default
  if (lower.includes("acp")) return "claude"; // Claude is the default ACP adapter

  return null;
}

/**
 * Check if the required CLI binary is available on the system.
 * Returns a diagnostic message if not found.
 */
export function getInstallInstructions(adapterId: AcpAdapterId): string {
  switch (adapterId) {
    case "claude":
      return [
        "Claude ACP adapter not found. Install with:",
        "  npm install -g @agentclientprotocol/claude-agent-acp",
        "",
        "Then ensure the Claude CLI is authenticated:",
        "  claude  (follow auth prompts)",
        "",
        "Requires: Active Claude Pro/Max subscription ($20-200/mo)",
      ].join("\n");
    case "codex":
      return [
        "Codex ACP adapter not found. Install with:",
        "  npm install -g @agentclientprotocol/codex-acp",
        "",
        "Then ensure the Codex CLI is authenticated:",
        "  codex  (follow auth prompts)",
        "",
        "Requires: Active ChatGPT Plus/Pro subscription or OPENAI_API_KEY",
      ].join("\n");
  }
}
