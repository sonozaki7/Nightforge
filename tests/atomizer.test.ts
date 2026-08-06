import { describe, expect, it } from "vitest";
import { createEpicAtomizer, type EpicBriefInput } from "../src/epic/atomizer.js";

const base = {
  epicId: "epic-1",
  title: "Payment feature",
  objective: "Ship payments end to end",
};

describe("createEpicAtomizer", () => {
  it("should treat a componentless epic as atomic", async () => {
    const atomizer = createEpicAtomizer();
    const output = await atomizer.atomize({ ...base, components: [] });

    expect(output.atomic).toBe(true);
    expect(output.tasks).toHaveLength(1);
    expect(output.tasks[0].id).toBe("epic-1-single");
    expect(output.conflicts).toEqual([]);
  });

  it("should treat a single-component epic as atomic", async () => {
    const atomizer = createEpicAtomizer();
    const brief: EpicBriefInput = {
      ...base,
      components: [
        { id: "checkout", objective: "Checkout page", ownedFiles: ["src/ui/checkout.tsx"] },
      ],
    };
    const output = await atomizer.atomize(brief);

    expect(output.atomic).toBe(true);
    expect(output.tasks[0].id).toBe("checkout");
  });

  it("should decompose multi-component epics into a DAG", async () => {
    const atomizer = createEpicAtomizer();
    const brief: EpicBriefInput = {
      ...base,
      components: [
        { id: "schema", objective: "DB schema", ownedFiles: ["src/db/schema.ts"] },
        {
          id: "api",
          objective: "API",
          ownedFiles: ["src/api/pay.ts"],
          dependsOn: ["schema"],
        },
      ],
    };
    const output = await atomizer.atomize(brief);

    expect(output.atomic).toBe(false);
    expect(output.tasks).toHaveLength(2);
    expect(output.tasks[1].dependsOn).toEqual(["schema"]);
    expect(output.conflicts).toEqual([]);
  });

  it("should surface ownership conflicts between components", async () => {
    const atomizer = createEpicAtomizer();
    const brief: EpicBriefInput = {
      ...base,
      components: [
        { id: "a", objective: "A", ownedFiles: ["src/shared.ts"] },
        { id: "b", objective: "B", ownedFiles: ["src/shared.ts"] },
      ],
    };
    const output = await atomizer.atomize(brief);

    expect(output.atomic).toBe(false);
    expect(output.conflicts).toEqual([["a", "b", "src/shared.ts"]]);
    expect(output.reason).toMatch(/conflicts/);
  });

  it("should reject decompositions with unknown dependencies", async () => {
    const atomizer = createEpicAtomizer();
    const brief: EpicBriefInput = {
      ...base,
      components: [
        { id: "a", objective: "A", ownedFiles: [], dependsOn: ["ghost"] },
        { id: "b", objective: "B", ownedFiles: [] },
      ],
    };
    const output = await atomizer.atomize(brief);

    expect(output.tasks).toEqual([]);
    expect(output.reason).toMatch(/Invalid decomposition/);
  });
});
