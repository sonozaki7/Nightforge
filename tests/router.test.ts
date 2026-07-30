import { describe, it, expect } from "vitest";
import { calculateCost, type Provider } from "../src/router/providers/base.js";
import type { ModelRouter } from "../src/router/model-router.js";
import type { EscalationManager } from "../src/router/escalation.js";

const mockQwenProvider: Provider = {
  name: "qwen",
  modelName: "qwen3-235b-a22b",
  generate: () =>
    Promise.resolve({
      content: "",
      tokensUsed: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      model: "qwen3-235b-a22b",
      durationMs: 0,
    }),
  getCostPerMillionInput: () => 0.005,
  getCostPerMillionOutput: () => 0.025,
};

const mockClaudeProvider: Provider = {
  name: "claude",
  modelName: "claude-opus-5",
  generate: () =>
    Promise.resolve({
      content: "",
      tokensUsed: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      model: "claude-opus-5",
      durationMs: 0,
    }),
  getCostPerMillionInput: () => 5.0,
  getCostPerMillionOutput: () => 25.0,
};

const mockHermesProvider: Provider = {
  name: "hermes",
  modelName: "nousresearch/hermes-4-70b",
  generate: () =>
    Promise.resolve({
      content: "",
      tokensUsed: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      model: "nousresearch/hermes-4-70b",
      durationMs: 0,
    }),
  getCostPerMillionInput: () => 0.13,
  getCostPerMillionOutput: () => 0.4,
};

const mockDeepSeekProvider: Provider = {
  name: "deepseek",
  modelName: "deepseek/deepseek-v3.2",
  generate: () =>
    Promise.resolve({
      content: "",
      tokensUsed: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      model: "deepseek/deepseek-v3.2",
      durationMs: 0,
    }),
  getCostPerMillionInput: () => 0.27,
  getCostPerMillionOutput: () => 0.4,
};

const mockHermes405bProvider: Provider = {
  name: "hermes405b",
  modelName: "nousresearch/hermes-4-405b",
  generate: () =>
    Promise.resolve({
      content: "",
      tokensUsed: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      model: "nousresearch/hermes-4-405b",
      durationMs: 0,
    }),
  getCostPerMillionInput: () => 1.0,
  getCostPerMillionOutput: () => 3.0,
};

describe("provider base", () => {
  describe("calculateCost", () => {
    it("should calculate cost correctly", () => {
      const cost = calculateCost(1_000_000, 1_000_000, 0.005, 0.025);
      expect(cost).toBeCloseTo(0.03);
    });

    it("should handle zero tokens", () => {
      const cost = calculateCost(0, 0, 3.0, 15.0);
      expect(cost).toBe(0);
    });

    it("should calculate partial million tokens", () => {
      const cost = calculateCost(500_000, 500_000, 3.0, 15.0);
      expect(cost).toBeCloseTo(9.0);
    });

    it("should handle different input/output ratios", () => {
      const cost = calculateCost(100_000, 10_000, 3.0, 15.0);
      expect(cost).toBeCloseTo(0.45);
    });
  });
});

describe("qwen provider", () => {
  it("should have correct pricing", async () => {
    const { createQwenProvider } = await import(
      "../src/router/providers/qwen.js"
    );

    const provider = createQwenProvider({ apiKey: "test-key" });

    expect(provider.name).toBe("qwen");
    expect(provider.getCostPerMillionInput()).toBe(0.005);
    expect(provider.getCostPerMillionOutput()).toBe(0.025);
  });

  it("should use default model", async () => {
    const { createQwenProvider } = await import(
      "../src/router/providers/qwen.js"
    );

    const provider = createQwenProvider({ apiKey: "test-key" });
    expect(provider.modelName).toBe("qwen3-235b-a22b");
  });

  it("should allow custom model", async () => {
    const { createQwenProvider } = await import(
      "../src/router/providers/qwen.js"
    );

    const provider = createQwenProvider({
      apiKey: "test-key",
      model: "custom-model",
    });
    expect(provider.modelName).toBe("custom-model");
  });
});

