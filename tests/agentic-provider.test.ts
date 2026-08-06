import { describe, it, expect, vi, beforeEach } from "vitest";
import { createAgenticProvider } from "../src/router/providers/agentic.js";
import type { ToolDefinition } from "../src/tools/types.js";

const SAMPLE_TOOLS: ToolDefinition[] = [
  {
    name: "bash",
    description: "Run a shell command",
    parameters: {
      type: "object",
      properties: { command: { type: "string", description: "the command" } },
      required: ["command"],
    },
    permission: "auto",
    service: "bash",
  },
];

const MESSAGES = [{ role: "user" as const, content: "run a command" }];

const createMock = vi.fn();

vi.mock("openai", () => {
  return {
    default: class {
      chat: { completions: { create: typeof createMock } };
      constructor() {
        this.chat = { completions: { create: createMock } };
      }
    },
  };
});

beforeEach(() => {
  createMock.mockReset();
});

describe("createAgenticProvider", () => {
  it("maps tool calls from the OpenAI response", async () => {
    createMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: { name: "bash", arguments: '{"command":"echo hi"}' },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });

    const provider = createAgenticProvider({
      apiKey: "test-key",
      baseUrl: "https://example.com/v1",
    });

    const result = await provider.generateWithTools(MESSAGES, SAMPLE_TOOLS);

    expect(result.finishReason).toBe("tool_calls");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]).toEqual({
      id: "call_1",
      name: "bash",
      arguments: { command: "echo hi" },
    });
    expect(result.tokensUsed).toBe(15);
    expect(result.costUsd).toBeGreaterThan(0);
  });

  it("handles a plain text response with no tool calls", async () => {
    createMock.mockResolvedValue({
      choices: [
        {
          message: { content: "done", tool_calls: [] },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });

    const provider = createAgenticProvider({
      apiKey: "test-key",
      baseUrl: "https://example.com/v1",
    });

    const result = await provider.generateWithTools(MESSAGES, SAMPLE_TOOLS);

    expect(result.finishReason).toBe("stop");
    expect(result.content).toBe("done");
    expect(result.toolCalls).toHaveLength(0);
  });

  it("tolerates malformed tool-call JSON arguments", async () => {
    createMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              {
                id: "call_bad",
                type: "function",
                function: { name: "bash", arguments: "not-json" },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });

    const provider = createAgenticProvider({
      apiKey: "test-key",
      baseUrl: "https://example.com/v1",
    });

    const result = await provider.generateWithTools(MESSAGES, SAMPLE_TOOLS);

    expect(result.toolCalls[0].arguments).toEqual({ raw: "not-json" });
  });
});