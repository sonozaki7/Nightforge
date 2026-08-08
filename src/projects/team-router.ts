import { readdirSync } from "node:fs";
import pino from "pino";
import { loadProjectConfig } from "./project-loader.js";

const logger = pino({ name: "nightforge-team-router" });

/**
 * Maps Linear team identifiers to Nightforge project ids. Each project's
 * `.nightforge/project.yaml` declares `linearTeams`; scanning the projects
 * dir builds the routing table. A ticket from a team with no mapping falls
 * back to the default project id.
 */
export interface TeamRouter {
  /** Resolve the project id for a Linear team id/name, or null if unmapped. */
  resolveProjectForTeam(team: string): string | null;
  /** All project ids visible under the projects dir. */
  listProjects(): string[];
}

export function createTeamRouter(projectsDir: string): TeamRouter {
  const table = new Map<string, string>();

  let entries: string[] = [];
  try {
    entries = readdirSync(projectsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    logger.warn({ projectsDir }, "Projects dir unreadable");
  }

  for (const projectId of entries) {
    const config = loadProjectConfig(projectsDir, projectId);
    for (const team of config.linearTeams) {
      const key = team.trim().toLowerCase();
      if (key !== "") {
        table.set(key, config.id);
      }
    }
  }

  return {
    resolveProjectForTeam(team: string): string | null {
      const normalized = team.trim().toLowerCase();
      return table.get(normalized) ?? null;
    },
    listProjects(): string[] {
      return [...entries];
    },
  };
}