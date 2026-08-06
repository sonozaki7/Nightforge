import { describe, it, expect } from "vitest";
import { createEditTool, createReadTool } from "../src/tools/services/edit.js";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

async function makeWorktree(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "edit-tool-"));
  await mkdir(path.join(dir, "src"), { recursive: true });
  await writeFile(path.join(dir, "src", "index.ts"), "const a = 1;\n", "utf8");
  return dir;
}

describe("createEditTool", () => {
  it("writes a new file inside the worktree", async () => {
    const worktree = await makeWorktree();
    const tool = createEditTool({ worktreePath: worktree });

    const result = await tool.execute({ path: "src/new.ts", content: "export const x = 1;\n" });

    expect(result.success).toBe(true);
    const content = await readFile(path.join(worktree, "src", "new.ts"), "utf8");
    expect(content).toBe("export const x = 1;\n");
  });

  it("rejects paths escaping the worktree", async () => {
    const worktree = await makeWorktree();
    const tool = createEditTool({ worktreePath: worktree });

    const result = await tool.execute({ path: "../evil.txt", content: "bad" });

    expect(result.success).toBe(false);
    expect(result.error).toContain("escapes");
  });

  it("rejects absolute paths", async () => {
    const worktree = await makeWorktree();
    const tool = createEditTool({ worktreePath: worktree });

    const result = await tool.execute({ path: "/etc/passwd", content: "bad" });

    expect(result.success).toBe(false);
    expect(result.error).toContain("absolute");
  });

  it("rejects writes into .env", async () => {
    const worktree = await makeWorktree();
    const tool = createEditTool({ worktreePath: worktree });

    const result = await tool.execute({ path: ".env", content: "SECRET=x" });

    expect(result.success).toBe(false);
    expect(result.error).toContain(".env");
  });

  it("rejects writes into node_modules", async () => {
    const worktree = await makeWorktree();
    const tool = createEditTool({ worktreePath: worktree });

    const result = await tool.execute({ path: "node_modules/x/index.js", content: "bad" });

    expect(result.success).toBe(false);
    expect(result.error).toContain("node_modules");
  });
});

describe("createReadTool", () => {
  it("reads a file inside the worktree", async () => {
    const worktree = await makeWorktree();
    const tool = createReadTool({ worktreePath: worktree });

    const result = await tool.execute({ path: "src/index.ts" });

    expect(result.success).toBe(true);
    expect(result.data).toEqual(
      expect.objectContaining({ path: "src/index.ts", content: "const a = 1;\n" })
    );
  });

  it("rejects paths escaping the worktree", async () => {
    const worktree = await makeWorktree();
    const tool = createReadTool({ worktreePath: worktree });

    const result = await tool.execute({ path: "../secret.txt" });

    expect(result.success).toBe(false);
    expect(result.error).toContain("escapes");
  });
});