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
    listTeamIssues: vi.fn().mockResolvedValue([]),
    listTeamStates: vi.fn().mockResolvedValue([
      { id: "state-todo", name: "Todo", type: "unstarted" },
    ]),
    ...overrides,
  };
}

describe("seedControlOnboarding", () => {
  it("seeds all tutorial issues when the team has none", async () => {
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

  it("skips issues whose titles already exist", async () => {
    const existing = CONTROL_TUTORIAL_ISSUES.slice(0, 3);
    const linear = mockLinearClient({
      listTeamIssues: vi.fn().mockResolvedValue(
        existing.map((tutorial) => ({ id: "existing", title: tutorial.title }))
      ),
    });
    const seeded = await seedControlOnboarding(linear, "team-1");
    const expected = CONTROL_TUTORIAL_ISSUES.length - existing.length;
    expect(seeded).toBe(expected);
    expect(linear.createIssue).toHaveBeenCalledTimes(expected);
    for (const tutorial of CONTROL_TUTORIAL_ISSUES.slice(3)) {
      expect(linear.createIssue).toHaveBeenCalledWith(
        expect.objectContaining({ title: tutorial.title })
      );
    }
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