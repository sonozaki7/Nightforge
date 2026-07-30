# AGENTS.md — Nightforge

Rules for AI agents implementing the Nightforge platform itself.

---

## Before Starting Any Work

1. Read `NIGHTFORGE.md` in full — it is the authoritative specification.
2. Read `IMPLEMENTATION.md` — know which phase and step you are working on.
3. Read this file — these rules are non-negotiable.

---

## Scope Discipline

- Work ONLY within the assigned ticket/step scope.
- No drive-by refactors, no "while I'm here" changes.
- If you discover something broken outside your scope, note it in a comment. Do not fix it.
- If a task is ambiguous, stop and ask. Do not guess intent.

---

## Code Quality Gates

Before reporting any task as complete, ALL of these must pass:

```bash
npm run lint
npm run typecheck
npm test
```

- Never disable, skip, or weaken tests to get a passing result.
- Never use `@ts-ignore` or `@ts-expect-error` without a comment explaining why.
- Never use `any` type. Use `unknown` + narrowing if the type is genuinely unknown.

---

## TypeScript Standards

- Strict mode. No exceptions.
- All function parameters and return types explicitly typed.
- Prefer interfaces over type aliases for object shapes.
- Use zod for runtime validation of external data (webhooks, config, API responses).
- Use pino for structured logging. Include ticket ID as correlation ID in every log line.
- Error handling: never swallow errors. Always log, always propagate or report.

---

## File Organization

- Follow the directory structure in NIGHTFORGE.md section 5 exactly.
- File names: kebab-case (`model-router.ts`, not `modelRouter.ts`)
- Class names: PascalCase (`ModelRouter`)
- Function/variable names: camelCase (`routeTicket`)
- Max file size: 300 lines. Split into smaller modules if larger.
- One primary export per file.

---

## Dependencies

- Do not add npm dependencies without justification.
- Prefer Node.js built-ins (crypto, fs, path, child_process) where possible.
- If a dependency is needed, state why in the commit message or ticket comment.
- Approved core dependencies: fastify, bullmq, ioredis, pino, yaml, zod, openai

---

## Git Discipline

- Conventional commits: `feat:`, `fix:`, `chore:`, `test:`, `docs:`, `refactor:`
- One logical change per commit.
- Never commit secrets, API keys, `.env` files, or credentials.
- Never force-push to main.
- Work in feature branches: `feat/phase1-queue`, `feat/phase2-router`, etc.

---

## Security Rules

- Never hardcode secrets. All secrets come from environment variables.
- Never log secrets, tokens, or API keys.
- Never give agent workers access to production credentials.
- Never modify production infrastructure from a development task.
- Never access projects outside the one assigned to your ticket.

---

## Testing Requirements

- Unit tests for: router logic, scheduler, locks, config validation, deployer
- Integration tests for: webhook -> queue -> worker lifecycle
- Test files live in `tests/` directory, named `{module}.test.ts`
- Use vitest as the test runner
- Mock external services (Linear API, Telegram, model providers) in tests
- Never make real API calls in tests

---

## When to Stop

- After 3 failed repair attempts on the same error: STOP and report the failure.
- If a task requires a decision not covered by NIGHTFORGE.md: STOP and ask.
- If you need to modify NIGHTFORGE.md itself: STOP. That requires human approval.
- If a dependency has a known vulnerability: STOP and report.

---

## Output Format

When completing a task, report:

```
## Completed: {ticket/step title}

### Files changed
- src/queue/scheduler.ts (created)
- tests/queue.test.ts (created)

### Test results
- lint: pass
- typecheck: pass
- tests: 12 passed, 0 failed

### Notes
- {any risks, decisions, or follow-ups}
```
