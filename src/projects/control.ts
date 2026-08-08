import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { cp, mkdir, rm } from "node:fs/promises";
import { readdirSync } from "node:fs";
import path from "node:path";
import { parse, stringify } from "yaml";
import pino from "pino";
import type { LinearClient, LinearTeam } from "../integrations/linear.js";
import { addProject, parseRepoUrl } from "../cli/project-add.js";
import { loadProjectConfig } from "./project-loader.js";
import { parseProjectConfig } from "./registry.js";

const logger = pino({ name: "nightforge-project-control" });

/** A parsed project-management command from a Linear ticket. */
export type ControlCommand =
  | { kind: "add"; repoUrl: string; teamName: string }
  | { kind: "remove"; projectId: string }
  | { kind: "list" }
  | { kind: "status"; projectId: string }
  | {
      kind: "link";
      sourceProject: string;
      filePath: string;
      targetProject: string;
    }
  | { kind: "help" };

export interface ControlDeps {
  linearClient: LinearClient;
  projectsDir: string;
  /** Public base URL of this Nightforge instance (webhook target). */
  publicBaseUrl: string;
  /** Shared Linear webhook secret — new team webhooks use the same one. */
  webhookSecret: string;
  /** Default project id used when a ticket has no team mapping. */
  defaultProjectId: string;
}

export interface ProjectControl {
  /**
   * Run a control command and return the Linear comment to post back.
   * Never throws — failures become a clear reply on the ticket.
   */
  run(command: ControlCommand): Promise<string>;
}

/** Convert a ticket title+description into a project command. */
export function parseControlCommand(text: string): ControlCommand {
  const t = text.trim().replace(/\s+/g, " ");

  const addMatch = t.match(
    /^(?:project\s+)?add\s+(?:project\s+)?(https?:\/\/\S+|git@[^\s]+)/i
  );
  if (addMatch) {
    const repoUrl = addMatch[1];
    const parsed = parseRepoUrl(repoUrl);
    const teamName = parsed?.name ?? "New Project";
    return { kind: "add", repoUrl, teamName };
  }

  const removeMatch = t.match(
    /^(?:project\s+)?(?:remove|delete|rm)\s+([a-z0-9-]+)/i
  );
  if (removeMatch) {
    return { kind: "remove", projectId: removeMatch[1] };
  }

  if (/^(?:project\s+)?list\s*$/i.test(t)) {
    return { kind: "list" };
  }

  const statusMatch = t.match(
    /^(?:project\s+)?status\s+([a-z0-9-]+)/i
  );
  if (statusMatch) {
    return { kind: "status", projectId: statusMatch[1] };
  }

  const linkMatch = t.match(
    /^(?:project\s+)?link\s+([a-z0-9-]+)[:/]([^\s]+)\s*(?:->|into|to)\s*([a-z0-9-]+)/i
  );
  if (linkMatch) {
    return {
      kind: "link",
      sourceProject: linkMatch[1],
      filePath: linkMatch[2],
      targetProject: linkMatch[3],
    };
  }

  if (/^(?:project\s+)?help\s*$/i.test(t) || /^help$/i.test(t)) {
    return { kind: "help" };
  }

  // Command-like but unrecognized → treat as help so the user learns formats.
  if (/^(?:project\s+)?(add|remove|delete|link|status|list)/i.test(t)) {
    return { kind: "help" };
  }

  return { kind: "help" };
}

export const HELP_TEXT = `Commands (create a ticket here, move it to "Ready for AI"):

project add <repo-url>
  e.g. project add https://github.com/sonozaki7/taviaverify

project remove <project-id>
project list
project status <project-id>
project link <source>:<path> -> <target>
  e.g. project link taviaverify:src/lib.ts -> nightforge
`;

