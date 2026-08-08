import { execFile } from "node:child_process";
import { promisify } from "node:util";
import pino from "pino";

const execFileAsync = promisify(execFile);
const logger = pino({ name: "nightforge-ci-gate" });

/** Outcome of waiting for CI on a commit. */
export interface CiGateResult {
  passed: boolean;
  /**
   * success | failure | pending | error | skipped
   * skipped = no token configured or no CI runs found (gate not enforced).
   */
  state: "success" | "failure" | "pending" | "error" | "skipped";
  message: string;
  durationMs: number;
}

export interface CiGate {
  /**
   * Wait until GitHub Actions reports green on the given commit SHA.
   * Returns as soon as a run fails, or after the timeout while still pending.
   */
  waitForGreen(
    repoPath: string,
    commitSha: string,
    options?: {
      token?: string;
      timeoutMs?: number;
      pollIntervalMs?: number;
    }
  ): Promise<CiGateResult>;
}

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 15 * 1000;
const FAILURE_CONCLUSIONS = new Set([
  "failure",
  "timed_out",
  "action_required",
  "cancelled",
  "startup_failure",
  "stale",
]);

interface CheckRun {
  status?: string;
  conclusion?: string | null;
  name?: string | null;
}

interface StatusResponse {
  state?: string;
  statuses?: Array<{ state?: string }>;
}

interface CheckRunsResponse {
  total_count?: number;
  check_runs?: CheckRun[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Parse owner/repo from a git remote URL (https or git@). */
export function parseRepoSlug(remoteUrl: string): {
  owner: string;
  repo: string;
} | null {
  const trimmed = remoteUrl.trim().replace(/\.git$/, "");

  let match = trimmed.match(/^https?:\/\/[^/]+\/([^/]+)\/([^/]+)$/);
  if (match) {
    return { owner: match[1], repo: match[2] };
  }

  match = trimmed.match(/^git@[^:]+:([^/]+)\/([^/]+)$/);
  if (match) {
    return { owner: match[1], repo: match[2] };
  }

  return null;
}

async function getRemoteUrl(repoPath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["remote", "get-url", "origin"],
      { cwd: repoPath, timeout: 15000 }
    );
    return stdout.trim();
  } catch {
    return null;
  }
}

async function fetchJson(url: string, token: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!res.ok) {
    const statusText = res.statusText;
    throw new Error(
      `GitHub API ${String(res.status)} ${statusText} for ${url}`
    );
  }

  return res.json();
}

/** Single evaluation of the commit status + check-run state. */
async function evaluateOnce(
  slug: { owner: string; repo: string },
  commitSha: string,
  token: string
): Promise<CiGateResult> {
  const base = `https://api.github.com/repos/${slug.owner}/${slug.repo}/commits/${commitSha}`;

  const [statusRaw, runsRaw] = await Promise.all([
    fetchJson(`${base}/status`, token),
    fetchJson(`${base}/check-runs?per_page=100`, token),
  ]);

  const status = statusRaw as StatusResponse;
  const runs = runsRaw as CheckRunsResponse;

  const statuses = status.statuses ?? [];
  const checkRuns = runs.check_runs ?? [];

  // No statuses AND no check runs → no CI configured for this repo. The
  // gate cannot judge; skip enforcement rather than block forever.
  if (statuses.length === 0 && checkRuns.length === 0) {
    return {
      passed: true,
      state: "skipped",
      message: "No commit statuses or check runs found; CI gate skipped",
      durationMs: 0,
    };
  }

  const anyFailedStatus = statuses.some(
    (s) => s.state === "failure" || s.state === "error"
  );
  const anyPendingStatus = statuses.some((s) => s.state === "pending");

  const anyFailedRun = checkRuns.some(
    (r) =>
      r.status === "completed" &&
      r.conclusion !== null &&
      r.conclusion !== undefined &&
      FAILURE_CONCLUSIONS.has(r.conclusion)
  );
  const anyPendingRun = checkRuns.some((r) => r.status !== "completed");

  if (anyFailedStatus || anyFailedRun) {
    return {
      passed: false,
      state: "failure",
      message: "CI reported a failure on this commit",
      durationMs: 0,
    };
  }

  // All runs succeeded (skipped runs don't count against us).
  const allRunsSuccess =
    checkRuns.length === 0 ||
    checkRuns.every(
      (r) =>
        r.status === "completed" &&
        (r.conclusion === "success" || r.conclusion === "skipped" || r.conclusion === "neutral")
    );
  const allStatusesSuccess =
    statuses.length > 0 && statuses.every((s) => s.state === "success");

  if (anyPendingStatus || anyPendingRun) {
    return {
      passed: false,
      state: "pending",
      message: "CI still running",
      durationMs: 0,
    };
  }

  // Green when every source reports success. GitHub Actions reports via
  // check-runs only (the /status endpoint is often empty), so treat an
  // empty statuses list as "nothing to worry about" rather than a failure.
  const statusesClear = statuses.length === 0 || allStatusesSuccess;

  if (statusesClear && allRunsSuccess) {
    return {
      passed: true,
      state: "success",
      message: "CI green",
      durationMs: 0,
    };
  }

  // Statuses exist but state is mixed/unknown — treat as pending-safe.
  return {
    passed: false,
    state: "pending",
    message: "CI state unknown, waiting",
    durationMs: 0,
  };
}

export function createCiGate(): CiGate {
  return {
    async waitForGreen(
      repoPath: string,
      commitSha: string,
      options
    ): Promise<CiGateResult> {
      const token = options?.token ?? process.env.GITHUB_TOKEN ?? "";
      const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const pollIntervalMs = options?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
      const startTime = Date.now();
      const log = logger.child({ commitSha });

      if (!token) {
        log.warn("No GITHUB_TOKEN configured; CI gate skipped");
        return {
          passed: true,
          state: "skipped",
          message: "No GITHUB_TOKEN configured; CI gate skipped",
          durationMs: 0,
        };
      }

      const remoteUrl = await getRemoteUrl(repoPath);
      const slug = remoteUrl !== null ? parseRepoSlug(remoteUrl) : null;

      if (!slug) {
        log.warn("Could not determine GitHub owner/repo; CI gate skipped");
        return {
          passed: true,
          state: "skipped",
          message: "Could not parse origin remote; CI gate skipped",
          durationMs: 0,
        };
      }

      log.info({ slug }, "CI gate polling started");

      for (;;) {
        let result: CiGateResult;
        try {
          result = await evaluateOnce(slug, commitSha, token);
        } catch (err) {
          const error = err as Error;
          log.error({ err: error.message }, "CI gate evaluation failed");

          if (Date.now() - startTime >= timeoutMs) {
            return {
              passed: false,
              state: "error",
              message: `CI gate hit timeout after API errors: ${error.message}`,
              durationMs: Date.now() - startTime,
            };
          }

          await sleep(pollIntervalMs);
          continue;
        }

        if (result.state === "success" || result.state === "skipped") {
          return { ...result, durationMs: Date.now() - startTime };
        }

        if (result.state === "failure") {
          return { ...result, durationMs: Date.now() - startTime };
        }

        // pending — keep polling until timeout
        if (Date.now() - startTime >= timeoutMs) {
          const minutes = Math.round(timeoutMs / 60000);
          return {
            passed: false,
            state: "pending",
            message: `CI did not finish within ${String(minutes)} min`,
            durationMs: Date.now() - startTime,
          };
        }

        await sleep(pollIntervalMs);
      }
    },
  };
}