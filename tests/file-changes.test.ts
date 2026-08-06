import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseFileChanges, applyFileChanges } from "../src/workers/file-changes.js";

function worktreeWith(filePath: string, content: string): string {
  const root = mkdtempSync(join(tmpdir(), "nf-file-changes-"));
  writeFileSync(join(root, filePath), content);
  return root;
}

describe("parseFileChanges", () => {
  it("parses edit blocks with SEARCH and REPLACE sections", () => {
    const content = [
      "```edit:docs/notes.md",
      "<<<<<<< SEARCH",
      "old line",
      "=======",
      "new line",
      ">>>>>>> REPLACE",
      "```",
    ].join("\n");

    const changes = parseFileChanges(content);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toEqual({
      kind: "edit",
      path: "docs/notes.md",
      search: "old line",
      replace: "new line",
    });
  });

  it("parses file blocks as writes", () => {
    const content = "```file:new-file.ts\nexport const x = 1;\n```";
    const changes = parseFileChanges(content);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toEqual({
      kind: "write",
      path: "new-file.ts",
      content: "export const x = 1;",
    });
  });
});

describe("applyFileChanges edit blocks", () => {
  const original = Array.from({ length: 20 }, (_, i) => `line ${String(i)}`).join("\n") + "\n";

  it("replaces only the matched region and keeps the rest", async () => {
    const root = worktreeWith("notes.md", original);
    const changes = parseFileChanges([
      "```edit:notes.md",
      "<<<<<<< SEARCH",
      "line 3",
      "=======",
      "line 3 edited",
      ">>>>>>> REPLACE",
      "```",
    ].join("\n"));

    const result = await applyFileChanges(root, changes);
    expect(result.applied).toEqual(["notes.md"]);
    expect(result.rejected).toEqual([]);

    const updated = readFileSync(join(root, "notes.md"), "utf8");
    expect(updated).toContain("line 3 edited");
    expect(updated).toContain("line 19");
    expect(updated).not.toContain("line 3\n");
  });

  it("rejects an edit whose SEARCH text does not exist", async () => {
    const root = worktreeWith("notes.md", original);
    const changes = parseFileChanges([
      "```edit:notes.md",
      "<<<<<<< SEARCH",
      "text that is not there",
      "=======",
      "replacement",
      ">>>>>>> REPLACE",
      "```",
    ].join("\n"));

    const result = await applyFileChanges(root, changes);
    expect(result.applied).toEqual([]);
    expect(result.rejected[0]?.reason).toBe("SEARCH block not found in file");
    expect(readFileSync(join(root, "notes.md"), "utf8")).toBe(original);
  });

  it("rejects an ambiguous SEARCH block", async () => {
    const root = worktreeWith("notes.md", "dup\ndup\n");
    const changes = parseFileChanges([
      "```edit:notes.md",
      "<<<<<<< SEARCH",
      "dup",
      "=======",
      "changed",
      ">>>>>>> REPLACE",
      "```",
    ].join("\n"));

    const result = await applyFileChanges(root, changes);
    expect(result.rejected[0]?.reason).toContain("ambiguous");
    expect(readFileSync(join(root, "notes.md"), "utf8")).toBe("dup\ndup\n");
  });

  it("rejects an edit to a file that does not exist", async () => {
    const root = mkdtempSync(join(tmpdir(), "nf-file-changes-"));
    const changes = parseFileChanges([
      "```edit:missing.md",
      "<<<<<<< SEARCH",
      "a",
      "=======",
      "b",
      ">>>>>>> REPLACE",
      "```",
    ].join("\n"));

    const result = await applyFileChanges(root, changes);
    expect(result.rejected[0]?.reason).toBe("edit target does not exist");
  });
});

describe("applyFileChanges delete blocks", () => {
  it("parses and applies file deletion", async () => {
    const root = worktreeWith("old-module.ts", "export const legacy = true;\n");
    const changes = parseFileChanges("```delete:old-module.ts\n```");

    expect(changes).toEqual([{ kind: "delete", path: "old-module.ts" }]);
    const result = await applyFileChanges(root, changes);
    expect(result.applied).toEqual(["old-module.ts"]);
    expect(existsSync(join(root, "old-module.ts"))).toBe(false);
  });

  it("rejects deleting a file that does not exist", async () => {
    const root = mkdtempSync(join(tmpdir(), "nf-file-changes-"));
    const result = await applyFileChanges(
      root,
      parseFileChanges("```delete:ghost.ts\n```")
    );
    expect(result.applied).toEqual([]);
    expect(result.rejected.length).toBe(1);
  });

  it("never deletes prohibited paths", async () => {
    const root = mkdtempSync(join(tmpdir(), "nf-file-changes-"));
    const result = await applyFileChanges(
      root,
      parseFileChanges("```delete:.env\n```")
    );
    expect(result.rejected[0]?.reason).toBe("prohibited file");
  });
});
