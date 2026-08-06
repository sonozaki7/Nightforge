import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import pino from "pino";
import { extractTerms } from "./repository-explorer.js";

const logger = pino({ name: "nightforge-repo-context" });

/**
 * Repository context for the worker prompt.
 *
 * The model must emit FULL file content for every change, which is
 * impossible unless it has seen the current content. This module gathers
 * a bounded snapshot: the repo file listing plus the full content of the
 * files most relevant to the ticket.
 */

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".next",
  ".cache",
  "releases",
]);

const SKIPPED_FILES = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
]);

const CONTEXT_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs",
  ".md", ".yaml", ".yml", ".json",
  ".sh", ".css", ".html", ".py",
]);

const MAX_FILE_BYTES = 256 * 1024;
const MAX_LISTING_ENTRIES = 300;

export interface RepoContextBudget {
  /** Maximum number of files whose full content is included. */
  maxFiles: number;
  /** Maximum total lines of included content. */
  maxLines: number;
}

export const DEFAULT_REPO_CONTEXT_BUDGET: RepoContextBudget = {
  maxFiles: 8,
  maxLines: 2000,
};

export interface RepoListingEntry {
  path: string;
}

export interface RepoContextFile {
  path: string;
  content: string;
}

export interface RepoContextResult {
  listing: RepoListingEntry[];
  included: RepoContextFile[];
  /** True when the listing was capped. */
  listingTruncated: boolean;
}

interface Candidate {
  relPath: string;
  score: number;
}

async function collectCandidates(
  repoPath: string,
  terms: string[]
): Promise<Candidate[]> {
  const candidates: Candidate[] = [];

  async function walk(dir: string): Promise<void> {
    if (candidates.length >= 500) return;
    const items = await readdir(dir, { withFileTypes: true });
    for (const item of items) {
      if (candidates.length >= 500) return;
      const full = join(dir, item.name);
      if (item.isDirectory()) {
        if (!IGNORED_DIRS.has(item.name)) {
          await walk(full);
        }
        continue;
      }
      if (!item.isFile() || SKIPPED_FILES.has(item.name)) continue;
      if (!CONTEXT_EXTENSIONS.has(extname(item.name))) continue;
      const relPath = relative(repoPath, full);
      candidates.push({ relPath, score: scorePath(relPath, terms) });
    }
  }

  await walk(repoPath);
  return candidates;
}

function scorePath(relPath: string, terms: string[]): number {
  const lower = relPath.toLowerCase();
  const baseName = lower.split("/").pop() ?? lower;
  const stem = baseName.replace(/\.[a-z0-9]+$/, "");
  let score = 0;
  for (const term of terms) {
    if (lower.includes(term)) score += 10;
    // A file named by the ticket (e.g. "CONTRIBUTING.md") is a top target.
    if (baseName === term || stem === term) score += 50;
  }
  return score;
}

async function scoreContent(
  repoPath: string,
  candidate: Candidate,
  terms: string[]
): Promise<{ content: string | null; score: number }> {
  const full = join(repoPath, candidate.relPath);
  try {
    const info = await stat(full);
    if (info.size > MAX_FILE_BYTES) return { content: null, score: candidate.score };
    const content = await readFile(full, "utf8");
    const lower = content.toLowerCase();
    let bonus = 0;
    for (const term of terms) {
      if (lower.includes(term)) bonus += 3;
    }
    return { content, score: candidate.score + bonus };
  } catch {
    return { content: null, score: candidate.score };
  }
}

export async function buildRepoContext(
  repoPath: string,
  query: string,
  budget: RepoContextBudget = DEFAULT_REPO_CONTEXT_BUDGET
): Promise<RepoContextResult> {
  const log = logger.child({ repoPath });
  const terms = extractTerms(query);

  let candidates: Candidate[];
  try {
    candidates = await collectCandidates(repoPath, terms);
  } catch (err) {
    log.warn({ err: (err as Error).message }, "Repo context collection failed");
    return { listing: [], included: [], listingTruncated: false };
  }

  const listingTruncated = candidates.length > MAX_LISTING_ENTRIES;
  const listing = candidates
    .map((c) => c.relPath)
    .sort()
    .slice(0, MAX_LISTING_ENTRIES)
    .map((path): RepoListingEntry => ({ path }));

  // Read content for the most promising candidates so content matches
  // can re-rank them before the budget is applied.
  const ranked = [...candidates].sort((a, b) => b.score - a.score).slice(0, budget.maxFiles * 3);
  const read: Array<{ relPath: string; content: string; score: number }> = [];
  for (const candidate of ranked) {
    const { content, score } = await scoreContent(repoPath, candidate, terms);
    if (content !== null) {
      read.push({ relPath: candidate.relPath, content, score });
    }
  }
  read.sort((a, b) => b.score - a.score || a.relPath.localeCompare(b.relPath));

  const included: RepoContextFile[] = [];
  let linesUsed = 0;
  for (const entry of read) {
    if (included.length >= budget.maxFiles) break;
    const lines = entry.content.length === 0 ? 0 : entry.content.split("\n").length;
    if (linesUsed + lines > budget.maxLines) continue; // never ship partial content
    linesUsed += lines;
    included.push({ path: entry.relPath, content: entry.content });
  }

  log.info(
    { files: candidates.length, included: included.length, linesUsed },
    "Repo context built"
  );

  return { listing, included, listingTruncated };
}

/** Render the snapshot into the ticket layer of the prompt. */
export function renderRepoContext(context: RepoContextResult): string {
  const parts: string[] = ["### Repository Layout"];
  if (context.listing.length === 0) {
    parts.push("(empty repository)");
  } else {
    parts.push(context.listing.map((f) => `- ${f.path}`).join("\n"));
  }

  if (context.included.length > 0) {
    parts.push("");
    parts.push("### Current File Contents");
    parts.push(
      "The files below are shown IN FULL because they are most relevant to this ticket.",
      "If your change touches one of them, use an edit block and copy its SEARCH lines verbatim from here."
    );
    for (const file of context.included) {
      parts.push("");
      parts.push(`===== BEGIN FILE: ${file.path} =====`);
      parts.push(file.content.replace(/\n$/, ""));
      parts.push(`===== END FILE: ${file.path} =====`);
    }
  }

  return parts.join("\n");
}
