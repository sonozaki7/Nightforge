import { describe, it, expect, vi } from "vitest";
import { createToolRegistry } from "../src/tools/registry.js";
import { createToolExecutor } from "../src/tools/executor.js";
import { resolveTicketMode } from "../src/tools/types.js";
import type { Tool, ToolResult, ApprovalHandler } from "../src/tools/types.js";
import { executeAgenticWorker } from "../src/workers/agentic-worker.js";
import type { AgenticModelProvider } from "../src/workers/agentic-worker.js";
import type { TicketJob } from "../src/queue/scheduler.js";

function createMockTool(name: string, service: string, result?: Partial<ToolResult>): Tool {
  return {
    definition: {
      name,
      description: `Mock tool: ${name}`,
      parameters: {
        type: "object",
        properties: {
          method: { type: "string", description: "HTTP method" },
          path: { type: "string", description: "API path" },
        },
        required: ["method", "path"],
      },
      permission: "auto",
      service,
    },
    execute: vi.fn().mockResolvedValue({
      success: true,
      data: { mock: true },
      durationMs: 10,
      ...result,
    }),
  };
}

describe("ToolRegistry", () => {
  it("registers and retrieves tools", () => {
    const registry = createToolRegistry();
    const tool = createMockTool("stripe_api", "stripe");
    registry.register(tool);

    expect(registry.get("stripe_api")).toBe(tool);
    expect(registry.getAll()).toHaveLength(1);
    expect(registry.getDefinitions()).toHaveLength(1);
  });

  it("returns undefined for unknown tools", () => {
    const registry = createToolRegistry();
    expect(registry.get("nonexistent")).toBeUndefined();
  });

  it("resolves auto permission for GET requests", () => {
    const registry = createToolRegistry();
    registry.register(createMockTool("stripe_api", "stripe"));

    const tier = registry.resolvePermission("stripe_api", { method: "GET", path: "/v1/customers" });
    expect(tier).toBe("auto");
  });

  it("resolves approve permission for Stripe charges", () => {
    const registry = createToolRegistry();
    registry.register(createMockTool("stripe_api", "stripe"));

    const tier = registry.resolvePermission("stripe_api", { method: "POST", path: "/v1/charges" });
    expect(tier).toBe("approve");
  });

  it("resolves forbidden permission for Stripe transfers", () => {
    const registry = createToolRegistry();
    registry.register(createMockTool("stripe_api", "stripe"));

    const tier = registry.resolvePermission("stripe_api", { method: "POST", path: "/v1/transfers" });
    expect(tier).toBe("forbidden");
  });

  it("resolves approve for Cloudflare POST", () => {
    const registry = createToolRegistry();
    registry.register(createMockTool("cloudflare_api", "cloudflare"));

    const tier = registry.resolvePermission("cloudflare_api", { method: "POST", path: "/zones" });
    expect(tier).toBe("approve");
  });

  it("resolves auto for crawl tools", () => {
    const registry = createToolRegistry();
    registry.register(createMockTool("crawl_page", "crawl"));

    const tier = registry.resolvePermission("crawl_page", { method: "GET", path: "*" });
    expect(tier).toBe("auto");
  });

  it("returns forbidden for unregistered tools", () => {
    const registry = createToolRegistry();
    const tier = registry.resolvePermission("unknown_tool", {});
    expect(tier).toBe("forbidden");
  });
});

