import { describe, it, expect, vi } from "vitest";
import {
  seedControlOnboarding,
  ensureControlCommentWebhook,
  CONTROL_TUTORIAL_ISSUES,
} from "../src/projects/onboarding.js";
import type { LinearClient } from "../src/integrations/linear.js";

/* eslint-disable @typescript-eslint/unbound-method */

function mockLinearClient(overrides: Partial<LinearClient> = {}): LinearClient {
  return {
    verifyWebhookSignature: vi.fn(),
    getIssue: vi.fn(),
    getChildIssues: vi.fn(),
    postComment: vi.fn(),
    updateIssueState: vi.fn(),
    listTeams: vi.fn().mockResolvedValue([
      { id: "team-1", name: "Nightforge Control" },
    ]),
    createTeam: vi.fn(),
    createWebhook: vi.fn(),
    listWebhooks: vi.fn().mockResolvedValue([]),
    updateWebhook: vi.fn(),
    createIssue: vi.fn().mockResolvedValue(undefined),
    archiveIssue: vi.fn().mockResolvedValue(undefined),
    listTeamIssues: vi.fn().mockResolvedValue([]),
    listTeamStates: vi.fn().mockResolvedValue([
      { id: "state-todo", name: "Todo", type: "unstarted" },
    ]),
    ...overrides,
  };
}

describe("seedControlOnboarding", () => {
  it("seeds the single Home ticket when the team has none", async () => {
    const linear = mockLinearClient();
    const seeded = await seedControlOnboarding(linear, "team-1");
    expect(seeded).toBe(CONTROL_TUTORIAL_ISSUES.length);
    expect(linear.createIssue).toHaveBeenCalledTimes(
      CONTROL_TUTORIAL_ISSUES.length
    );
    for (const tutorial of CONTROL_TUTORIAL_ISSUES) {
      expect(linear.createIssue).toHaveBeenCalledWith({
        teamId: "team-1",
        title: tutorial.title,
        description: tutorial.description,
        stateId: "state-todo",
      });
    }
    expect(linear.listTeamStates).toHaveBeenCalledWith("team-1");
  });

  it("skips the Home ticket when it already exists", async () => {
    const linear = mockLinearClient({
      listTeamIssues: vi.fn().mockResolvedValue([
        { id: "home-existing", title: CONTROL_TUTORIAL_ISSUES[0].title },
      ]),
    });
    const seeded = await seedControlOnboarding(linear, "team-1");
    expect(seeded).toBe(0);
    expect(linear.createIssue).not.toHaveBeenCalled();
  });

  it("resolves the team by name", async () => {
    const linear = mockLinearClient();
    const seeded = await seedControlOnboarding(linear, "Nightforge Control");
    expect(seeded).toBe(CONTROL_TUTORIAL_ISSUES.length);
    expect(linear.createIssue).toHaveBeenCalledTimes(
      CONTROL_TUTORIAL_ISSUES.length
    );
    expect(linear.createIssue).toHaveBeenCalledWith(
      expect.objectContaining({ teamId: "team-1" })
    );
  });

  it("returns 0 and creates nothing for an unknown team", async () => {
    const linear = mockLinearClient();
    const seeded = await seedControlOnboarding(linear, "ghost-team");
    expect(seeded).toBe(0);
    expect(linear.createIssue).not.toHaveBeenCalled();
    expect(linear.archiveIssue).not.toHaveBeenCalled();
  });

  it("seeds into the Todo state when it exists", async () => {
    const linear = mockLinearClient({
      listTeamStates: vi.fn().mockResolvedValue([
        { id: "state-backlog", name: "Backlog", type: "backlog" },
        { id: "state-todo", name: "Todo", type: "unstarted" },
        { id: "state-inprogress", name: "In Progress", type: "started" },
      ]),
    });
    const seeded = await seedControlOnboarding(linear, "team-1");
    expect(seeded).toBe(CONTROL_TUTORIAL_ISSUES.length);
    expect(linear.createIssue).toHaveBeenCalledWith(
      expect.objectContaining({ stateId: "state-todo" })
    );
  });

  it("seeds without a stateId when no unstarted state exists", async () => {
    const linear = mockLinearClient({
      listTeamStates: vi.fn().mockResolvedValue([
        { id: "state-backlog", name: "Backlog", type: "backlog" },
        { id: "state-done", name: "Done", type: "completed" },
      ]),
    });
    const seeded = await seedControlOnboarding(linear, "team-1");
    expect(seeded).toBe(CONTROL_TUTORIAL_ISSUES.length);
    expect(linear.createIssue).toHaveBeenCalledWith(
      expect.objectContaining({ teamId: "team-1" })
    );
    for (const call of vi.mocked(linear.createIssue).mock.calls) {
      expect(call[0]).not.toHaveProperty("stateId");
    }
  });

  it("archives legacy tutorial tickets when the Home ticket already exists", async () => {
    const linear = mockLinearClient({
      listTeamIssues: vi.fn().mockResolvedValue([
        { id: "home-1", title: "🏠 Nightforge Home — run commands here" },
        { id: "tut-1", title: "📚 Tutorial: Add a project (3 easy ways)" },
        { id: "tut-2", title: "📚 Tutorial: See your projects" },
        { id: "welcome-1", title: "👋 Welcome to Nightforge — start here" },
        { id: "user-1", title: "project list" },
        { id: "user-2", title: "project add https://github.com/owner/name" },
      ]),
    });
    const seeded = await seedControlOnboarding(linear, "team-1");
    expect(seeded).toBe(0);
    expect(linear.createIssue).not.toHaveBeenCalled();
    expect(linear.archiveIssue).toHaveBeenCalledTimes(3);
    expect(linear.archiveIssue).toHaveBeenCalledWith("tut-1");
    expect(linear.archiveIssue).toHaveBeenCalledWith("tut-2");
    expect(linear.archiveIssue).toHaveBeenCalledWith("welcome-1");
    expect(linear.archiveIssue).not.toHaveBeenCalledWith("home-1");
    expect(linear.archiveIssue).not.toHaveBeenCalledWith("user-1");
    expect(linear.archiveIssue).not.toHaveBeenCalledWith("user-2");
  });

  it("archives nothing when only user tickets exist", async () => {
    const linear = mockLinearClient({
      listTeamIssues: vi.fn().mockResolvedValue([
        { id: "user-1", title: "project list" },
        { id: "user-2", title: "project add https://github.com/owner/name" },
      ]),
    });
    const seeded = await seedControlOnboarding(linear, "team-1");
    // The Home ticket is still created since it is missing.
    expect(seeded).toBe(CONTROL_TUTORIAL_ISSUES.length);
    expect(linear.archiveIssue).not.toHaveBeenCalled();
  });

  it("does not throw when archiving a legacy tutorial fails", async () => {
    const linear = mockLinearClient({
      listTeamIssues: vi.fn().mockResolvedValue([
        { id: "home-1", title: "🏠 Nightforge Home — run commands here" },
        { id: "tut-1", title: "📚 Tutorial: Get help" },
      ]),
      archiveIssue: vi.fn().mockRejectedValue(new Error("Linear down")),
    });
    await expect(seedControlOnboarding(linear, "team-1")).resolves.toBe(0);
  });

  it("returns 0 and does not throw when listTeamStates fails", async () => {
    const linear = mockLinearClient({
      listTeamStates: vi.fn().mockRejectedValue(new Error("Linear down")),
    });
    await expect(seedControlOnboarding(linear, "team-1")).resolves.toBe(0);
  });

  it("returns 0 and does not throw when createIssue fails", async () => {
    const linear = mockLinearClient({
      createIssue: vi.fn().mockRejectedValue(new Error("Linear down")),
    });
    await expect(seedControlOnboarding(linear, "team-1")).resolves.toBe(0);
  });

  it("returns 0 and does not throw when listTeamIssues fails", async () => {
    const linear = mockLinearClient({
      listTeamIssues: vi.fn().mockRejectedValue(new Error("Linear down")),
    });
    await expect(seedControlOnboarding(linear, "team-1")).resolves.toBe(0);
  });
});

