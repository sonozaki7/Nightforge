import pino from "pino";
import type { LinearClient } from "../integrations/linear.js";

const logger = pino({ name: "nightforge-onboarding" });

/** The single console ticket seeded into the Nightforge Control team. */
export const CONTROL_TUTORIAL_ISSUES: Array<{
  title: string;
  description: string;
}> = [
  {
    title: "🏠 Nightforge Home — run commands here",
    description: `## You don't need to create tickets — this is Nightforge's chat console

This single ticket is how you talk to Nightforge. Type a command in the comments below and press enter — Nightforge replies right here in the thread.

## What is Nightforge?

Nightforge is your AI teammate. It reads your commands, does the work, and replies on the ticket. It manages your projects: adding a GitHub repo, listing your projects, showing every repo on your GitHub account, checking status, and more.

## What is this team for?

This is the **Nightforge Control** team — Nightforge's own control panel. Normally you only ever use this one ticket here. This team can't be deleted because it literally runs Nightforge.

## The golden rule

1. Open this ticket (Nightforge Home).
2. Type a command in the comments.
3. Wait for the ⚙️ reply.

## Every command

| What you want | What to type in the comments |
|---|---|
| See your projects | \`project list\` |
| See all your GitHub repos | \`project discover\` |
| Add a repo by its name | \`browser-use\` (just the repo name) |
| Add a repo by pasting its URL | paste \`https://github.com/owner/name\` |
| Add a repo the explicit way | \`project add https://github.com/owner/name\` |
| Check a project's status | \`project status project-name\` |
| Remove a project | \`project remove project-name\` |
| Get help | \`help\` |

## Try it right now

Type \`help\` in the comments below — Nightforge will reply with everything it can do.

## The old way still works

You can still create a brand-new ticket with a command title and move it to **Ready for AI** — that always works too. The comment way is just faster.`,
  },
];

const HOME_TITLE = "🏠 Nightforge Home — run commands here";

/** True when the issue title matches a legacy seeded tutorial ticket. */
const isOldTutorial = (title: string): boolean =>
  title.startsWith("📚 Tutorial:") ||
  title === "👋 Welcome to Nightforge — start here";

/**
 * Best-effort seeding of the single console ticket into the Nightforge
 * Control team. Never throws: any Linear failure is logged and returns 0 so
 * startup is never blocked. Creates the Home ticket when missing and archives
 * legacy tutorial tickets that are no longer part of the list.
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

    let archived = 0;
    for (const issue of existing) {
      if (issue.title !== HOME_TITLE && isOldTutorial(issue.title)) {
        await linearClient.archiveIssue(issue.id);
        archived += 1;
      }
    }

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
      { teamId: match.id, created, skipped, archived },
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

/**
 * Best-effort wiring of the control team's webhook so it also delivers
 * Comment events (the "chat console"). Creates the webhook when missing,
 * upgrades its resourceTypes when it lacks Comment, and never throws.
 */
export async function ensureControlCommentWebhook(
  linearClient: LinearClient,
  controlTeam: string,
  publicBaseUrl: string,
  webhookSecret: string
): Promise<void> {
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
        "Control team not found for comment webhook setup"
      );
      return;
    }

    const webhooks = await linearClient.listWebhooks(match.id);
    const found = webhooks.find((webhook) => {
      const label = webhook.label.toLowerCase();
      return (
        label.includes("nightforge-control") ||
        label.includes(controlTeam.toLowerCase())
      );
    });

    if (found !== undefined) {
      if (!found.resourceTypes.includes("Comment")) {
        await linearClient.updateWebhook({
          webhookId: found.id,
          resourceTypes: ["Issue", "Comment"],
        });
        logger.info(
          { teamId: match.id, webhookId: found.id },
          "Control webhook updated to include Comment events"
        );
      } else {
        logger.info(
          { teamId: match.id, webhookId: found.id },
          "Control webhook already includes Comment events"
        );
      }
      return;
    }

    const webhookUrl = `${publicBaseUrl.replace(/\/$/, "")}/webhooks/linear`;
    await linearClient.createWebhook({
      teamId: match.id,
      url: webhookUrl,
      label: "nightforge-control",
      secret: webhookSecret,
    });
    logger.info(
      { teamId: match.id },
      "Control webhook created with Comment events"
    );
  } catch (err) {
    logger.warn(
      { err: (err as Error).message },
      "Control comment webhook setup failed"
    );
  }
}