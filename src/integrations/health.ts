import { execFile } from "node:child_process";
import { promisify } from "node:util";
import pino from "pino";
import type { ProjectConfig } from "../projects/registry.js";

const execFileAsync = promisify(execFile);
const logger = pino({ name: "nightforge-health" });

export interface HealthCheckResult {
  healthy: boolean;
  checks: Array<{
    name: string;
    passed: boolean;
    message: string;
    durationMs: number;
  }>;
}

export interface HealthChecker {
  verify(projectConfig: ProjectConfig): Promise<HealthCheckResult>;
  checkHttp(url: string, timeoutMs?: number): Promise<boolean>;
}

const DEFAULT_TIMEOUT_MS = 10000;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000;

export function createHealthChecker(): HealthChecker {
  const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    });

  return {
    async verify(projectConfig: ProjectConfig): Promise<HealthCheckResult> {
      const log = logger.child({ projectId: projectConfig.id });
      log.info("Starting health verification");

      const checks: HealthCheckResult["checks"] = [];

      const healthcheckCmd = projectConfig.deployment.healthcheckCommand;
      const startTime = Date.now();

      try {
        const [cmd = "", ...args] = healthcheckCmd.split(" ");
        const { stdout } = await execFileAsync(cmd, args, {
          cwd: projectConfig.path,
          timeout: 60000,
        });

        checks.push({
          name: "healthcheck-command",
          passed: true,
          message: stdout.slice(0, 500),
          durationMs: Date.now() - startTime,
        });
      } catch (err) {
        const error = err as Error;
        checks.push({
          name: "healthcheck-command",
          passed: false,
          message: error.message,
          durationMs: Date.now() - startTime,
        });
      }

      const healthy = checks.every((c) => c.passed);

      log.info({ healthy, checkCount: checks.length }, "Health verification complete");

      return { healthy, checks };
    },

    async checkHttp(url: string, timeoutMs?: number): Promise<boolean> {
      const timeout = timeoutMs ?? DEFAULT_TIMEOUT_MS;

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => {
            controller.abort();
          }, timeout);

          const response = await fetch(url, {
            signal: controller.signal,
          });

          clearTimeout(timeoutId);

          if (response.ok) {
            logger.info({ url, attempt }, "HTTP health check passed");
            return true;
          }

          logger.warn(
            { url, status: response.status, attempt },
            "HTTP health check returned non-OK status"
          );
        } catch (err) {
          const error = err as Error;
          logger.warn(
            { url, attempt, err: error.message },
            "HTTP health check failed"
          );
        }

        if (attempt < MAX_RETRIES) {
          await sleep(RETRY_DELAY_MS);
        }
      }

      return false;
    },
  };
}
