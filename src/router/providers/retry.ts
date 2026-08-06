import pino from "pino";

const logger = pino({ name: "nightforge-provider-retry" });

export interface RetryPolicy {
  /** Max attempts before giving up (default 3). */
  maxAttempts?: number;
  /** Base delay between retries in ms (doubled each attempt). */
  baseDelayMs?: number;
  /** Retry only on transient errors (rate limit, 5xx, network). */
  retryOnTransient?: boolean;
}

const DEFAULT_POLICY: Required<RetryPolicy> = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  retryOnTransient: true,
};

/** True when an error is worth retrying (rate limit / 5xx / network). */
export function isTransientError(error: unknown): boolean {
  const err = error as { status?: number; code?: string; message?: string };
  const status = err.status ?? 0;
  if (status === 429) return true;
  if (status >= 500 && status <= 599) return true;
  const message = `${err.message ?? ""} ${err.code ?? ""}`.toLowerCase();
  return (
    message.includes("rate limit") ||
    message.includes("rate_limit") ||
    message.includes("econnreset") ||
    message.includes("etimedout") ||
    message.includes("econnrefused") ||
    message.includes("timeout") ||
    message.includes("insufficient_quota") ||
    message.includes("overloaded")
  );
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run an async operation with exponential-backoff retry on transient
 * failures. Waits `baseDelayMs * 2^(attempt-1)` between tries so a flaky
 * provider gets a chance to recover instead of killing the ticket mid-work.
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  policy: RetryPolicy = {}
): Promise<T> {
  const resolved: Required<RetryPolicy> = { ...DEFAULT_POLICY, ...policy };
  const maxAttempts = resolved.maxAttempts;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const transient = isTransientError(error);
      if (!resolved.retryOnTransient || !transient || attempt === maxAttempts) {
        if (attempt > 1) {
          logger.warn(
            { attempt, maxAttempts, transient },
            "Operation failed after retries"
          );
        }
        throw error;
      }
      const delay = resolved.baseDelayMs * 2 ** (attempt - 1);
      logger.warn(
        { attempt, maxAttempts, delayMs: delay },
        "Transient error, retrying"
      );
      await sleep(delay);
    }
  }
  throw lastError;
}