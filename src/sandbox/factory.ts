import { existsSync } from "node:fs";
import pino from "pino";
import type { Sandbox, SandboxConfig } from "./types.js";
import { createDockerSandbox } from "./docker.js";
import { createSeatbeltSandbox } from "./seatbelt.js";
import { createUnsafeSandbox } from "./unsafe.js";

const logger = pino({ name: "nightforge-sandbox-factory" });

export const DEFAULT_SANDBOX_CONFIG: SandboxConfig = {
  mode: "auto",
  dockerImage: "node:22-alpine",
  memoryMb: 1024,
  cpus: 1,
  networkEnabled: false,
  timeoutMs: 300_000,
};

function dockerAvailable(): boolean {
  return existsSync("/usr/bin/docker") || existsSync("/usr/local/bin/docker");
}

function seatbeltAvailable(): boolean {
  return process.platform === "darwin" && existsSync("/usr/bin/sandbox-exec");
}

/**
 * Resolve the effective sandbox mode from the config, auto-detecting the
 * strongest backend available on this platform.
 */
export function resolveSandboxMode(config: SandboxConfig): SandboxConfig {
  if (config.mode !== "auto") return config;

  if (dockerAvailable()) {
    logger.info("Auto-selected Docker sandbox backend");
    return { ...config, mode: "docker" };
  }
  if (seatbeltAvailable()) {
    logger.info("Auto-selected macOS Seatbelt sandbox backend");
    return { ...config, mode: "seatbelt" };
  }

  logger.warn(
    "No sandbox backend available (no Docker, no sandbox-exec). " +
      "Falling back to unsafe mode — agent commands run with full host access."
  );
  return { ...config, mode: "unsafe" };
}

export function createSandbox(config: SandboxConfig): Sandbox {
  const resolved = resolveSandboxMode(config);

  switch (resolved.mode) {
    case "docker":
      return createDockerSandbox(resolved);
    case "seatbelt":
      return createSeatbeltSandbox(resolved);
    case "unsafe":
      return createUnsafeSandbox(resolved);
    default:
      throw new Error(`Unknown sandbox mode: ${resolved.mode}`);
  }
}