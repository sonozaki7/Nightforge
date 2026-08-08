import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import pino from "pino";
import { parseProjectConfig } from "../projects/registry.js";

const execFileAsync = promisify(execFile);
const logger = pino({ name: "nightforge-project-add" });

export interface AddProjectResult {
  success: boolean;
  projectId: string;
  repoPath: string;
  message: string;
}

/** Parse a GitHub/GitLab remote URL into { host, owner, name } or null. */
export function parseRepoUrl(url: string): {
  host: string;
  owner: string;
  name: string;
} | null {
  const trimmed = url.trim().replace(/\.git$/, "");

// Local path / file:// URLs (used in tests and local work).
  let match = trimmed.match(/^file:\/\/(.+)$/);
  if (match) {
    return { host: "local", owner: "", name: path.basename(match[1]) };
  }

  match = trimmed.match(
    /^(?:https?:\/\/)?(?:[^@/]+@)?([^/:]+)[/:]([^/]+)\/([^/]+)$/
  );
  if (match) {
    return { host: match[1], owner: match[2], name: match[3] };
  }

  return null;
}

/** Detect npm/git project type from the repo root. */
export function detectProjectType(repoPath: string): "node" | "other" {
  return existsSync(path.join(repoPath, "package.json")) ? "node" : "other";
}

/** Guess a safe project id (kebab-case) from a repo name. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Build a .nightforge/project.yaml that generates a valid config. */
export function renderProjectYaml(
  projectId: string,
  name: string,
  repoPath: string,
  type: "node" | "other"
): string {
  const nodeSection =
    type === "node"
      ? `  testCommand: npm test
  lintCommand: npm run lint
  typecheckCommand: npx tsc --noEmit
  buildCommand: npm run build`
      : `  testCommand: echo "no tests"
  lintCommand: echo "no lint"
  typecheckCommand: echo "no typecheck"
  buildCommand: echo "no build"`;

  return `id: ${projectId}
name: ${name}
path: ${repoPath}
linearTeams: []

deployment:
  policy: direct-prod
${nodeSection}
  deployCommand: echo "deploy"
  healthcheckCommand: echo "health"
  rollbackCommand: echo "rollback"

concurrency:
  maxWriteTasks: 1
  maxReadonlyTasks: 3

agent:
  defaultModel: qwen3.8
  maxAttempts: 3
  maxRuntimeMinutes: 90
  maxTicketCostUsd: 8

permissions:
  allowedServices: []
  prohibitedActions:
    - rotate-production-secrets
    - delete-production-database
    - disable-authentication

risk:
  approvalRequiredFor:
    - billing
    - authentication
    - destructive-migration
`;
}

export async function addProject(
  projectsDir: string,
  repoUrl: string,
  githubToken = ""
): Promise<AddProjectResult> {
  const parsed = parseRepoUrl(repoUrl);
  if (parsed === null) {
    return {
      success: false,
      projectId: "",
      repoPath: "",
      message: `Could not parse repository URL: ${repoUrl}`,
    };
  }

  const projectId = slugify(parsed.name);
  const repoPath = path.join(projectsDir, projectId);

  if (existsSync(repoPath)) {
    return {
      success: false,
      projectId,
      repoPath,
      message: `A project already exists at ${repoPath}`,
    };
  }

  try {
    mkdirSync(projectsDir, { recursive: true });
    // For private repos, use a credential helper that reads an env var. This
    // authenticates the clone WITHOUT putting the token in the URL or argv
    // (which would leak it into process listings or .git/config). With no
    // token, clone exactly as before (tests use local file:// repos).
    const credentialArgs: string[] = [];
    if (githubToken !== "") {
      credentialArgs.push(
        "-c",
        "credential.helper=!f() { echo username=x-access-token; echo \"password=$NF_GIT_TOKEN\"; }; f"
      );
    }
    const env =
      githubToken !== ""
        ? { ...process.env, NF_GIT_TOKEN: githubToken }
        : undefined;
    await execFileAsync(
      "git",
      [...credentialArgs, "clone", "--quiet", repoUrl, repoPath],
      {
        timeout: 300000,
        ...(env !== undefined ? { env } : {}),
      }
    );
  } catch (err) {
    const error = err as Error;
    logger.error({ err: error.message }, "Clone failed");
    return {
      success: false,
      projectId,
      repoPath,
      message: `Clone failed: ${error.message}`,
    };
  }

  const type = detectProjectType(repoPath);
  const yamlDir = path.join(repoPath, ".nightforge");
  mkdirSync(yamlDir, { recursive: true });
  const yamlContent = renderProjectYaml(
    projectId,
    parsed.name,
    repoPath,
    type
  );
  writeFileSync(path.join(yamlDir, "project.yaml"), yamlContent);

  // Validate the generated config parses before reporting success.
  try {
    const raw: unknown = parse(yamlContent);
    parseProjectConfig(raw);
  } catch (err) {
    const error = err as Error;
    return {
      success: false,
      projectId,
      repoPath,
      message: `Generated project.yaml is invalid: ${error.message}`,
    };
  }

  logger.info({ projectId, repoPath }, "Project added");
  return {
    success: true,
    projectId,
    repoPath,
    message: `Added project ${projectId} (${parsed.host}) at ${repoPath}`,
  };
}

const invokedDirectly = process.argv[1].endsWith("project-add.ts");
if (invokedDirectly) {
  const projectsDir = process.env.PROJECTS_DIR ?? "/srv/apps";
  const repoUrl = process.argv[2];
  if (!repoUrl) {
    console.error("usage: nightforge project add <repo-url>");
    process.exit(2);
  }
  void addProject(projectsDir, repoUrl).then((result) => {
    console.log(result.message);
    process.exitCode = result.success ? 0 : 1;
  });
}