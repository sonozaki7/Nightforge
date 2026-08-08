import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildSeatbeltProfile } from "../src/sandbox/seatbelt.js";
import { resolveSandboxMode, DEFAULT_SANDBOX_CONFIG } from "../src/sandbox/factory.js";
import type { SandboxConfig } from "../src/sandbox/types.js";

const existsSyncMock = vi.hoisted(() => vi.fn());
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: existsSyncMock,
  };
});

const BASE_CONFIG: SandboxConfig = {
  ...DEFAULT_SANDBOX_CONFIG,
  mode: "auto",
};

describe("sandbox", () => {
  beforeEach(() => {
    existsSyncMock.mockReset();
  });

  describe("resolveSandboxMode", () => {
    it("honors an explicit mode", () => {
      const resolved = resolveSandboxMode({ ...BASE_CONFIG, mode: "docker" });
      expect(resolved.mode).toBe("docker");
    });

    it("falls back to unsafe only when no backend exists", () => {
      existsSyncMock.mockReturnValue(false);
      const resolved = resolveSandboxMode(BASE_CONFIG);
      expect(resolved.mode).toBe("unsafe");
    });

    it("selects seatbelt when only sandbox-exec exists on darwin", () => {
      // Seatbelt only exists on macOS; simulate it so the test passes on
      // Linux too (the server and GitHub CI run on Linux).
      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", {
        value: "darwin",
        configurable: true,
      });
      try {
        existsSyncMock.mockImplementation((p: string) => p === "/usr/bin/sandbox-exec");
        const resolved = resolveSandboxMode(BASE_CONFIG);
        expect(resolved.mode).toBe("seatbelt");
      } finally {
        Object.defineProperty(process, "platform", {
          value: originalPlatform,
          configurable: true,
        });
      }
    });
  });

  describe("buildSeatbeltProfile", () => {
    const worktreePath = "/srv/nightforge/worktrees/myproj-ticket1";
    const readOnlyPaths = ["/srv/apps/myproj/node_modules"];

    it("denies network by default", () => {
      const profile = buildSeatbeltProfile(
        { worktreePath, readOnlyPaths, cwd: ".", command: "npm", args: [] },
        BASE_CONFIG
      );
      expect(profile).toContain("(deny network*)");
    });

    it("allows network when enabled", () => {
      const profile = buildSeatbeltProfile(
        { worktreePath, readOnlyPaths, cwd: ".", command: "npm", args: [] },
        { ...BASE_CONFIG, networkEnabled: true }
      );
      expect(profile).toContain("(allow network*");
    });

    it("restricts writes to worktree and tmp only", () => {
      const profile = buildSeatbeltProfile(
        { worktreePath, readOnlyPaths, cwd: ".", command: "npm", args: [] },
        BASE_CONFIG
      );
      expect(profile).toContain(`(subpath "${worktreePath}")`);
      expect(profile).toContain(`(subpath "${readOnlyPaths[0]}")`);
      // Default deny first — the profile starts locked down
      expect(profile.startsWith("(version 1)\n(import \"system.sb\")\n(deny default)")).toBe(true);
    });

    it("escapes quotes in paths", () => {
      const profile = buildSeatbeltProfile(
        { worktreePath: '/srv/a"b', readOnlyPaths: [], cwd: ".", command: "npm", args: [] },
        BASE_CONFIG
      );
      expect(profile).not.toContain('"/srv/a"b"');
    });
  });
});