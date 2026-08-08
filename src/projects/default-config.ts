import type { ProjectConfig } from "./registry.js";

/**
 * Builds the runtime ProjectConfig fallback for a ticket job. Used when a
 * project has no `.nightforge/project.yaml`; see project-loader.ts for the
 * per-project lookup.
 */
export function buildDefaultProjectConfig(
  projectId: string,
  repoPath: string
): ProjectConfig {
  return {
    id: projectId,
    name: projectId,
    path: repoPath,
    linearTeams: [],
    deployment: {
      policy: "direct-prod",
      testCommand: "npm test",
      lintCommand: "npm run lint",
      typecheckCommand: "npx tsc --noEmit",
      buildCommand: "npm run build",
      deployCommand: "echo deploy",
      healthcheckCommand: "echo health",
      rollbackCommand: "echo rollback",
    },
    concurrency: { maxWriteTasks: 1, maxReadonlyTasks: 3 },
    agent: {
      defaultModel: "qwen3.8",
      maxAttempts: 3,
      maxRuntimeMinutes: 90,
      maxTicketCostUsd: 8,
    },
    permissions: { allowedServices: [], prohibitedActions: [] },
    risk: { approvalRequiredFor: [] },
  };
}