describe("claude provider", () => {
  it("should have correct pricing", async () => {
    const { createClaudeProvider } = await import(
      "../src/router/providers/claude.js"
    );

    const provider = createClaudeProvider({ apiKey: "test-key" });

    expect(provider.name).toBe("claude");
    expect(provider.getCostPerMillionInput()).toBe(5.0);
    expect(provider.getCostPerMillionOutput()).toBe(25.0);
  });

  it("should use default model", async () => {
    const { createClaudeProvider } = await import(
      "../src/router/providers/claude.js"
    );

    const provider = createClaudeProvider({ apiKey: "test-key" });
    expect(provider.modelName).toBe("claude-opus-5");
  });

  it("should allow custom model", async () => {
    const { createClaudeProvider } = await import(
      "../src/router/providers/claude.js"
    );

    const provider = createClaudeProvider({
      apiKey: "test-key",
      model: "claude-opus-4-20250514",
    });
    expect(provider.modelName).toBe("claude-opus-4-20250514");
  });
});

describe("openrouter provider", () => {
  it("should have correct pricing", async () => {
    const { createOpenRouterProvider } = await import(
      "../src/router/providers/openrouter.js"
    );

    const provider = createOpenRouterProvider({ apiKey: "test-key" });

    expect(provider.name).toBe("hermes");
    expect(provider.getCostPerMillionInput()).toBe(0.13);
    expect(provider.getCostPerMillionOutput()).toBe(0.4);
  });

  it("should use default model", async () => {
    const { createOpenRouterProvider } = await import(
      "../src/router/providers/openrouter.js"
    );

    const provider = createOpenRouterProvider({ apiKey: "test-key" });
    expect(provider.modelName).toBe("nousresearch/hermes-4-70b");
  });

  it("should allow custom model", async () => {
    const { createOpenRouterProvider } = await import(
      "../src/router/providers/openrouter.js"
    );

    const provider = createOpenRouterProvider({
      apiKey: "test-key",
      model: "nousresearch/hermes-3-llama-3.1-405b",
    });
    expect(provider.modelName).toBe("nousresearch/hermes-3-llama-3.1-405b");
  });
});

describe("deepseek provider", () => {
  it("should have correct pricing", async () => {
    const { createDeepSeekProvider } = await import(
      "../src/router/providers/deepseek.js"
    );

    const provider = createDeepSeekProvider({ apiKey: "test-key" });

    expect(provider.name).toBe("deepseek");
    expect(provider.getCostPerMillionInput()).toBe(0.27);
    expect(provider.getCostPerMillionOutput()).toBe(0.4);
  });

  it("should use default model", async () => {
    const { createDeepSeekProvider } = await import(
      "../src/router/providers/deepseek.js"
    );

    const provider = createDeepSeekProvider({ apiKey: "test-key" });
    expect(provider.modelName).toBe("deepseek/deepseek-v3.2");
  });
});

describe("hermes 405b provider", () => {
  it("should have correct pricing", async () => {
    const { createHermes405bProvider } = await import(
      "../src/router/providers/hermes405b.js"
    );

    const provider = createHermes405bProvider({ apiKey: "test-key" });

    expect(provider.name).toBe("hermes405b");
    expect(provider.getCostPerMillionInput()).toBe(1.0);
    expect(provider.getCostPerMillionOutput()).toBe(3.0);
  });

  it("should use default model", async () => {
    const { createHermes405bProvider } = await import(
      "../src/router/providers/hermes405b.js"
    );

    const provider = createHermes405bProvider({ apiKey: "test-key" });
    expect(provider.modelName).toBe("nousresearch/hermes-4-405b");
  });
});

