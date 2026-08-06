import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import pino from "pino";
import { parseProjectConfig, type ProjectConfig } from "./registry.js";
import { buildDefaultProjectConfig } from "./default-config.js";

const logger = pino({ name: "nightforge-project-loader" });

/**
 * Resolves the runtime config for a project. Projects live at
 * `<projectsDir>/<projectId>`; a `.nightforge/project.yaml` inside the repo
 * customizes deployment/gates, otherwise safe defaults apply. The resolved
 * `path` always points at the repo location — the runtime owns layout truth,
 * not the checked-in yaml.
 */
export function loadProjectConfig(
  projectsDir: string,
  projectId: string
): ProjectConfig {
  const repoPath = path.join(projectsDir, projectId);
  const yamlPath = path.join(repoPath, ".nightforge", "project.yaml");

  if (!existsSync(yamlPath)) {
    return buildDefaultProjectConfig(projectId, repoPath);
  }

  try {
    const parsed: unknown = parse(readFileSync(yamlPath, "utf8"));
    const config = parseProjectConfig(parsed);
    return { ...config, path: repoPath };
  } catch (err) {
    const error = err as Error;
    logger.warn(
      { projectId, yamlPath, err: error.message },
      "project.yaml invalid — falling back to defaults"
    );
    return buildDefaultProjectConfig(projectId, repoPath);
  }
}

/** Repo checkout location for a project id. */
export function repoPathFor(projectsDir: string, projectId: string): string {
  return path.join(projectsDir, projectId);
}
