import { describe, it, expect, vi } from "vitest";
import { withRetry, isTransientError } from "../src/router/providers/retry.js";

function apiError(status: number): Error & { status: number } {
  const error = new Error(`API error ${String(status)}`) as Error & {
    status: number;
  };
  error.status = status;
  return error;
}

describe("isTransientError", () => {
  it("treats 429 as transient", () => {
    expect(isTransientError(apiError(429))).toBe(true);
  });

  it("treats 5xx as transient", () => {
    expect(isTransientError(apiError(500))).toBe(true);
    expect(isTransientError(apiError(503))).toBe(true);
  });

  it("treats 4xx (except 429) as permanent", () => {
    expect(isTransientError(apiError(400))).toBe(false);
    expect(isTransientError(apiError(401))).toBe(false);
  });

  it("detects network errors by message", () => {
    expect(isTransientError(new Error("ECONNRESET socket hang up"))).toBe(true);
    expect(isTransientError(new Error("timeout exceeded"))).toBe(true);
    expect(isTransientError(new Error("rate limit exceeded"))).toBe(true);
  });
});

describe("withRetry", () => {
  it("returns the result on first success", async () => {
    const spy = vi.fn(async (): Promise<number> => Promise.resolve(42));
    const result = await withRetry(spy, { maxAttempts: 3 });
    expect(result).toBe(42);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("retries transient failures then succeeds", async () => {
    let calls = 0;
    const spy = vi.fn(async (): Promise<string> => {
      calls += 1;
      if (calls < 3) throw apiError(429);
      return Promise.resolve("ok");
    });
    const result = await withRetry(spy, { maxAttempts: 4, baseDelayMs: 1 });
    expect(result).toBe("ok");
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it("gives up after maxAttempts and rethrows", async () => {
    const spy = vi.fn((): Promise<never> => Promise.reject(apiError(503)));
    await expect(
      withRetry(spy, { maxAttempts: 2, baseDelayMs: 1 })
    ).rejects.toMatchObject({ status: 503 });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("does not retry permanent errors", async () => {
    const spy = vi.fn((): Promise<never> => Promise.reject(apiError(400)));
    await expect(
      withRetry(spy, { maxAttempts: 3, baseDelayMs: 1 })
    ).rejects.toMatchObject({ status: 400 });
    expect(spy).toHaveBeenCalledTimes(1);
  });
});