import { describe, it, expect, vi } from "vitest";
import { createModelAtomizer } from "../src/epic/model-atomizer.js";
import type { ModelProvider } from "../src/workers/worker.js";

function fakeProvider(content: string): ModelProvider {
  return {
    generate: vi.fn(() =>
      Promise.resolve({
        content,
        tokensUsed: 10,
        costUsd: 0.001,
      })
    ),
  };
}

describe("createModelAtomizer", () => {
  it("keeps a ticket atomic when the model says so", async () => {
    const atomizer = createModelAtomizer(
      fakeProvider('{"decompose":false,"reason":"single change","tasks":[]}')
    );
    const result = await atomizer.atomize({
      epicId: "E-1",
      title: "Fix typo",
      objective: "Change teh to the",
      components: [],
    });
    expect(result.atomic).toBe(true);
    expect(result.tasks).toHaveLength(1);
  });

  it("accepts a valid decomposition from the model", async () => {
    const atomizer = createModelAtomizer(
      fakeProvider(
        JSON.stringify({
          decompose: true,
          reason: "two independent areas",
          tasks: [
            { id: "a", objective: "Update API", ownedFiles: ["src/api.ts"], dependsOn: [] },
            { id: "b", objective: "Update UI", ownedFiles: ["src/ui.ts"], dependsOn: ["a"] },
          ],
        })
      )
    );
    const result = await atomizer.atomize({
      epicId: "E-1",
      title: "Big change",
      objective: "do two things",
      components: [],
    });
    expect(result.atomic).toBe(false);
    expect(result.tasks).toHaveLength(2);
    expect(result.conflicts).toHaveLength(0);
  });

  it("falls back to atomic when the model returns invalid JSON", async () => {
    const atomizer = createModelAtomizer(fakeProvider("not json at all"));
    const result = await atomizer.atomize({
      epicId: "E-1",
      title: "x",
      objective: "y",
      components: [],
    });
    expect(result.atomic).toBe(true);
  });

  it("falls back to atomic on ownership conflicts", async () => {
    const atomizer = createModelAtomizer(
      fakeProvider(
        JSON.stringify({
          decompose: true,
          tasks: [
            { id: "a", objective: "one", ownedFiles: ["src/shared.ts"], dependsOn: [] },
            { id: "b", objective: "two", ownedFiles: ["src/shared.ts"], dependsOn: [] },
          ],
        })
      )
    );
    const result = await atomizer.atomize({
      epicId: "E-1",
      title: "x",
      objective: "y",
      components: [],
    });
    expect(result.atomic).toBe(true);
  });

  it("falls back to atomic when the model call fails", async () => {
    const failing: ModelProvider = {
      generate: vi.fn(() => Promise.reject(new Error("network down"))),
    };
    const atomizer = createModelAtomizer(failing);
    const result = await atomizer.atomize({
      epicId: "E-1",
      title: "x",
      objective: "y",
      components: [],
    });
    expect(result.atomic).toBe(true);
  });
});