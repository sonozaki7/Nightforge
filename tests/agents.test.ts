import { describe, expect, it } from "vitest";
import { createRoleRegistry } from "../src/agents/role-registry.js";
import type { TaskCapsule } from "../src/artifacts/schemas.js";

const capsule: TaskCapsule = {
  task: {
    id: "t-1",
    objective: "Add retry to webhook handler",
    acceptanceCriteria: ["retries 3 times", "logs each attempt"],
    nonGoals: ["no new dependencies"],
    risk: "low",
    budgetUsd: 3,
    stopConditions: ["3 failed repair loops"],
  },
  context: {
    architectureFragment: "",
    targetRegions: ["src/integrations"],
    interfaceBriefs: [],
    relevantTests: ["tests/webhook.test.ts"],
    relevantMemory: [],
    previousAttempts: [],
  },
  execution: {
    allowedPaths: ["src/integrations/webhook.ts"],
    prohibitedPaths: ["src/config.ts"],
    allowedTools: ["shell"],
    validationCommands: ["npm test"],
  },
};

describe("createRoleRegistry", () => {
  const registry = createRoleRegistry();

  it("should expose every agent role from the Guide", () => {
    const roles = registry.roles();
    expect(roles).toContain("intake_compiler");
    expect(roles).toContain("repository_explorer");
    expect(roles).toContain("principal_arbiter");
    expect(roles).toHaveLength(16);
  });

  it("should give every role a purpose, prompt, and output schema", () => {
    for (const role of registry.roles()) {
      const def = registry.definition(role);
      expect(def.purpose.length).toBeGreaterThan(0);
      expect(def.systemPrompt).toContain("Role:");
      expect(def.outputSchema).toContain("Output:");
    }
  });

  it("should assemble prompts in the fixed A-F order", () => {
    const assembled = registry.assemble({
      role: "implementer",
      invariants: ["strict TypeScript", "no secrets in logs"],
      capsule,
      evidence: ["tests pass: 12/12"],
    });

    // A+B: static cacheable prefix
    expect(assembled.staticPrefix).toContain("Operating Policy");
    expect(assembled.staticPrefix).toContain("Role: Implementer");

    // C-F: dynamic section order
    const dynamic = assembled.dynamicSection;
    const invariantsIdx = dynamic.indexOf("## Project Invariants");
    const capsuleIdx = dynamic.indexOf("## Task Capsule");
    const evidenceIdx = dynamic.indexOf("## Evidence");
    const outputIdx = dynamic.indexOf("## Required Output");
    expect(invariantsIdx).toBeLessThan(capsuleIdx);
    expect(capsuleIdx).toBeLessThan(evidenceIdx);
    expect(evidenceIdx).toBeLessThan(outputIdx);
  });

  it("should render capsule bounds into the prompt", () => {
    const { dynamicSection } = registry.assemble({
      role: "implementer",
      invariants: [],
      capsule,
      evidence: [],
    });
    expect(dynamicSection).toContain("Allowed paths: src/integrations/webhook.ts");
    expect(dynamicSection).toContain("Prohibited paths: src/config.ts");
    expect(dynamicSection).toContain("Validation: npm test");
    expect(dynamicSection).toContain("Stop conditions: 3 failed repair loops");
  });

  it("should render placeholders when invariants or evidence are empty", () => {
    const { dynamicSection } = registry.assemble({
      role: "repository_explorer",
      invariants: [],
      capsule,
      evidence: [],
    });
    expect(dynamicSection).toContain("- none recorded");
    expect(dynamicSection).toContain("- none provided");
  });

  it("should encode the no-review-for-reversible-work rule in the reviewer prompt", () => {
    const def = registry.definition("reviewer");
    expect(def.systemPrompt).toContain("high-blast-radius");
    expect(def.systemPrompt).toContain("rollback");
  });
});
