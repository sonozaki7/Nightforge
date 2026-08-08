import { describe, it, expect, vi } from "vitest";
import {
  seedControlOnboarding,
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
    createIssue: vi.fn().mockResolvedValue(undefined),
    listTeamIssues: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

describe("seedControlOnboarding", () => {
  it("seeds all 7 tutorial issues when the team has none", async () => {
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
      });
    }
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