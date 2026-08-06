import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createRepositoryExplorer,
  extractTerms,
} from "../src/context/repository-explorer.js";

describe("extractTerms", () => {
  it("should extract meaningful terms and drop stopwords", () => {
    const terms = extractTerms("Fix the login redirect for users");
    expect(terms).toContain("login");
    expect(terms).toContain("redirect");
    expect(terms).toContain("users");
    expect(terms).not.toContain("the");
    expect(terms).not.toContain("fix");
  });

  it("should deduplicate terms", () => {
    const terms = extractTerms("login LOGIN login");
    expect(terms.filter((t) => t === "login")).toHaveLength(1);
  });
});

describe("createRepositoryExplorer", () => {
  let repo: string;

  beforeAll(async () => {
    repo = await mkdtemp(join(tmpdir(), "nightforge-explore-"));
    await mkdir(join(repo, "src/auth"), { recursive: true });
    await mkdir(join(repo, "src/billing"), { recursive: true });
    await mkdir(join(repo, "node_modules/pkg"), { recursive: true });

    await writeFile(
      join(repo, "src/auth/login.ts"),
      [
        "export function login(user: string): boolean {",
        "  return user.length > 0;",
        "}",
        "export function redirect(target: string): string {",
        "  return `/dashboard?next=${target}`;",
        "}",
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      join(repo, "src/billing/invoice.ts"),
      "export const invoice = () => 42;\n",
      "utf8"
    );
    await writeFile(
      join(repo, "node_modules/pkg/login.ts"),
      "// must never be explored\n",
      "utf8"
    );
  });

  afterAll(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  it("should rank regions matching the query", async () => {
    const explorer = createRepositoryExplorer();
    const result = await explorer.explore(repo, "fix login redirect", {
      maxLines: 500,
      maxFiles: 20,
    });
    expect(result.regions.length).toBeGreaterThan(0);
    const top = result.regions[0] as { path: string };
    expect(top.path).toContain("auth");
  });

  it("should never read node_modules", async () => {
    const explorer = createRepositoryExplorer();
    const result = await explorer.explore(repo, "login", {
      maxLines: 500,
      maxFiles: 20,
    });
    expect(result.regions.every((r) => !r.path.includes("node_modules"))).toBe(true);
  });

  it("should respect the file budget", async () => {
    const explorer = createRepositoryExplorer();
    const result = await explorer.explore(repo, "login redirect invoice", {
      maxLines: 500,
      maxFiles: 1,
    });
    expect(result.filesRead).toBeLessThanOrEqual(1);
  });

  it("should respect the line budget", async () => {
    const explorer = createRepositoryExplorer();
    const result = await explorer.explore(repo, "login redirect", {
      maxLines: 3,
      maxFiles: 20,
    });
    expect(result.linesRead).toBeLessThanOrEqual(3);
    expect(result.budgetExhausted).toBe(true);
  });

  it("should return empty result for a query with no terms", async () => {
    const explorer = createRepositoryExplorer();
    const result = await explorer.explore(repo, "the and", {
      maxLines: 100,
      maxFiles: 10,
    });
    expect(result.regions).toEqual([]);
  });

  it("should throw for a missing repository", async () => {
    const explorer = createRepositoryExplorer();
    await expect(
      explorer.explore(join(repo, "does-not-exist"), "login", {
        maxLines: 100,
        maxFiles: 10,
      })
    ).rejects.toThrow();
  });
});