describe("model router", () => {
  const createRouter = async (): Promise<ModelRouter> => {
    const { createModelRouter } = await import(
      "../src/router/model-router.js"
    );
    return createModelRouter({
      qwen: mockQwenProvider,
      claude: mockClaudeProvider,
      hermes: mockHermesProvider,
      deepseek: mockDeepSeekProvider,
      hermes405b: mockHermes405bProvider,
    });
  };

  it("should route uncensored labels to Hermes", async () => {
    const router = await createRouter();
    const decision = router.route({
      labels: ["uncensored"],
      failureCount: 0,
      currentHour: 12,
      timezone: "Asia/Bangkok",
    });

    expect(decision.provider.name).toBe("hermes");
    expect(decision.reason).toContain("Uncensored");
  });

  it("should route unrestricted labels to Hermes 405B", async () => {
    const router = await createRouter();
    const decision = router.route({
      labels: ["unrestricted"],
      failureCount: 0,
      currentHour: 12,
      timezone: "Asia/Bangkok",
    });

    expect(decision.provider.name).toBe("hermes405b");
    expect(decision.reason).toContain("Unrestricted");
  });

  it("should route permissive labels to DeepSeek", async () => {
    const router = await createRouter();
    const decision = router.route({
      labels: ["permissive"],
      failureCount: 0,
      currentHour: 12,
      timezone: "Asia/Bangkok",
    });

    expect(decision.provider.name).toBe("deepseek");
    expect(decision.reason).toContain("Permissive");
  });

  it("should prioritize unrestricted over uncensored", async () => {
    const router = await createRouter();
    const decision = router.route({
      labels: ["uncensored", "unrestricted"],
      failureCount: 0,
      currentHour: 12,
      timezone: "Asia/Bangkok",
    });

    expect(decision.provider.name).toBe("hermes405b");
  });

  it("should prioritize uncensored over frontier labels", async () => {
    const router = await createRouter();
    const decision = router.route({
      labels: ["architecture", "uncensored"],
      failureCount: 0,
      currentHour: 12,
      timezone: "Asia/Bangkok",
    });

    expect(decision.provider.name).toBe("hermes");
  });

  it("should route architecture labels to Claude", async () => {
    const router = await createRouter();
    const decision = router.route({
      labels: ["architecture"],
      failureCount: 0,
      currentHour: 12,
      timezone: "Asia/Bangkok",
    });

    expect(decision.provider.name).toBe("claude");
    expect(decision.reason).toContain("Frontier label");
  });

  it("should route security labels to Claude", async () => {
    const router = await createRouter();
    const decision = router.route({
      labels: ["security"],
      failureCount: 0,
      currentHour: 12,
      timezone: "Asia/Bangkok",
    });

    expect(decision.provider.name).toBe("claude");
  });

  it("should route urgent labels to Claude", async () => {
    const router = await createRouter();
    const decision = router.route({
      labels: ["urgent"],
      failureCount: 0,
      currentHour: 12,
      timezone: "Asia/Bangkok",
    });

    expect(decision.provider.name).toBe("claude");
    expect(decision.reason).toContain("Urgent");
  });

  it("should escalate to Claude after 2 failures", async () => {
    const router = await createRouter();
    const decision = router.route({
      labels: [],
      failureCount: 2,
      currentHour: 12,
      timezone: "Asia/Bangkok",
    });

    expect(decision.provider.name).toBe("claude");
    expect(decision.reason).toContain("Escalation");
  });

  it("should route overnight tickets to Qwen", async () => {
    const router = await createRouter();
    const decision = router.route({
      labels: [],
      failureCount: 0,
      currentHour: 23,
      timezone: "Asia/Bangkok",
    });

    expect(decision.provider.name).toBe("qwen");
    expect(decision.reason).toContain("Overnight");
  });

  it("should route early morning tickets to Qwen", async () => {
    const router = await createRouter();
    const decision = router.route({
      labels: [],
      failureCount: 0,
      currentHour: 5,
      timezone: "Asia/Bangkok",
    });

    expect(decision.provider.name).toBe("qwen");
  });

  it("should default to Qwen for routine daytime tickets", async () => {
    const router = await createRouter();
    const decision = router.route({
      labels: ["feature"],
      failureCount: 0,
      currentHour: 14,
      timezone: "Asia/Bangkok",
    });

    expect(decision.provider.name).toBe("qwen");
    expect(decision.reason).toContain("Default");
  });
});

describe("escalation manager", () => {
  const createManager = async (): Promise<EscalationManager> => {
    const { createEscalationManager } = await import(
      "../src/router/escalation.js"
    );
    return createEscalationManager({
      qwen: mockQwenProvider,
      claude: mockClaudeProvider,
    });
  };

  it("should return base provider for first attempt", async () => {
    const manager = await createManager();
    const provider = manager.getProviderForAttempt(1, mockQwenProvider);
    expect(provider.name).toBe("qwen");
  });

  it("should escalate after max attempts per tier", async () => {
    const manager = await createManager();
    const provider = manager.getProviderForAttempt(3, mockQwenProvider);
    expect(provider.name).toBe("claude");
  });

  it("should return escalation path", async () => {
    const manager = await createManager();
    const path = manager.getEscalationPath("qwen");
    expect(path).toEqual(["qwen", "claude"]);
  });

  it("should detect when to escalate", async () => {
    const manager = await createManager();
    expect(manager.shouldEscalate(1, 2)).toBe(false);
    expect(manager.shouldEscalate(2, 2)).toBe(false);
    expect(manager.shouldEscalate(3, 2)).toBe(true);
  });
});
