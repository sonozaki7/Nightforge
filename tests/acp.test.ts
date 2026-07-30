import { describe, it, expect } from "vitest";
import { resolveAcpAdapter, getAdapter, listAdapters, getInstallInstructions } from "../src/acp/adapters.js";
import { shouldUseAcp } from "../src/acp/worker.js";
import { AcpClient } from "../src/acp/client.js";
import type { AcpAdapterConfig } from "../src/acp/types.js";
import { LATEST_PROTOCOL_VERSION } from "../src/acp/types.js";

describe("ACP Adapters", () => {
  describe("resolveAcpAdapter", () => {
    it("resolves claude from acp:claude label", () => {
      expect(resolveAcpAdapter(["acp:claude"])).toBe("claude");
    });

    it("resolves codex from acp:codex label", () => {
      expect(resolveAcpAdapter(["acp:codex"])).toBe("codex");
    });

    it("resolves claude from acp-claude label (hyphen variant)", () => {
      expect(resolveAcpAdapter(["acp-claude"])).toBe("claude");
    });

    it("resolves codex from acp-codex label (hyphen variant)", () => {
      expect(resolveAcpAdapter(["acp-codex"])).toBe("codex");
    });

    it("defaults to claude for generic acp label", () => {
      expect(resolveAcpAdapter(["acp"])).toBe("claude");
    });

    it("is case-insensitive", () => {
      expect(resolveAcpAdapter(["ACP:Claude"])).toBe("claude");
      expect(resolveAcpAdapter(["ACP"])).toBe("claude");
    });

    it("returns null when no acp labels present", () => {
      expect(resolveAcpAdapter(["automation", "xhigh"])).toBeNull();
      expect(resolveAcpAdapter([])).toBeNull();
      expect(resolveAcpAdapter(["bug", "urgent"])).toBeNull();
    });

    it("prioritizes specific adapter over generic acp", () => {
      expect(resolveAcpAdapter(["acp", "acp:codex"])).toBe("codex");
    });
  });

  describe("getAdapter", () => {
    it("returns claude adapter config", () => {
      const adapter = getAdapter("claude");
      expect(adapter.id).toBe("claude");
      expect(adapter.command).toBe("claude-agent-acp");
      expect(adapter.displayName).toContain("Claude");
      expect(adapter.permissionMode).toBe("smart-approve");
    });

    it("returns codex adapter config", () => {
      const adapter = getAdapter("codex");
      expect(adapter.id).toBe("codex");
      expect(adapter.command).toBe("codex-acp");
      expect(adapter.displayName).toContain("Codex");
      expect(adapter.permissionMode).toBe("auto");
    });

    it("returns undefined for unknown adapter (type-guarded at compile time)", () => {
      // TypeScript prevents invalid IDs at compile time; runtime returns undefined
      const result = getAdapter("unknown" as never);
      expect(result).toBeUndefined();
    });
  });

  describe("listAdapters", () => {
    it("returns all registered adapters", () => {
      const adapters = listAdapters();
      expect(adapters).toHaveLength(2);
      expect(adapters.map((a) => a.id)).toContain("claude");
      expect(adapters.map((a) => a.id)).toContain("codex");
    });
  });

  describe("getInstallInstructions", () => {
    it("returns claude install instructions", () => {
      const instructions = getInstallInstructions("claude");
      expect(instructions).toContain("claude-agent-acp");
      expect(instructions).toContain("npm install -g");
      expect(instructions).toContain("subscription");
    });

    it("returns codex install instructions", () => {
      const instructions = getInstallInstructions("codex");
      expect(instructions).toContain("codex-acp");
      expect(instructions).toContain("npm install -g");
      expect(instructions).toContain("ChatGPT");
    });
  });
});

describe("ACP Worker", () => {
  describe("shouldUseAcp", () => {
    it("returns adapter id for acp-labeled tickets", () => {
      expect(shouldUseAcp(["acp:claude"])).toBe("claude");
      expect(shouldUseAcp(["acp:codex"])).toBe("codex");
      expect(shouldUseAcp(["acp"])).toBe("claude");
    });

    it("returns null for non-acp tickets", () => {
      expect(shouldUseAcp(["automation"])).toBeNull();
      expect(shouldUseAcp(["bug", "urgent"])).toBeNull();
      expect(shouldUseAcp([])).toBeNull();
    });
  });
});

describe("AcpClient", () => {
  const mockAdapter: AcpAdapterConfig = {
    id: "claude",
    command: "echo",
    args: [],
    requiredEnv: [],
    displayName: "Mock Adapter",
    permissionMode: "auto",
  };

  it("creates client with correct initial state", () => {
    const client = new AcpClient(mockAdapter, { cwd: "/tmp" });
    expect(client.isAlive).toBe(false);
    expect(client.currentSessionId).toBeNull();
  });

  it("rejects prompt when not connected", async () => {
    const client = new AcpClient(mockAdapter, { cwd: "/tmp" });
    await expect(client.prompt("test")).rejects.toThrow("No active session");
  });

  it("rejects request when not alive", async () => {
    const client = new AcpClient(mockAdapter, { cwd: "/tmp" });
    // Access private method via any cast for testing
    const requestPromise = (client as unknown as { request: (m: string, p: Record<string, unknown>) => Promise<unknown> })
      .request("test", {});
    await expect(requestPromise).rejects.toThrow("not connected");
  });

  it("disconnect handles null process gracefully", async () => {
    const client = new AcpClient(mockAdapter, { cwd: "/tmp" });
    await expect(client.disconnect()).resolves.toBeUndefined();
  });

  it("cancel does nothing without session", () => {
    const client = new AcpClient(mockAdapter, { cwd: "/tmp" });
    // Should not throw
    client.cancel();
    expect(client.currentSessionId).toBeNull();
  });
});

describe("ACP Types", () => {
  it("exports correct protocol version", () => {
    expect(LATEST_PROTOCOL_VERSION).toBe("1.2");
  });
});
