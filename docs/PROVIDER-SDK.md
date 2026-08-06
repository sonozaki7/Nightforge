# Provider Adapter SDK

How to add a new model provider to Nightforge (Roadmap Phase 7).
Providers live behind one small interface; routing, costing, and adaptive
learning work automatically once a provider is registered.

## 1. Implement the `Provider` interface

`src/router/providers/base.ts`:

```ts
interface Provider {
  readonly name: string;        // provider family, e.g. "qwen"
  readonly modelName: string;   // endpoint model id
  generate(prompt: string, options?: GenerateOptions): Promise<GenerateResult>;
  getCostPerMillionInput(): number;
  getCostPerMillionOutput(): number;
}
```

Rules:

- Fill **every** `GenerateResult` field: `content`, `tokensUsed`,
  `inputTokens`, `outputTokens`, `cachedInputTokens`, `costUsd`, `model`,
  `durationMs`. The cost ledger and adaptive routing rely on them.
- Use `calculateCost()` from `base.ts` for the USD amount unless the
  provider bills differently (cached-token discounts, plan pricing).
- Read the API key from configuration; never hardcode or log it.
- If the model supports function calling, also implement `ToolUseProvider`
  (`generateWithTools`) so the agentic worker can use it.

Create `src/router/providers/<family>.ts` (kebab-case), exporting
`create<Family>Provider(config: ProviderConfig): Provider`. Follow
`qwen.ts` as the reference implementation.

## 2. Register the backend mapping

`src/router/provider-registry.ts`:

1. Add your family to `FAMILY_BACKEND` (`family → backend`). Families
   without a native backend route through OpenRouter.
2. If the roster model id differs from the endpoint id, add an entry to
   `ENDPOINT_MODEL`.
3. Extend `RegistryKeys` and `createModelProviderRegistry` if the backend
   needs its own key/base URL, and expose the key in `src/config.ts`.

`resolve()` must return `null` when the family has no configured key —
callers fall back, they never receive a hardcoded secret.

## 3. Add the model to the roster

Model descriptors (tier, family, shadow cost) live in
`src/router/model-tiers.ts`. New models need:

- a tier (`principal` / `senior` / `leaf`),
- a `shadowCostPerRun` (subscription-style cost used for routing),
- policy eligibility (which risk levels may use it).

Adaptive routing picks the model up automatically once outcome samples
accumulate; no learning-router changes are required.

## 4. Tests

- Mock the HTTP layer; **never** call real provider APIs in tests
  (AGENTS.md).
- Cover: response mapping, token/cost accounting, missing-key → `null`,
  error propagation.