describe("ToolExecutor", () => {
  const ticketId = "TEST-123";

  it("executes auto-approved tools directly", async () => {
    const registry = createToolRegistry();
    const tool = createMockTool("crawl_page", "crawl");
    registry.register(tool);

    const approvalHandler: ApprovalHandler = vi.fn();
    const executor = createToolExecutor(registry, { ticketId, approvalHandler });

    const result = await executor.execute({
      id: "call-1",
      name: "crawl_page",
      arguments: { method: "GET", path: "https://example.com" },
    });

    expect(result.success).toBe(true);
    expect(approvalHandler).not.toHaveBeenCalled();
  });

  it("requests approval for approve-tier tools", async () => {
    const registry = createToolRegistry();
    const tool = createMockTool("stripe_api", "stripe");
    registry.register(tool);

    const approvalHandler: ApprovalHandler = vi.fn().mockResolvedValue("approved");
    const executor = createToolExecutor(registry, { ticketId, approvalHandler });

    const result = await executor.execute({
      id: "call-2",
      name: "stripe_api",
      arguments: { method: "POST", path: "/v1/charges" },
    });

    expect(result.success).toBe(true);
    expect(approvalHandler).toHaveBeenCalledTimes(1);
  });

  it("blocks execution when approval is denied", async () => {
    const registry = createToolRegistry();
    const tool = createMockTool("stripe_api", "stripe");
    registry.register(tool);

    const approvalHandler: ApprovalHandler = vi.fn().mockResolvedValue("denied");
    const executor = createToolExecutor(registry, { ticketId, approvalHandler });

    const result = await executor.execute({
      id: "call-3",
      name: "stripe_api",
      arguments: { method: "POST", path: "/v1/charges" },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("denied");
  });

  it("blocks forbidden tools without calling approval", async () => {
    const registry = createToolRegistry();
    const tool = createMockTool("stripe_api", "stripe");
    registry.register(tool);

    const approvalHandler: ApprovalHandler = vi.fn();
    const executor = createToolExecutor(registry, { ticketId, approvalHandler });

    const result = await executor.execute({
      id: "call-4",
      name: "stripe_api",
      arguments: { method: "POST", path: "/v1/transfers" },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("forbidden");
    expect(approvalHandler).not.toHaveBeenCalled();
  });

  it("returns error for unknown tools", async () => {
    const registry = createToolRegistry();
    const approvalHandler: ApprovalHandler = vi.fn();
    const executor = createToolExecutor(registry, { ticketId, approvalHandler });

    const result = await executor.execute({
      id: "call-5",
      name: "nonexistent_tool",
      arguments: {},
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Unknown tool");
  });
});

describe("resolveTicketMode", () => {
  it("returns ticket for standard labels", () => {
    expect(resolveTicketMode(["bug", "frontend"])).toBe("ticket");
  });

  it("returns automation for ops labels", () => {
    expect(resolveTicketMode(["automation"])).toBe("automation");
    expect(resolveTicketMode(["ops"])).toBe("automation");
    expect(resolveTicketMode(["routine"])).toBe("automation");
  });

  it("is case insensitive", () => {
    expect(resolveTicketMode(["AUTOMATION"])).toBe("automation");
    expect(resolveTicketMode(["Ops"])).toBe("automation");
  });
});

describe("AgenticWorker", () => {
  const mockJob: TicketJob = {
    ticketId: "TEST-456",
    projectId: "proj-1",
    title: "Test automation task",
    description: "Do something with tools",
    labels: ["automation"],
    priority: 5,
    attempt: 1,
  };

  it("completes when model returns stop without tool calls", async () => {
    const registry = createToolRegistry();
    registry.register(createMockTool("crawl_page", "crawl"));

    const mockProvider: AgenticModelProvider = {
      generateWithTools: vi.fn().mockResolvedValue({
        content: "Task completed successfully.",
        toolCalls: [],
        tokensUsed: 100,
        costUsd: 0.001,
        finishReason: "stop",
      }),
    };

    const result = await executeAgenticWorker(mockJob, mockProvider, registry);

    expect(result.success).toBe(true);
    expect(result.summary).toBe("Task completed successfully.");
    expect(result.iterations).toBe(1);
    expect(result.toolCallsMade).toBe(0);
  });

  it("executes tool calls in a loop until stop", async () => {
    const registry = createToolRegistry();
    registry.register(createMockTool("crawl_page", "crawl"));

    let callCount = 0;
    const mockProvider: AgenticModelProvider = {
      generateWithTools: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return {
            content: null,
            toolCalls: [{ id: "tc-1", name: "crawl_page", arguments: { method: "GET", path: "*" } }],
            tokensUsed: 50,
            costUsd: 0.0005,
            finishReason: "tool_calls",
          };
        }
        return {
          content: "Done after tool call.",
          toolCalls: [],
          tokensUsed: 60,
          costUsd: 0.0006,
          finishReason: "stop",
        };
      }),
    };

    const result = await executeAgenticWorker(mockJob, mockProvider, registry);

    expect(result.success).toBe(true);
    expect(result.iterations).toBe(2);
    expect(result.toolCallsMade).toBe(1);
    expect(result.tokensUsed).toBe(110);
  });

  it("stops at max iterations", async () => {
    const registry = createToolRegistry();
    registry.register(createMockTool("crawl_page", "crawl"));

    const mockProvider: AgenticModelProvider = {
      generateWithTools: vi.fn().mockResolvedValue({
        content: null,
        toolCalls: [{ id: "tc-x", name: "crawl_page", arguments: { method: "GET", path: "*" } }],
        tokensUsed: 10,
        costUsd: 0.0001,
        finishReason: "tool_calls",
      }),
    };

    const result = await executeAgenticWorker(mockJob, mockProvider, registry, {
      maxIterations: 3,
    });

    expect(result.success).toBe(false);
    expect(result.iterations).toBe(3);
    expect(result.summary).toContain("maximum iterations");
  });
});
