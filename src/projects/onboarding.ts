import pino from "pino";
import type { LinearClient } from "../integrations/linear.js";

const logger = pino({ name: "nightforge-onboarding" });

/** Pre-existing tutorial issues seeded into the Nightforge Control team. */
export const CONTROL_TUTORIAL_ISSUES: Array<{
  title: string;
  description: string;
}> = [
  {
    title: "👋 Welcome to Nightforge — start here",
    description: `## What is Nightforge?

Nightforge is your AI teammate. When you create a ticket here and move it to **Ready for AI**, Nightforge reads it, does the work, and replies on the ticket when it's done.

## What is THIS team for?

This is the **Nightforge Control** team — the control panel for Nightforge itself. Tickets in this team are *commands* that manage projects (add one, see your projects, check status, remove). They are **not** coding jobs.

## The golden rule

1. Create a new issue in this team.
2. Set the title to a command.
3. Move it to **Ready for AI**.
4. Wait for the ⚙️ reply on the ticket.

## Try this

Give any of these tutorial tickets a try — each one teaches a command:

- 📚 Tutorial: Add a project (3 easy ways)
- 📚 Tutorial: See your projects
- 📚 Tutorial: See your GitHub repos
- 📚 Tutorial: Remove a project
- 📚 Tutorial: Check a project's status
- 📚 Tutorial: Get help

> This team runs Nightforge itself, so it can't be deleted. That's by design — it's the safe, permanent home for managing your projects.

---

1. Create a new issue in this team.
2. Set the title to: \`help\`
3. Move it to Ready for AI.
4. Wait for the ⚙️ reply.`,
  },
  {
    title: "📚 Tutorial: Add a project (3 easy ways)",
    description: `## What is a "project"?

A project is a GitHub repository that Nightforge works on. Think of it as Nightforge's desk — the code it reads, edits, and ships for you.

## Three easy ways to add one

Create a ticket in this team and set its title to any of these:

1. Paste the repo URL, e.g. \`https://github.com/sonozaki7/browser-use\`
2. Just the repo name, e.g. \`browser-use\`
3. Owner/name, e.g. \`sonozaki7/browser-use\`

Private repos work too — Nightforge uses your GitHub connection, so your private code stays safe.

## The always-works way

If a shortcut ever seems to misbehave, use the explicit form — it always works:

\`project add https://github.com/sonozaki7/browser-use\`

## What happens next

After you move the ticket to **Ready for AI**, Nightforge will:

1. Clone the repo into its workspace
2. Create a matching Linear team for it
3. Wire the team's webhook so tickets there reach Nightforge

Then it replies on your ticket with the details.

---

1. Create a new issue in this team.
2. Set the title to: \`project add https://github.com/sonozaki7/browser-use\`
3. Move it to Ready for AI.
4. Wait for the ⚙️ reply.`,
  },
  {
    title: "📚 Tutorial: See your projects",
    description: `## What does this do?

\`project list\` shows every project Nightforge already has in its workspace.

Create a ticket with the title \`project list\` and move it to **Ready for AI**. Nightforge replies with something like:

\`\`\`
Registered projects:

- my-app
- browser-use
\`\`\`

If nothing is registered yet, it will tell you how to add your first one.

---

1. Create a new issue in this team.
2. Set the title to: \`project list\`
3. Move it to Ready for AI.
4. Wait for the ⚙️ reply.`,
  },
  {
    title: "📚 Tutorial: See your GitHub repos",
    description: `## What does this do?

\`project discover\` lists every repo on your connected GitHub account, and marks the ones Nightforge has already added with a ✅.

Create a ticket with the title \`project discover\` and move it to **Ready for AI**. Nightforge replies with your list, e.g.:

\`\`\`
GitHub repos on this account:

- sonozaki7/browser-use ✅ added
- sonozaki7/another-project
\`\`\`

## Add one from the list

Create a new ticket with just the repo's name or URL and Nightforge will add it.

---

1. Create a new issue in this team.
2. Set the title to: \`project discover\`
3. Move it to Ready for AI.
4. Wait for the ⚙️ reply.`,
  },
  {
    title: "📚 Tutorial: Remove a project",
    description: `## What does this do?

\`project remove <name>\` removes a project from Nightforge's workspace.

⚠️ Important: this only deletes Nightforge's working copy of the code. Your GitHub repo is **untouched and safe** — your code stays on GitHub exactly as it was.

Create a ticket with the title \`project remove my-app\` (use the real project name — see \`project list\`) and move it to **Ready for AI**.

You can add the project back at any time.

---

1. Create a new issue in this team.
2. Set the title to: \`project remove my-app\`
3. Move it to Ready for AI.
4. Wait for the ⚙️ reply.`,
  },
  {
    title: "📚 Tutorial: Check a project's status",
    description: `## What does this do?

\`project status <name>\` shows a snapshot of a project: where its code lives, its deployment policy, how many releases are on disk, and which AI model it uses by default.

Create a ticket with the title \`project status my-app\` (use the real project name — see \`project list\`) and move it to **Ready for AI**. Nightforge replies with a short status report.

---

1. Create a new issue in this team.
2. Set the title to: \`project status my-app\`
3. Move it to Ready for AI.
4. Wait for the ⚙️ reply.`,
  },
  {
    title: "📚 Tutorial: Get help",
    description: `## What does this do?

\`help\` makes Nightforge reply with the full command list, so you always know what you can do.

Create a ticket with the title \`help\` and move it to **Ready for AI**.

## Also check out the other tutorials in this team

- 👋 Welcome to Nightforge — start here
- 📚 Tutorial: Add a project (3 easy ways)
- 📚 Tutorial: See your projects
- 📚 Tutorial: See your GitHub repos
- 📚 Tutorial: Remove a project
- 📚 Tutorial: Check a project's status

---

1. Create a new issue in this team.
2. Set the title to: \`help\`
3. Move it to Ready for AI.
4. Wait for the ⚙️ reply.`,
  },
];

