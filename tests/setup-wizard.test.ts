import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  defaultAnswers,
  mergeExisting,
  parseEnvFile,
  renderEnvFile,
  runSetupWizard,
  validateAnswers,
} from "../src/cli/setup-wizard.js";

describe("parseEnvFile", () => {
  it("should skip comments and blank lines", () => {
    const values = parseEnvFile("# comment\n\nPORT=3000\nEMPTY=\n");
    expect(values).toEqual({ PORT: "3000", EMPTY: "" });
  });
});

describe("mergeExisting", () => {
  it("should preserve prior values and keep defaults for the rest", () => {
    const merged = mergeExisting(defaultAnswers(), {
      LINEAR_API_KEY: "old-key",
      PORT: "8080",
    });
    expect(merged.linearApiKey).toBe("old-key");
    expect(merged.port).toBe("8080");
    expect(merged.redisUrl).toBe("redis://localhost:6379");
  });
});

describe("validateAnswers", () => {
  it("should reject the untouched defaults", () => {
    const errors = validateAnswers(defaultAnswers());
    expect(errors).toContain("LINEAR_API_KEY is required");
    expect(errors).toContain("LINEAR_WEBHOOK_SECRET is required");
    expect(errors.length).toBe(3);
  });

  it("should accept a minimal valid configuration", () => {
    const answers = {
      ...defaultAnswers(),
      linearApiKey: "k",
      linearWebhookSecret: "s",
      dashscopeApiKey: "ds",
    };
    expect(validateAnswers(answers)).toEqual([]);
  });

  it("should reject a non-numeric port", () => {
    const answers = {
      ...defaultAnswers(),
      linearApiKey: "k",
      linearWebhookSecret: "s",
      anthropicApiKey: "a",
      port: "abc",
    };
    expect(validateAnswers(answers)).toContain("PORT must be a number");
  });
});

describe("renderEnvFile", () => {
  it("should emit every managed key", () => {
    const text = renderEnvFile(defaultAnswers());
    for (const key of ["REDIS_URL", "LINEAR_API_KEY", "PORT", "PROJECTS_DIR"]) {
      expect(text).toContain(`${key}=`);
    }
  });
});

describe("runSetupWizard", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "nightforge-setup-"));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("should write a valid .env when required values exist", async () => {
    const target = join(dir, "fresh.env");
    await writeFile(
      target,
      "LINEAR_API_KEY=k\nLINEAR_WEBHOOK_SECRET=s\nDASHSCOPE_API_KEY=ds\n"
    );
    const code = await runSetupWizard(target, true);
    expect(code).toBe(0);
    const written = await readFile(target, "utf8");
    expect(written).toContain("LINEAR_API_KEY=k");
    expect(written).toContain("REDIS_URL=redis://localhost:6379");
  });

  it("should refuse to overwrite without --force", async () => {
    const target = join(dir, "protected.env");
    await writeFile(target, "PORT=1234\n");
    const code = await runSetupWizard(target, false);
    expect(code).toBe(1);
    expect(await readFile(target, "utf8")).toBe("PORT=1234\n");
  });

  it("should fail validation when required secrets are missing", async () => {
    const target = join(dir, "incomplete.env");
    const code = await runSetupWizard(target, false);
    expect(code).toBe(1);
  });
});
