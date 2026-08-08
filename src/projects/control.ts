import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { cp, mkdir, rm } from "node:fs/promises";
import { readdirSync } from "node:fs";
import path from "node:path";
import { parse, stringify } from "yaml";
import pino from "pino";
import type { LinearClient, LinearTeam } from "../integrations/linear.js";
import { addProject, parseRepoUrl, slugify } from "../cli/project-add.js";
import { loadProjectConfig } from "./project-loader.js";
import { parseProjectConfig } from "./registry.js";

const logger = pino({ name: "nightforge-project-control" });

/** A parsed project-management command from a Linear ticket. */
export type ControlCommand =
  | {
      kind: "add";
      /**
       * Full cloneable URL. Exactly one of repoUrl / repoName is set:
       * repoUrl is used directly, repoName needs GitHub resolution.
       */
      repoUrl?: string;
      /** Bare repo name or owner/name that needs GitHub resolution. */
      repoName?: string;
      teamName: string;
    }
  | { kind: "remove"; projectId: string }
  | { kind: "list" }
  | { kind: "discover" }
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
  /**
   * GitHub token used to list repos on the account. When unset, the
   * `discover` command reports that GitHub listing is unavailable.
   */
  githubToken?: string;
}

export interface ProjectControl {
  /**
   * Run a control command and return the Linear comment to post back.
   * Never throws — failures become a clear reply on the ticket.
   */
  run(command: ControlCommand): Promise<string>;
}

/**
 * Words that never become a bare-name "add" command. A ticket titled just
 * "status" or "list" is a mistake, not a request to add a project.
 */
const COMMAND_WORDS = new Set([
  "list",
  "discover",
  "status",
  "remove",
  "delete",
  "rm",
  "help",
  "add",
  "link",
  "project",
]);