/**
 * Best-effort seeding of tutorial issues into the Nightforge Control team.
 * Never throws: any Linear failure is logged and returns 0 so startup is
 * never blocked. Skips issues whose title already exists (case-insensitive).
 */
export async function seedControlOnboarding(
  linearClient: LinearClient,
  controlTeam: string
): Promise<number> {
  try {
    const teams = await linearClient.listTeams();
    const match = teams.find(
      (team) =>
        team.id === controlTeam ||
        team.name.toLowerCase() === controlTeam.toLowerCase()
    );
    if (match === undefined) {
      logger.warn(
        { controlTeam },
        "Control team not found for onboarding seeding"
      );
      return 0;
    }

    const existing = await linearClient.listTeamIssues(match.id);
    const existingTitles = new Set(
      existing.map((issue) => issue.title.toLowerCase())
    );

    const states = await linearClient.listTeamStates(match.id);
    const unstarted = states.filter((state) => state.type === "unstarted");
    const firstUnstarted = unstarted.length > 0 ? unstarted[0] : undefined;
    const todoState =
      unstarted.find((state) => /todo/i.test(state.name)) ?? firstUnstarted;
    const stateId = todoState?.id;
    if (stateId !== undefined) {
      logger.info(
        { teamId: match.id, stateName: todoState?.name },
        "Control onboarding will seed into a visible Todo state"
      );
    } else {
      logger.warn(
        { teamId: match.id },
        "No unstarted Todo state found; seeding into the team default state"
      );
    }

    let created = 0;
    let skipped = 0;
    for (const tutorial of CONTROL_TUTORIAL_ISSUES) {
      if (existingTitles.has(tutorial.title.toLowerCase())) {
        skipped += 1;
        continue;
      }
      await linearClient.createIssue({
        teamId: match.id,
        title: tutorial.title,
        description: tutorial.description,
        ...(stateId !== undefined ? { stateId } : {}),
      });
      created += 1;
    }

    logger.info(
      { teamId: match.id, created, skipped },
      "Control onboarding seeded"
    );
    return created;
  } catch (err) {
    logger.warn(
      { err: (err as Error).message },
      "Control onboarding seeding failed"
    );
    return 0;
  }
}