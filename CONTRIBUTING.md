# Contributing to Nightforge

## Adding a New Model Provider

1. Create `src/router/providers/{name}.ts`
2. Implement the `Provider` interface from `base.ts`:

```typescript
import { type Provider, type GenerateOptions, type GenerateResult, type ProviderConfig, calculateCost } from "./base.js";

export function createMyProvider(config: ProviderConfig): Provider {
  return {
    name: "my-provider",
    modelName: "model-name",
    async generate(prompt: string, options?: GenerateOptions): Promise<GenerateResult> {
      // Call your API
    },
    getCostPerMillionInput(): number { return 0.0; },
    getCostPerMillionOutput(): number { return 0.0; },
  };
}
```

3. Add to the escalation ladder in `src/router/escalation.ts`
4. Add routing rules in `src/router/model-router.ts` if needed
5. Add tests in `tests/router.test.ts`

## Adding a New Integration

1. Create `src/integrations/{name}.ts`
2. Export a factory function: `createMyIntegration(config): MyIntegration`
3. Wire into `src/main.ts`
4. Add tests in `tests/{name}.test.ts`

## Code Standards

- TypeScript strict mode, no `any`
- All functions explicitly typed
- File names: kebab-case
- Max 300 lines per file
- Conventional commits: `feat:`, `fix:`, `chore:`, `test:`

## Running Checks

```bash
npm run lint
npm run typecheck
npm test
```

All three must pass before submitting a PR.
