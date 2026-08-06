import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, extname } from "node:path";
import pino from "pino";

const logger = pino({ name: "nightforge-explorer" });

/**
 * Repository Explorer (Guide NIGHTFORGE-V2.1 §5, §7).
 *
 * Dedicated exploration stage with a strict line budget. Ranks repository
 * regions by relevance to the task so workers receive bounded context
 * instead of the whole repository. Read-only: never modifies files.
 */

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".next",
  ".cache",
]);

const CODE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".rb",
  ".yaml",
  ".yml",
  ".json",
]);

export interface ExplorationBudget {
  /** Maximum total lines of file content to read. */
  maxLines: number;
  /** Maximum number of files to open. */
  maxFiles: number;
}

export interface RankedRegion {
  /** Path relative to the repository root. */
  path: string;
  score: number;
  /** Why this region ranked: matched terms or structural signals. */
  reason: string;
}

export interface ExplorationResult {
  regions: RankedRegion[];
  filesRead: number;
  linesRead: number;
  budgetExhausted: boolean;
}

export interface RepositoryExplorer {
  explore(
    repoPath: string,
    query: string,
    budget: ExplorationBudget
  ): Promise<ExplorationResult>;
}

/** Extract search terms from a free-form task query. */
export function extractTerms(query: string): string[] {
  const stopwords = new Set([
    "the", "and", "for", "with", "add", "fix", "make", "that", "this",
    "into", "from", "when", "should", "must", "can", "not", "are", "was",
  ]);
  return [...new Set(
    query
      .toLowerCase()
      .split(/[^a-z0-9_.-]+/)
      .filter((term) => term.length >= 3 && !stopwords.has(term))
  )];
}

function scorePath(relPath: string, terms: string[]): number {
  const lower = relPath.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (lower.includes(term)) score += 10;
  }
  return score;
}

interface FileEntry {
  relPath: string;
  pathScore: number;
}

async function collectFiles(
  repoPath: string,
  terms: string[],
  maxFiles: number
): Promise<FileEntry[]> {
  const entries: FileEntry[] = [];

  async function walk(dir: string): Promise<void> {
    if (entries.length >= maxFiles * 4) return; // cap scan width
    const items = await readdir(dir, { withFileTypes: true });
    for (const item of items) {
      if (entries.length >= maxFiles * 4) return;
      const full = join(dir, item.name);
      const rel = relative(repoPath, full);
      if (item.isDirectory()) {
        if (!IGNORED_DIRS.has(item.name)) {
          await walk(full);
        }
        continue;
      }
      if (!item.isFile() || !CODE_EXTENSIONS.has(extname(item.name))) {
        continue;
      }
      entries.push({ relPath: rel, pathScore: scorePath(rel, terms) });
    }
  }

  await walk(repoPath);
  // Investigate the most promising paths first.
  entries.sort((a, b) => b.pathScore - a.pathScore);
  return entries.slice(0, maxFiles * 2);
}

export function createRepositoryExplorer(): RepositoryExplorer {
  return {
    async explore(repoPath, query, budget): Promise<ExplorationResult> {
      const log = logger.child({ repoPath });
      const terms = extractTerms(query);
      if (terms.length === 0) {
        log.warn("Empty query after term extraction");
        return { regions: [], filesRead: 0, linesRead: 0, budgetExhausted: false };
      }

      let candidates: FileEntry[];
      try {
        candidates = await collectFiles(repoPath, terms, budget.maxFiles);
      } catch (error: unknown) {
        log.error({ err: error }, "Exploration failed to read repository");
        throw error;
      }

      const regionScores = new Map<string, { score: number; reasons: string[] }>();

      function creditRegion(relPath: string, points: number, reason: string): void {
        // Score at file level and its parent directory level.
        const targets = [relPath, relPath.includes("/") ? relPath.split("/").slice(0, -1).join("/") : "."];
        for (const target of targets) {
          const existing = regionScores.get(target) ?? { score: 0, reasons: [] };
          existing.score += points;
          if (!existing.reasons.includes(reason)) existing.reasons.push(reason);
          regionScores.set(target, existing);
        }
      }

      let filesRead = 0;
      let linesRead = 0;
      let budgetExhausted = false;

      for (const candidate of candidates) {
        if (filesRead >= budget.maxFiles || linesRead >= budget.maxLines) {
          budgetExhausted = true;
          break;
        }
        if (candidate.pathScore > 0) {
          creditRegion(candidate.relPath, candidate.pathScore, `path matches query terms`);
        }

        let content: string;
        try {
          const info = await stat(join(repoPath, candidate.relPath));
          // Skip very large files to protect the line budget.
          if (info.size > 512 * 1024) continue;
          content = await readFile(join(repoPath, candidate.relPath), "utf8");
        } catch {
          continue;
        }

        filesRead += 1;
        const lines = content.split("\n");
        const readable = Math.min(lines.length, budget.maxLines - linesRead);
        linesRead += readable;

        const lowerContent = content.toLowerCase();
        let contentHits = 0;
        const matchedTerms: string[] = [];
        for (const term of terms) {
          const idx = lowerContent.indexOf(term);
          if (idx >= 0) {
            contentHits += 1;
            matchedTerms.push(term);
          }
        }
        if (contentHits > 0) {
          creditRegion(
            candidate.relPath,
            contentHits * 5,
            `content matches: ${matchedTerms.join(", ")}`
          );
        }
      }

      const regions: RankedRegion[] = [...regionScores.entries()]
        .map(([path, value]) => ({
          path,
          score: value.score,
          reason: value.reasons.join("; "),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 10);

      log.info(
        { regions: regions.length, filesRead, linesRead, budgetExhausted },
        "Exploration complete"
      );

      return { regions, filesRead, linesRead, budgetExhausted };
    },
  };
}
