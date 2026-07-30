import { describe, it, expect, vi } from "vitest";
import {
  resolveEffortLevel,
  getEffortConfig,
  getEffortTable,
} from "../src/workers/effort-levels.js";
import { executeAgenticWorker } from "../src/workers/agentic-worker.js";
import type { AgenticModelProvider } from "../src/workers/agentic-worker.js";
import { createToolRegistry } from "../src/tools/registry.js";
import type { Tool, ToolResult } from "../src/tools/types.js";
import type { TicketJob } from "../src/queue/scheduler.js";

function createMockTool(name: string, service: string): Tool {
  return {
    definition: {
      name,
      description: `Mock: ${name}`,
      parameters: { type: "object", properties: {}, required: [] },
      permission: "auto",
      service,
    },
    execute: vi.fn().mockResolvedValue({
      success: true,
      data: { ok: true },
      durationMs: 5,
    } satisfies ToolResult),
  };
}

const mockJob: TicketJob = {
  ticketId: "EFF-1",
  projectId: "proj-1",
  title: "Test effort",
  description: "Testing effort levels",
  labels: [],
  priority: 5,
  attempt: 1,
};

describe("EffortLevels - ticket mode", () => {
  const table = getEffortTable("ticket");

  it("defines three effort tiers with increasing iterations", () => {
    expect(table.high.maxIterations).toBe(40);
    expect(table.xhigh.maxIterations).toBe(70);
    expect(table.max.maxIterations).toBe(120);
  });

  it("increases token budget with effort", () => {
    expect(table.high.tokenBudgetUsd).toBe(0.25);
    expect(table.xhigh.tokenBudgetUsd).toBe(0.5);
    expect(table.max.tokenBudgetUsd).toBe(1);
  });

  it("increases verification passes with effort", () => {
    expect(table.high.verificationPasses).toBe(1);
    expect(table.xhigh.verificationPasses).toBe(2);
    expect(table.max.verificationPasses).toBe(3);
  });

  it("allows sub-agents at all levels for parallelism", () => {
    expect(table.high.maxSubAgents).toBe(2);
    expect(table.xhigh.maxSubAgents).toBe(4);
    expect(table.max.maxSubAgents).toBe(8);
  });

  it("includes mode-specific prompt modifiers", () => {
    expect(table.high.promptModifier).toContain("MODE: TICKET");
    expect(table.xhigh.promptModifier).toContain("MODE: TICKET");
    expect(table.max.promptModifier).toContain("MODE: TICKET");
  });
});

describe("EffortLevels - automation mode", () => {
  const table = getEffortTable("automation");

  it("has lower iterations than ticket mode (routine work)", () => {
    expect(table.high.maxIterations).toBe(20);
    expect(table.xhigh.maxIterations).toBe(35);
    expect(table.max.maxIterations).toBe(50);
  });

  it("has lower budgets than ticket mode", () => {
    expect(table.high.tokenBudgetUsd).toBe(0.15);
    expect(table.xhigh.tokenBudgetUsd).toBe(0.3);
    expect(table.max.tokenBudgetUsd).toBe(0.6);
  });

  it("allows sub-agents at xhigh and max for parallel routines", () => {
    expect(table.high.maxSubAgents).toBe(0);
    expect(table.xhigh.maxSubAgents).toBe(2);
    expect(table.max.maxSubAgents).toBe(3);
  });

  it("includes mode-specific prompt modifiers", () => {
    expect(table.high.promptModifier).toContain("MODE: AUTOMATION");
    expect(table.xhigh.promptModifier).toContain("MODE: AUTOMATION");
    expect(table.max.promptModifier).toContain("MODE: AUTOMATION");
  });
});

describe("resolveEffortLevel", () => {
  it("defaults to high for standard labels", () => {
    expect(resolveEffortLevel(["bug", "frontend"])).toBe("high");
    expect(resolveEffortLevel([])).toBe("high");
  });

  it("resolves xhigh from labels", () => {
    expect(resolveEffortLevel(["xhigh"])).toBe("xhigh");
    expect(resolveEffortLevel(["extra-high"])).toBe("xhigh");
  });

  it("resolves max from labels", () => {
    expect(resolveEffortLevel(["max"])).toBe("max");
    expect(resolveEffortLevel(["max-effort"])).toBe("max");
  });

  it("is case insensitive", () => {
    expect(resolveEffortLevel(["XHIGH"])).toBe("xhigh");
    expect(resolveEffortLevel(["MAX"])).toBe("max");
  });

  it("max takes priority over xhigh", () => {
    expect(resolveEffortLevel(["xhigh", "max"])).toBe("max");
  });
});

