import path from "node:path";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import pino from "pino";

const logger = pino({ name: "nightforge-file-changes" });

/**
 * Deterministic file-change exchange between model and worker
 * (IMPLEMENTATION.md step 1.5, flow step 4: parse -> extract -> apply).
 *
 * Two block types:
 *
 *   ```edit:path/relative/to/repo          (modify an existing file)
 *   <<<<<<< SEARCH
 *   <exact existing lines>
 *   =======
 *   <replacement lines>
 *   >>>>>>> REPLACE
 *   ```
 *
 *   ```file:path/relative/to/repo          (create a new file)
 *   <full content of the file>
 *   ```
 *
 *   ```delete:path/relative/to/repo        (remove an existing file)
 *   ```
 *
 * Edit blocks keep the model from having to reproduce whole files and
 * fail safely (no match = rejection) instead of destroying content.
 */

export type FileChange =
  | { kind: "write"; path: string; content: string }
  | { kind: "edit"; path: string; search: string; replace: string }
  | { kind: "delete"; path: string };

export interface ApplyResult {
  applied: string[];
  rejected: Array<{ path: string; reason: string }>;
}

/** Matches ```file:<path>\n<content>``` blocks, lazy so blocks don't bleed. */
const FILE_BLOCK_PATTERN = /```file:([^\n`]+)\n([\s\S]*?)\n```/g;

/** Matches ```edit:<path> blocks containing one SEARCH/REPLACE hunk. */
const EDIT_BLOCK_PATTERN =
  /```edit:([^\n`]+)\n<<<<<<< SEARCH\n([\s\S]*?)\n?=======\n([\s\S]*?)\n?>>>>>>> REPLACE\s*```/g;

/** Matches ```delete:<path>``` blocks (optional body, ignored). */
const DELETE_BLOCK_PATTERN = /```delete:([^\n`]+)\n?[\s\S]*?```/g;

/** Top-level entries that must never be written by a ticket. */
const PROHIBITED_ROOTS = new Set(["node_modules", ".git"]);

/** Secrets and lockfiles are never model output. */
const PROHIBITED_EXACT = new Set([".env", "package-lock.json"]);

export function parseFileChanges(content: string): FileChange[] {
  const changes: FileChange[] = [];
  for (const match of content.matchAll(EDIT_BLOCK_PATTERN)) {
    const rawPath = match[1].trim();
    if (rawPath.length === 0) {
      continue;
    }
    changes.push({
      kind: "edit",
      path: rawPath,
      search: match[2],
      replace: match[3],
    });
  }
  for (const match of content.matchAll(DELETE_BLOCK_PATTERN)) {
    const rawPath = match[1].trim();
    if (rawPath.length === 0) {
      continue;
    }
    changes.push({ kind: "delete", path: rawPath });
  }
  for (const match of content.matchAll(FILE_BLOCK_PATTERN)) {
    const rawPath = match[1].trim();
    const body = match[2];
    if (rawPath.length === 0) {
      continue;
    }
    changes.push({ kind: "write", path: rawPath, content: body });
  }
  return changes;
}

function rejectReason(worktreePath: string, rawPath: string): string | null {
  if (path.isAbsolute(rawPath)) {
    return "absolute path";
  }
  const normalized = path.normalize(rawPath);
  if (normalized.startsWith("..") || normalized === "..") {
    return "escapes the worktree";
  }
  const resolved = path.resolve(worktreePath, normalized);
  if (!resolved.startsWith(path.resolve(worktreePath) + path.sep)) {
    return "escapes the worktree";
  }
  const segments = normalized.split(path.sep);
  const first = segments[0] ?? "";
  if (PROHIBITED_ROOTS.has(first)) {
    return `writes into ${first}`;
  }
  if (PROHIBITED_EXACT.has(path.basename(normalized))) {
    return "prohibited file";
  }
  return null;
}

export async function applyFileChanges(
  worktreePath: string,
  changes: FileChange[]
): Promise<ApplyResult> {
  const result: ApplyResult = { applied: [], rejected: [] };

  for (const change of changes) {
    const reason = rejectReason(worktreePath, change.path);
    if (reason !== null) {
      logger.warn({ path: change.path, reason }, "Rejected file change");
      result.rejected.push({ path: change.path, reason });
      continue;
    }

    const normalized = path.normalize(change.path);
    const target = path.resolve(worktreePath, normalized);
    try {
      if (change.kind === "delete") {
        await rm(target);
      } else if (change.kind === "edit") {
        const updated = await applyEditBlock(target, change.search, change.replace);
        if (updated.reason !== null) {
          logger.warn({ path: change.path, reason: updated.reason }, "Rejected edit");
          result.rejected.push({ path: change.path, reason: updated.reason });
          continue;
        }
        await writeFile(target, updated.content, "utf8");
      } else {
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, change.content, "utf8");
      }
      result.applied.push(normalized);
    } catch (err) {
      const error = err as Error;
      logger.warn(
        { path: change.path, err: error.message },
        "Failed to apply file change"
      );
      result.rejected.push({ path: change.path, reason: error.message });
    }
  }

  return result;
}

interface EditOutcome {
  reason: string | null;
  content: string;
}

/**
 * Apply one SEARCH/REPLACE hunk. Fails safely when the search text is
 * missing or ambiguous instead of guessing where to edit.
 */
async function applyEditBlock(
  target: string,
  search: string,
  replace: string
): Promise<EditOutcome> {
  let current: string;
  try {
    current = await readFile(target, "utf8");
  } catch {
    return { reason: "edit target does not exist", content: "" };
  }

  if (search.length === 0) {
    return { reason: "empty SEARCH block", content: "" };
  }

  const occurrences = countOccurrences(current, search);
  if (occurrences === 0) {
    return { reason: "SEARCH block not found in file", content: "" };
  }
  if (occurrences > 1) {
    return {
      reason: `SEARCH block is ambiguous (${String(occurrences)} occurrences)`,
      content: "",
    };
  }

  const index = current.indexOf(search);
  return {
    reason: null,
    content: current.slice(0, index) + replace + current.slice(index + search.length),
  };
}

function countOccurrences(text: string, needle: string): number {
  let count = 0;
  let from = 0;
  while (from <= text.length - needle.length) {
    const index = text.indexOf(needle, from);
    if (index === -1) break;
    count++;
    from = index + needle.length;
  }
  return count;
}
