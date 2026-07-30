import { z } from "zod";

const deploymentPolicySchema = z.enum([
  "direct-prod",
  "staging-first",
  "manual-prod",
]);

const projectConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  path: z.string().min(1),
  deployment: z.object({
    policy: deploymentPolicySchema,
    testCommand: z.string().min(1),
    lintCommand: z.string().min(1),
    typecheckCommand: z.string().min(1),
    buildCommand: z.string().min(1),
    deployCommand: z.string().min(1),
    healthcheckCommand: z.string().min(1),
    rollbackCommand: z.string().min(1),
  }),
  concurrency: z
    .object({
      maxWriteTasks: z.number().int().positive().default(1),
      maxReadonlyTasks: z.number().int().positive().default(3),
    })
    .default({}),
  agent: z
    .object({
      defaultModel: z.string().default("qwen3.8"),
      maxAttempts: z.number().int().positive().default(3),
      maxRuntimeMinutes: z.number().int().positive().default(90),
      maxTicketCostUsd: z.number().positive().default(8),
    })
    .default({}),
  permissions: z
    .object({
      allowedServices: z.array(z.string()).default([]),
      prohibitedActions: z.array(z.string()).default([]),
    })
    .default({}),
  risk: z
    .object({
      approvalRequiredFor: z.array(z.string()).default([]),
    })
    .default({}),
});

export interface ProjectConfig {
  id: string;
  name: string;
  path: string;
  deployment: {
    policy: "direct-prod" | "staging-first" | "manual-prod";
    testCommand: string;
    lintCommand: string;
    typecheckCommand: string;
    buildCommand: string;
    deployCommand: string;
    healthcheckCommand: string;
    rollbackCommand: string;
  };
  concurrency: {
    maxWriteTasks: number;
    maxReadonlyTasks: number;
  };
  agent: {
    defaultModel: string;
    maxAttempts: number;
    maxRuntimeMinutes: number;
    maxTicketCostUsd: number;
  };
  permissions: {
    allowedServices: string[];
    prohibitedActions: string[];
  };
  risk: {
    approvalRequiredFor: string[];
  };
}

export function parseProjectConfig(data: unknown): ProjectConfig {
  const result = projectConfigSchema.safeParse(data);

  if (!result.success) {
    const errors = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Project configuration validation failed:\n${errors}`);
  }

  return result.data;
}
