import { describe, it, expect, vi } from "vitest";
import { createBashTool } from "../src/tools/services/bash.js";
import type { Sandbox, SandboxExecResult } from "../src/sandbox/types.js";

function fakeSandbox(result: SandboxExecResult): Sandbox {
  const exec = vi.fn(() => Promise.resolve(result));
  return {
    exec,
    close: vi.fn(() => Promise.resolve()),
  };
}

describe("createBashTool", () => {
  it("runs a command through the sandbox", async () => {
    const execMock = vi.fn(() =>
      Promise.resolve({
        stdout: "hello",
        stderr: "",
        exitCode: 0,
        timedOut: false,
      })
    );
    const sandbox: Sandbox = {
      exec: execMock,
      close: () => Promise.resolve(),
    };
    const tool = createBashTool({
      sandbox,
      worktreePath: "/work",
      readOnlyPaths: [],
    });

    const result = await tool.execute({ command: "echo hello" });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ exitCode: 0, output: "hello" });
    expect(execMock).toHaveBeenCalledWith(
      expect.objectContaining({
        worktreePath: "/work",
        command: "sh",
        args: ["-c", "echo hello"],
      })
    );
  });

  it("reports non-zero exit as failure", async () => {
    const sandbox = fakeSandbox({
      stdout: "",
      stderr: "boom",
      exitCode: 1,
      timedOut: false,
    });
    const tool = createBashTool({ sandbox, worktreePath: "/work" });

    const result = await tool.execute({ command: "false" });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Exit code 1");
    expect(result.error).toContain("boom");
  });

  it("rejects empty commands", async () => {
    const sandbox = fakeSandbox({
      stdout: "",
      stderr: "",
      exitCode: 0,
      timedOut: false,
    });
    const tool = createBashTool({ sandbox, worktreePath: "/work" });

    const result = await tool.execute({ command: "  " });

    expect(result.success).toBe(false);
    expect(result.error).toContain("non-empty");
  });

  it("reports timeouts", async () => {
    const sandbox = fakeSandbox({
      stdout: "",
      stderr: "",
      exitCode: null,
      timedOut: true,
    });
    const tool = createBashTool({ sandbox, worktreePath: "/work" });

    const result = await tool.execute({ command: "sleep 999" });

    expect(result.success).toBe(false);
    expect(result.error).toContain("timed out");
  });
});