/** Convert a ticket title+description into a project command. */
export function parseControlCommand(text: string): ControlCommand {
  const t = text.trim().replace(/\s+/g, " ");

  // 1. Explicit add with a full URL — highest priority, keeps old behavior.
  const addUrlMatch = t.match(
    /^(?:project\s+)?add\s+(?:project\s+)?(https?:\/\/\S+|git@[^\s]+)/i
  );
  if (addUrlMatch) {
    const repoUrl = addUrlMatch[1];
    const parsed = parseRepoUrl(repoUrl);
    const teamName = parsed?.name ?? "New Project";
    return { kind: "add", repoUrl, teamName };
  }

  // 2. Explicit add with a name or owner/name (e.g. `add browser-use`).
  const addNameMatch = t.match(
    /^(?:project\s+)?add\s+(?:project\s+)?([a-zA-Z0-9][a-zA-Z0-9._-]*(?:\/[a-zA-Z0-9][a-zA-Z0-9._-]*)?)$/i
  );
  if (addNameMatch) {
    const ref = addNameMatch[1];
    const namePart = ref.split("/").pop() ?? ref;
    return { kind: "add", repoName: ref, teamName: namePart };
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

  if (/^(?:project\s+)?discover\s*$/i.test(t)) {
    return { kind: "discover" };
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

  // 4. A bare pasted URL is an add.
  const bareUrlMatch = t.match(/^(https?:\/\/\S+|git@[^\s]+)$/i);
  if (bareUrlMatch) {
    const repoUrl = bareUrlMatch[1];
    const parsed = parseRepoUrl(repoUrl);
    const teamName = parsed?.name ?? "New Project";
    return { kind: "add", repoUrl, teamName };
  }

  // 5. A bare repo name or owner/name is an add — unless it is (or starts
  // with) a known command word, in which case it falls through to help.
  const bareNameMatch = t.match(
    /^([a-zA-Z0-9][a-zA-Z0-9._-]*)(?:\/([a-zA-Z0-9][a-zA-Z0-9._-]*))?$/
  );
  if (bareNameMatch) {
    const first = bareNameMatch[1];
    if (COMMAND_WORDS.has(first.toLowerCase())) {
      return { kind: "help" };
    }
    const parts = t.split("/");
    const teamName = parts.pop() ?? t;
    return { kind: "add", repoName: t, teamName };
  }

  // Command-like but unrecognized → treat as help so the user learns formats.
  if (/^(?:project\s+)?(add|remove|delete|link|status|list|discover)/i.test(t)) {
    return { kind: "help" };
  }

  return { kind: "help" };
}

export const HELP_TEXT = `New here? You can run any command as a COMMENT on the "🏠 Nightforge Home" ticket — no need to create a new ticket.

New here? Open the "👋 Welcome to Nightforge — start here" ticket in this team.

Commands (create a ticket here, move it to "Ready for AI") — or run any of them as a comment on the Home ticket:

Add a project — any of these work:
- paste the repo URL (e.g. https://github.com/sonozaki7/browser-use)
- just the repo name (e.g. browser-use)
- owner/name (e.g. sonozaki7/browser-use)
- the explicit way (always works): project add <repo-url>

project remove <project-id>
project list
project discover
project status <project-id>
project link <source>:<path> -> <target>
  e.g. project link taviaverify:src/lib.ts -> nightforge
`;

/**
 * Resolve a bare repo name (or owner/name) to a full GitHub repository.
 * Uses the GitHub API with the given token. Returns null when the repo
 * cannot be uniquely identified. Never logs or returns the token.
 */
export async function resolveRepoRef(
  token: string,
  ref: string
): Promise<{ url: string; fullName: string } | null> {
  if (token === "") {
    return null;
  }

  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
  };

  // owner/name form → hit the repo endpoint directly.
  if (ref.includes("/")) {
    const response = await fetch(
      `https://api.github.com/repos/${ref}`,
      { headers }
    );
    if (!response.ok) {
      return null;
    }
    const repo = (await response.json()) as {
      clone_url?: string;
      full_name?: string;
    };
    return {
      url: repo.clone_url ?? `https://github.com/${ref}`,
      fullName: repo.full_name ?? ref,
    };
  }

  // Bare name → search the authenticated user's own repos.
  const response = await fetch(
    "https://api.github.com/user/repos?per_page=100",
    { headers }
  );
  if (!response.ok) {
    return null;
  }
  const repos = (await response.json()) as Array<{
    name?: string;
    full_name?: string;
    clone_url?: string;
  }>;
  const matches = repos.filter(
    (repo) => (repo.name ?? "").toLowerCase() === ref.toLowerCase()
  );
  if (matches.length !== 1) {
    // Zero matches, or several repos with the same name under different
    // owners — ambiguous. Ask for owner/name instead.
    return null;
  }
  const repo = matches[0];
  const fullName = repo.full_name ?? ref;
  return {
    url: repo.clone_url ?? `https://github.com/${fullName}`,
    fullName,
  };
}

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
    let repoUrl = command.repoUrl;
    if (repoUrl === undefined && command.repoName !== undefined) {
      const token = deps.githubToken ?? "";
      if (token === "") {
        return "❌ Can't look up that repo name — GitHub isn't connected. Paste the full URL instead (e.g. https://github.com/owner/name).";
      }
      const resolved = await resolveRepoRef(token, command.repoName);
      if (resolved === null) {
        return `❌ Couldn't find a repo named **${command.repoName}** on your GitHub account. Try \`project discover\` or paste the full URL.`;
      }
      repoUrl = resolved.url;
    }
    if (repoUrl === undefined) {
      return "❌ No repo URL given. Paste the full URL or give a repo name.";
    }

    const result = await addProject(deps.projectsDir, repoUrl, deps.githubToken);
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
- Add it back anytime by pasting the repo URL or typing its name.`;
  };

  const cmdList = (): string => {
    const ids = listProjectIds();
    if (ids.length === 0) {
      return "No projects registered yet. Add one by pasting a repo URL or typing a repo name.";
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

  const cmdDiscover = async (): Promise<string> => {
    const token = deps.githubToken ?? "";
    if (token === "") {
      return "❌ GitHub listing is not enabled. Ask the owner to set GITHUB_TOKEN.";
    }

    const response = await fetch("https://api.github.com/user/repos?per_page=100", {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      logger.warn(
        { status: response.status },
        "GitHub repo listing failed"
      );
      return `❌ Could not list GitHub repos (HTTP ${String(response.status)}). Check that GITHUB_TOKEN has repo read access.`;
    }

    const repos = (await response.json()) as Array<{
      full_name?: string;
      html_url?: string;
    }>;
    const registered = new Set(listProjectIds());
    const entries = repos
      .map((repo) => {
        const name = (repo.full_name ?? "").split("/").pop() ?? "";
        const isAdded = name !== "" && registered.has(slugify(name));
        return `- ${repo.full_name ?? "unknown"}${isAdded ? " ✅ added" : ""}`;
      })
      .sort();

    if (entries.length === 0) {
      return "No GitHub repos found on this account.";
    }

    return `GitHub repos on this account:\n\n${entries.join("\n")}\n\n_Add one by replying with just its name (e.g. \`browser-use\`) or pasting the URL._`;
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
          case "discover":
            return await cmdDiscover();
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