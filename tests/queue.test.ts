import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  mapPriority,
  linearPriorityToNightforge,
} from "../src/queue/scheduler.js";

describe("scheduler", () => {
  describe("mapPriority", () => {
    it("should map urgent to 1", () => {
      expect(mapPriority("urgent")).toBe(1);
    });

    it("should map high to 2", () => {
      expect(mapPriority("high")).toBe(2);
    });

    it("should map normal to 5", () => {
      expect(mapPriority("normal")).toBe(5);
    });

    it("should map low to 10", () => {
      expect(mapPriority("low")).toBe(10);
    });
  });

  describe("linearPriorityToNightforge", () => {
    it("should map Linear priority 1 to urgent", () => {
      expect(linearPriorityToNightforge(1)).toBe("urgent");
    });

    it("should map Linear priority 2 to high", () => {
      expect(linearPriorityToNightforge(2)).toBe("high");
    });

    it("should map Linear priority 3 to normal", () => {
      expect(linearPriorityToNightforge(3)).toBe("normal");
    });

    it("should map Linear priority 4 to low", () => {
      expect(linearPriorityToNightforge(4)).toBe("low");
    });

    it("should map unknown priorities to low", () => {
      expect(linearPriorityToNightforge(0)).toBe("low");
      expect(linearPriorityToNightforge(99)).toBe("low");
    });
  });
});

describe("locks", () => {
  const mockRedis = {
    set: vi.fn(),
    get: vi.fn(),
    del: vi.fn(),
    exists: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should acquire lock when not held", async () => {
    mockRedis.set.mockResolvedValue("OK");

    const { createLockManager } = await import("../src/queue/locks.js");
    const lockManager = createLockManager(
      mockRedis as unknown as Parameters<typeof createLockManager>[0]
    );

    const result = await lockManager.acquire("project-1", "ticket-1");

    expect(result).toBe(true);
    expect(mockRedis.set).toHaveBeenCalledWith(
      "nightforge:lock:project-1",
      "ticket-1",
      "EX",
      6000,
      "NX"
    );
  });

  it("should fail to acquire lock when already held", async () => {
    mockRedis.set.mockResolvedValue(null);

    const { createLockManager } = await import("../src/queue/locks.js");
    const lockManager = createLockManager(
      mockRedis as unknown as Parameters<typeof createLockManager>[0]
    );

    const result = await lockManager.acquire("project-1", "ticket-1");

    expect(result).toBe(false);
  });

  it("should release lock when holder matches", async () => {
    mockRedis.get.mockResolvedValue("ticket-1");
    mockRedis.del.mockResolvedValue(1);

    const { createLockManager } = await import("../src/queue/locks.js");
    const lockManager = createLockManager(
      mockRedis as unknown as Parameters<typeof createLockManager>[0]
    );

    await lockManager.release("project-1", "ticket-1");

    expect(mockRedis.del).toHaveBeenCalledWith("nightforge:lock:project-1");
  });

  it("should not release lock when holder does not match", async () => {
    mockRedis.get.mockResolvedValue("ticket-2");

    const { createLockManager } = await import("../src/queue/locks.js");
    const lockManager = createLockManager(
      mockRedis as unknown as Parameters<typeof createLockManager>[0]
    );

    await lockManager.release("project-1", "ticket-1");

    expect(mockRedis.del).not.toHaveBeenCalled();
  });

  it("should check if project is locked", async () => {
    mockRedis.exists.mockResolvedValue(1);

    const { createLockManager } = await import("../src/queue/locks.js");
    const lockManager = createLockManager(
      mockRedis as unknown as Parameters<typeof createLockManager>[0]
    );

    const result = await lockManager.isLocked("project-1");

    expect(result).toBe(true);
  });

  it("should get lock holder", async () => {
    mockRedis.get.mockResolvedValue("ticket-1");

    const { createLockManager } = await import("../src/queue/locks.js");
    const lockManager = createLockManager(
      mockRedis as unknown as Parameters<typeof createLockManager>[0]
    );

    const result = await lockManager.getLockHolder("project-1");

    expect(result).toBe("ticket-1");
  });
});