export function createProjectControl(deps: ControlDeps): ProjectControl {
  // `releases` is Nightforge's own storage for shipped releases, not a project.
  const RESERVED_DIRS = new Set(["releases"]);

  const listProjectIds = (): string[] => {
    try {
      return readdirSync(deps.projectsDir, { withFileTypes: true })
        .filter(
          (entry) =>
            entry.isDirectory() && !RESERVED_DIRS.has(entry.name)
        )
        .map((entry) => entry.name);
    } catch {
      return [];
    }
  };

  const projectRepoPath = (projectId: string): string =>
    path.join(deps.projectsDir, projectId);

  const findOrCreateTeam = async (projectId: string): Promise<LinearTeam> => {
    const teams = await deps.linearClient.listTeams();
    const existing = teams.find(
      (team) => team.name.toLowerCase() === projectId.toLowerCase()
    );
    if (existing) {
      return existing;
    }
    return deps.linearClient.createTeam(projectId);
  };

  const wireTeamWebhook = async (team: LinearTeam): Promise<void> => {
    const webhookUrl = `${deps.publicBaseUrl.replace(/\/$/, "")}/webhooks/linear`;
    await deps.linearClient.createWebhook({
      teamId: team.id,
      url: webhookUrl,
      label: `nightforge-${team.name}`,
      secret: deps.webhookSecret,
    });
  };

  const setLinearTeams = (projectId: string, teams: string[]): void => {
    const repoPath = projectRepoPath(projectId);
    const yamlPath = path.join(repoPath, ".nightforge", "project.yaml");
    if (!existsSync(yamlPath)) {
      return;
    }
    const raw: unknown = parse(readFileSync(yamlPath, "utf8"));
    const config = parseProjectConfig(raw);
    const updated = { ...config, linearTeams: teams };
    writeFileSync(yamlPath, stringify(updated), "utf8");
  };

  const cmdAdd = async (command: Extract<ControlCommand, { kind: "add" }>): Promise<string> => {
    const result = await addProject(deps.projectsDir, command.repoUrl);
    if (!result.success) {
      return `❌ ${result.message}`;
    }

    const projectId = result.projectId;
    const team = await findOrCreateTeam(command.teamName);
    await wireTeamWebhook(team);
    setLinearTeams(projectId, [team.id, team.name]);

    logger.info({ projectId, teamId: team.id }, "Project provisioned");
    return `✅ Project **${projectId}** added and ready.

- Code cloned to \`${result.repoPath}\`
- Linear team **${team.name}** ${team.id ? "created/confirmed" : "wired"}
- Webhook attached — tickets in that team now reach Nightforge
- Drop tickets into the "${team.name}" team's "Ready for AI" column.`;
  };

  const cmdRemove = async (projectId: string): Promise<string> => {
    const repoPath = projectRepoPath(projectId);
    if (!existsSync(repoPath)) {
      return `❌ No project named **${projectId}** found. Try \`project list\`.`;
    }
    await rm(repoPath, { recursive: true, force: true });
    logger.info({ projectId }, "Project removed");
    return `✅ Project **${projectId}** removed from Nightforge.

- Working copy deleted from the server
- GitHub repo is untouched and safe
- Add it back anytime with \`project add <repo-url>\``;
  };

  const cmdList = (): string => {
    const ids = listProjectIds();
    if (ids.length === 0) {
      return "No projects registered yet. Add one with `project add <repo-url>`.";
    }
    const lines = ids.map((id) => `- **${id}**`);
    return `Registered projects:\n\n${lines.join("\n")}`;
  };

  const cmdStatus = (projectId: string): string => {
    const repoPath = projectRepoPath(projectId);
    if (!existsSync(repoPath)) {
      return `❌ No project named **${projectId}** found. Try \`project list\`.`;
    }
    const config = loadProjectConfig(deps.projectsDir, projectId);
    const releasesDir = path.join(deps.projectsDir, "releases");
    let releaseCount = 0;
    try {
      releaseCount = readdirSync(releasesDir).length;
    } catch {
      releaseCount = 0;
    }

    return `**${projectId}** status

- Path: \`${repoPath}\`
- Policy: ${config.deployment.policy}
- Linear teams: ${config.linearTeams.length > 0 ? config.linearTeams.join(", ") : "(none)"}
- Releases on disk: ${String(releaseCount)}
- Default model: ${config.agent.defaultModel}`;
  };

  const cmdLink = async (
    command: Extract<ControlCommand, { kind: "link" }>
  ): Promise<string> => {
    const sourcePath = projectRepoPath(command.sourceProject);
    const targetPath = projectRepoPath(command.targetProject);

    if (!existsSync(sourcePath)) {
      return `❌ Source project **${command.sourceProject}** not found.`;
    }
    if (!existsSync(targetPath)) {
      return `❌ Target project **${command.targetProject}** not found.`;
    }

    const resolved = path.resolve(sourcePath, command.filePath);
    if (!resolved.startsWith(path.resolve(sourcePath))) {
      return `❌ Path escapes the source project folder — refused.`;
    }
    if (!existsSync(resolved)) {
      return `❌ \`${command.filePath}\` not found in ${command.sourceProject}.`;
    }

    const destDir = path.join(
      targetPath,
      ".nightforge",
      "references",
      command.sourceProject,
      path.dirname(command.filePath)
    );
    await mkdir(destDir, { recursive: true });
    await cp(resolved, path.join(destDir, path.basename(command.filePath)));

    logger.info(
      { sourceProject: command.sourceProject, targetProject: command.targetProject, filePath: command.filePath },
      "Cross-project reference copied"
    );
    return `✅ Copied \`${command.filePath}\` from **${command.sourceProject}** into **${command.targetProject}**.

It lives at \`.nightforge/references/${command.sourceProject}/${command.filePath}\` so agents can import it without accessing the other project's folder.`;
  };

  return {
    async run(command: ControlCommand): Promise<string> {
      try {
        switch (command.kind) {
          case "add":
            return await cmdAdd(command);
          case "remove":
            return await cmdRemove(command.projectId);
          case "list":
            return cmdList();
          case "status":
            return cmdStatus(command.projectId);
          case "link":
            return await cmdLink(command);
          case "help":
            return HELP_TEXT;
        }
      } catch (err) {
        const error = err as Error;
        logger.error({ err: error.message }, "Control command failed");
        return `❌ Command failed: ${error.message}`;
      }
    },
  };
}