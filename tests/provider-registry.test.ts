import { describe, expect, it } from "vitest";
import {
  createModelProviderRegistry,
  type RegistryKeys,
} from "../src/router/provider-registry.js";
import type { ModelDescriptor } from "../src/router/model-tiers.js";

const noKeys: RegistryKeys = {
  dashscopeApiKey: "",
  anthropicApiKey: "",
  openrouterApiKey: "",
};

const allKeys: RegistryKeys = {
  dashscopeApiKey: "dash-key",
  anthropicApiKey: "anthropic-key",
  openrouterApiKey: "openrouter-key",
};

const qwenDescriptor: ModelDescriptor = {
  id: "qwen3.8-max",
  tier: "senior",
  family: "qwen",
  shadowCostPerRun: 20,
};

describe("createModelProviderRegistry", () => {
  it("should resolve roster models when the family key exists", () => {
    const registry = createModelProviderRegistry(allKeys);
    expect(registry.resolve(qwenDescriptor)).not.toBeNull();
    expect(
      registry.resolve({ ...qwenDescriptor, id: "claude-opus-5", family: "anthropic" })
    ).not.toBeNull();
    expect(
      registry.resolve({ ...qwenDescriptor, id: "deepseek-v4-flash", family: "deepseek" })
    ).not.toBeNull();
  });

  it("should resolve deepseek through the dashscope key, not openrouter", () => {
    const dashscopeOnly = createModelProviderRegistry({
      ...noKeys,
      dashscopeApiKey: "dash-key",
    });
    expect(
      dashscopeOnly.resolve({ ...qwenDescriptor, id: "deepseek-v4-flash", family: "deepseek" })
    ).not.toBeNull();

    const openrouterOnly = createModelProviderRegistry({
      ...noKeys,
      openrouterApiKey: "openrouter-key",
    });
    expect(
      openrouterOnly.resolve({ ...qwenDescriptor, id: "deepseek-v4-flash", family: "deepseek" })
    ).toBeNull();
  });

  it("should return null when the family has no configured key", () => {
    const registry = createModelProviderRegistry(noKeys);
    expect(registry.resolve(qwenDescriptor)).toBeNull();
  });

  it("should return null for unknown families", () => {
    const registry = createModelProviderRegistry(allKeys);
    expect(
      registry.resolve({ ...qwenDescriptor, id: "mystery-1", family: "mystery" })
    ).toBeNull();
  });

  it("should expose an executable generate for resolved models", () => {
    const registry = createModelProviderRegistry(allKeys);
    const provider = registry.resolve(qwenDescriptor);
    expect(provider).not.toBeNull();
    if (provider !== null) {
      expect(typeof provider.generate).toBe("function");
    }
  });

  it("should list only families with usable keys", () => {
    expect(createModelProviderRegistry(noKeys).availableFamilies()).toEqual([]);

    const partial = createModelProviderRegistry({ ...noKeys, dashscopeApiKey: "k" });
    expect(partial.availableFamilies()).toEqual(["qwen", "deepseek"]);

    expect(createModelProviderRegistry(allKeys).availableFamilies().sort()).toEqual([
      "anthropic",
      "deepseek",
      "glm",
      "moonshot",
      "openai",
      "qwen",
    ]);
  });
});