describe("ensureControlCommentWebhook", () => {
  it("updates the webhook to include Comment when it lacks them", async () => {
    const linear = mockLinearClient({
      listWebhooks: vi.fn().mockResolvedValue([
        { id: "wh-1", label: "nightforge-control", resourceTypes: ["Issue"] },
      ]),
    });
    await ensureControlCommentWebhook(
      linear,
      "team-1",
      "https://getnightforge.com",
      "secret"
    );
    expect(linear.updateWebhook).toHaveBeenCalledWith({
      webhookId: "wh-1",
      resourceTypes: ["Issue", "Comment"],
    });
    expect(linear.createWebhook).not.toHaveBeenCalled();
  });

  it("creates a webhook when none exists", async () => {
    const linear = mockLinearClient({
      listWebhooks: vi.fn().mockResolvedValue([]),
    });
    await ensureControlCommentWebhook(
      linear,
      "team-1",
      "https://getnightforge.com/",
      "secret"
    );
    expect(linear.createWebhook).toHaveBeenCalledWith({
      teamId: "team-1",
      url: "https://getnightforge.com/webhooks/linear",
      label: "nightforge-control",
      secret: "secret",
    });
  });

  it("does nothing when the webhook already includes Comment", async () => {
    const linear = mockLinearClient({
      listWebhooks: vi.fn().mockResolvedValue([
        {
          id: "wh-1",
          label: "nightforge-control",
          resourceTypes: ["Issue", "Comment"],
        },
      ]),
    });
    await ensureControlCommentWebhook(
      linear,
      "team-1",
      "https://getnightforge.com",
      "secret"
    );
    expect(linear.updateWebhook).not.toHaveBeenCalled();
    expect(linear.createWebhook).not.toHaveBeenCalled();
  });

  it("never throws when the Linear API fails", async () => {
    const linear = mockLinearClient({
      listWebhooks: vi.fn().mockRejectedValue(new Error("Linear down")),
    });
    await expect(
      ensureControlCommentWebhook(
        linear,
        "team-1",
        "https://getnightforge.com",
        "secret"
      )
    ).resolves.toBeUndefined();
  });

  it("resolves the team by name", async () => {
    const linear = mockLinearClient({
      listWebhooks: vi.fn().mockResolvedValue([]),
    });
    await ensureControlCommentWebhook(
      linear,
      "Nightforge Control",
      "https://getnightforge.com",
      "secret"
    );
    expect(linear.createWebhook).toHaveBeenCalledWith(
      expect.objectContaining({ teamId: "team-1" })
    );
  });

  it("does nothing when the team cannot be found", async () => {
    const linear = mockLinearClient();
    await ensureControlCommentWebhook(
      linear,
      "ghost-team",
      "https://getnightforge.com",
      "secret"
    );
    expect(linear.createWebhook).not.toHaveBeenCalled();
    expect(linear.updateWebhook).not.toHaveBeenCalled();
  });
});