describe("getEffortConfig", () => {
  it("returns mode-aware configs", () => {
    expect(getEffortConfig("ticket", "high").mode).toBe("ticket");
    expect(getEffortConfig("automation", "high").mode).toBe("automation");
    expect(getEffortConfig("ticket", "max").level).toBe("max");
    expect(getEffortConfig("automation", "max").level).toBe("max");
  });

  it("ticket mode has more iterations than automation for same effort", () => {
    expect(getEffortConfig("ticket", "high").maxIterations).toBeGreaterThan(
      getEffortConfig("automation", "high").maxIterations
    );
  });
});

describe("AgenticWorker with effort levels", () => {
  it("uses effort level from ticket labels", async () => {
    const registry = createToolRegistry();
    registry.register(createMockTool("test_tool", "test"));

    const provider: AgenticModelProvider = {
      generateWithTools: vi.fn().mockResolvedValue({
        content: "Done",
        toolCalls: [],
        tokensUsed: 50,
        costUsd: 0.001,
        finishReason: "stop",
      }),
    };

    const job = { ...mockJob, labels: ["xhigh"] };
    const result = await executeAgenticWorker(job, provider, registry);

    expect(result.effortLevel).toBe("xhigh");
    expect(result.success).toBe(true);
  });

  it("respects explicit effort config over labels", async () => {
    const registry = createToolRegistry();
    registry.register(createMockTool("test_tool", "test"));

    const provider: AgenticModelProvider = {
      generateWithTools: vi.fn().mockResolvedValue({
        content: "Done",
        toolCalls: [],
        tokensUsed: 50,
        costUsd: 0.001,
        finishReason: "stop",
      }),
    };

    const job = { ...mockJob, labels: ["xhigh"] };
    const result = await executeAgenticWorker(job, provider, registry, {
      effortLevel: "max",
    });

    expect(result.effortLevel).toBe("max");
  });

  it("stops when token budget is exceeded", async () => {
    const registry = createToolRegistry();
    registry.register(createMockTool("test_tool", "test"));

    const provider: AgenticModelProvider = {
      generateWithTools: vi.fn().mockResolvedValue({
        content: null,
        toolCalls: [{ id: "tc-1", name: "test_tool", arguments: {} }],
        tokensUsed: 1000,
        costUsd: 1.5,
        finishReason: "tool_calls",
      }),
    };

    const result = await executeAgenticWorker(mockJob, provider, registry, {
      effortLevel: "high",
      tokenBudgetUsd: 1,
    });

    expect(result.success).toBe(false);
    expect(result.budgetExceeded).toBe(true);
    expect(result.summary).toContain("budget exceeded");
  });

  it("injects effort-specific prompt modifier into system prompt", async () => {
    const registry = createToolRegistry();
    registry.register(createMockTool("test_tool", "test"));

    const generateMock = vi.fn().mockResolvedValue({
      content: "Done",
      toolCalls: [],
      tokensUsed: 50,
      costUsd: 0.001,
      finishReason: "stop",
    });

    const provider: AgenticModelProvider = {
      generateWithTools: generateMock,
    };

    const job = { ...mockJob, labels: ["max"] };
    await executeAgenticWorker(job, provider, registry);

    const calls = generateMock.mock.calls;
    const firstCall = calls[0] as [Array<{ role: string; content: string }>, unknown[]] | undefined;
    const systemMsg = firstCall?.[0]?.find((m) => m.role === "system");
    expect(systemMsg?.content).toContain("MODE: TICKET");
    expect(systemMsg?.content).toContain("PLAN FIRST");
  });

  it("uses automation mode prompt when ticket has automation label", async () => {
    const registry = createToolRegistry();
    registry.register(createMockTool("test_tool", "test"));

    const generateMock = vi.fn().mockResolvedValue({
      content: "Done",
      toolCalls: [],
      tokensUsed: 50,
      costUsd: 0.001,
      finishReason: "stop",
    });

    const provider: AgenticModelProvider = {
      generateWithTools: generateMock,
    };

    const job = { ...mockJob, labels: ["automation", "xhigh"] };
    await executeAgenticWorker(job, provider, registry);

    const calls = generateMock.mock.calls;
    const firstCall = calls[0] as [Array<{ role: string; content: string }>, unknown[]] | undefined;
    const systemMsg = firstCall?.[0]?.find((m) => m.role === "system");
    expect(systemMsg?.content).toContain("MODE: AUTOMATION");
    expect(systemMsg?.content).toContain("XHIGH");
  });
});
