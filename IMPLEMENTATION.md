# IMPLEMENTATION.md — Nightforge Build Plan

Ordered implementation phases with concrete steps and acceptance criteria.
Each step is a discrete task assignable to one AI agent.

---

## Phase 1: Core Queue + Single Worker (Week 1-2)

**Goal:** A ticket in Linear triggers an agent that implements code and reports back.

### Step 1.1: Project Scaffold

**Create:**
- `package.json` — ESM, type: module, scripts: dev/build/test/lint/typecheck
- `tsconfig.json` — strict, ESM, NodeNext module resolution
- `.eslintrc` or `eslint.config.mjs` — flat config, typescript-eslint
- `docker-compose.yml` — Redis 7 (port 6379) + Nightforge service
- `.env.example` — all required env vars documented
- `.gitignore` — node_modules, dist, .env, worktrees
- Directory structure per NIGHTFORGE.md section 5 (empty dirs with .gitkeep)

**Dependencies to install:**
```
prod: fastify bullmq ioredis pino yaml zod openai
dev: typescript vitest @types/node eslint @eslint/js typescript-eslint
```

**Acceptance:**
- `npm install` succeeds
- `npm run typecheck` passes (empty project)
- `docker compose up` starts Redis
- Directory structure matches NIGHTFORGE.md section 5

---

### Step 1.2: Config + Project Registry

**Create:**
- `src/config.ts` — load env vars, validate with zod schema, export typed config
- `src/projects/registry.ts` — discover + parse `.nightforge/project.yaml` files
- `.nightforge/project.yaml` — template with all fields from NIGHTFORGE.md section 9

**Config schema (env vars):**
```
REDIS_URL, LINEAR_API_KEY, LINEAR_WEBHOOK_SECRET,
TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID,
DASHSCOPE_API_KEY, ANTHROPIC_API_KEY,
PROJECTS_DIR, WORKTREES_DIR,
MAX_CONCURRENT_WORKERS, MAX_DAILY_BUDGET_USD,
TIMEZONE (default: Asia/Bangkok)
```

**Acceptance:**
- Config loads from .env, rejects missing required vars with clear errors
- Registry loads project.yaml, validates against zod schema
- Invalid yaml produces descriptive validation error
- Unit tests: `tests/config.test.ts`, `tests/registry.test.ts`

---

### Step 1.3: BullMQ Queue + Scheduler + Locks

**Create:**
- `src/queue/scheduler.ts` — BullMQ Queue instance, job priority mapping, repeatable jobs
- `src/queue/locks.ts` — acquire/release per-project locks via Redis SET NX + TTL
- `src/queue/dispatcher.ts` — BullMQ Worker that pulls jobs, checks locks, spawns workers

**Scheduler rules:**
- Priority: urgent=1, high=2, normal=5, low=10 (BullMQ lower number = higher priority)
- Concurrency: read MAX_CONCURRENT_WORKERS from config (default 6)
- Lock TTL: max_runtime_minutes + 10 min buffer

**Acceptance:**
- Jobs enqueued with correct priority
- Dispatcher respects concurrency limit
- Lock prevents two write-tasks on same project simultaneously
- Dead lock (expired TTL) is reclaimed by scheduler
- Unit tests: `tests/queue.test.ts`

---

### Step 1.4: Linear Integration

**Create:**
- `src/integrations/linear.ts` — Linear GraphQL client (post comments, update state, read issue)
- `src/server.ts` — Fastify server with `POST /webhooks/linear` route
- Webhook signature verification (HMAC-SHA256 with LINEAR_WEBHOOK_SECRET)

**Webhook handling:**
- Parse payload: detect issue state change
- If new state matches "Ready for AI" (configurable state name): enqueue ticket
- Extract: title, description, labels, priority, issue ID
- Post acknowledgment comment: "Nightforge claimed this ticket. Worker starting."

**Acceptance:**
- Valid webhook with correct signature -> ticket enqueued
- Invalid signature -> 401 rejected
- Non-trigger state change -> ignored (200 but no action)
- Comment posted back to Linear on claim
- Integration test: `tests/linear.test.ts` (mock HTTP)

---

### Step 1.5: Agent Worker (single model)

**Create:**
- `src/workers/sandbox.ts` — create git worktree, cleanup on completion
- `src/workers/worker.ts` — the agent: receive ticket -> call model -> apply changes -> run tests
- `src/workers/pool.ts` — manage child processes (spawn, monitor, kill on timeout/budget)

**Worker flow:**
1. Create worktree: `git worktree add /srv/nightforge/worktrees/{project}-{ticketId}`
2. Build prompt: ticket content + project context + AGENTS.md rules
3. Call model API (Phase 1: Qwen via DashScope OpenAI-compatible endpoint)
4. Parse model response -> extract file changes -> apply to worktree
5. Run project test/lint/typecheck/build commands
6. If pass: report success. If fail: retry (up to max_attempts) or report failure.
7. Cleanup worktree on completion

**Acceptance:**
- Worker creates isolated worktree
- Worker calls DashScope API and gets code response
- Worker applies changes and runs tests
- Success -> result posted to Linear
- Failure after max attempts -> failure posted to Linear
- Timeout kills worker process
- Integration test: `tests/worker.test.ts` (mock model API)

---

### Step 1.6: End-to-End Wiring

**Create:**
- Wire: server startup -> queue init -> dispatcher start -> worker pool ready
- Add pino structured logging with ticket correlation IDs throughout
- Add graceful shutdown: SIGTERM -> stop accepting -> drain queue -> kill workers -> exit
- Add health endpoint: `GET /health` returns 200 + queue stats

**Acceptance:**
- `npm run dev` starts server, connects to Redis, begins processing
- Full flow: mock webhook -> enqueue -> dispatch -> worker -> result -> Linear comment
- SIGTERM drains gracefully without losing jobs
- `GET /health` returns worker count, queue depth, uptime

---

### Step 1.7: Phase 1 Verification

**Do:**
- Run full test suite: `npm test`
- Run lint: `npm run lint`
- Run typecheck: `npm run typecheck`
- Verify docker-compose: `docker compose up` -> server + Redis both healthy
- Write `README.md` with: what it is, quick start, configuration, architecture link
- Commit all with conventional commits
- Push to GitHub

**Acceptance:**
- All tests pass
- Zero lint errors
- Zero type errors
- README sufficient for a developer to clone + run
- Code pushed to `sonozaki7/Nightforge`

---

## Phase 2: Model Router + Multi-Provider (Week 2-3)

**Goal:** Tickets route to the cheapest capable model. Failures escalate.

### Step 2.1: Provider Abstraction

**Create:**
- `src/router/providers/base.ts` — Provider interface: `generate(prompt, options) -> result`
- `src/router/providers/qwen.ts` — DashScope OpenAI-compatible implementation
- `src/router/providers/claude.ts` — Anthropic Messages API implementation
- Each provider tracks token usage and cost per call

**Acceptance:**
- Both providers implement same interface
- Token usage returned with every response
- Cost calculated per call based on provider pricing table
- Unit tests with mocked HTTP responses

### Step 2.2: Model Router

**Create:**
- `src/router/model-router.ts` — routing decision engine per NIGHTFORGE.md section 7
- `src/router/escalation.ts` — escalation ladder logic

**Routing logic:**
- Read ticket labels -> apply routing rules in order
- Check time of day for overnight preference
- Return selected provider + model name

**Acceptance:**
- "architecture" label -> Claude
- No special labels + nighttime -> Qwen
- No special labels + daytime -> Qwen (day rate) or Composer
- Failed 2x on Qwen -> escalates to next tier
- Unit tests cover all routing rules

### Step 2.3: Cost Tracking

**Create:**
- `src/memory/telemetry.ts` — record per-ticket: model used, tokens in/out, cost, duration, result
- Daily budget enforcement: track cumulative spend, kill at cap
- Report cost in Linear comment on ticket completion

**Acceptance:**
- Every ticket has cost recorded
- Daily cap stops new workers when exceeded
- Telegram alert at 80% budget
- Cost visible in Linear ticket comment

---

## Phase 3: Deployment + Verification (Week 3-4)

**Goal:** Completed tickets auto-deploy with atomic releases and rollback.

### Step 3.1: Atomic Deployer

**Create:**
- `src/projects/deployer.ts` — create release dir, copy artifacts, swap symlink, restart service

### Step 3.2: Rollback Controller

**Create:**
- Rollback logic: swap symlink to previous release, restart, verify
- Auto-trigger on health check failure
- Git tag: `pre-{ticketId}` checkpoint before deploy

### Step 3.3: Verification Pipeline

**Create:**
- `src/integrations/health.ts` — HTTP health check, log scan, smoke tests
- Configurable per project via project.yaml commands

### Step 3.4: Integration

- Wire deployer into worker completion flow
- Success path: tests pass -> deploy -> verify -> Done
- Failure path: verify fails -> rollback -> Rolled Back state

**Phase 3 Acceptance:**
- Ticket completes -> auto-deploys -> health passes -> Done
- Health fails -> auto-rollback -> previous version restored -> Rolled Back
- Git checkpoints exist for every deployment
- Rollback is instant (symlink swap)

---

## Phase 4: Intelligence + Telegram (Week 4-6)

**Goal:** The system learns, notifies, and optimizes overnight.

### Step 4.1: Telegram Bot

**Create:**
- `src/integrations/telegram.ts` — Bot API: notifications + command handling
- Commands: /status, /pause, /resume, /approve, /cancel, /budget
- Notifications: started, completed, failed, needs-input, rolled-back
- Morning digest at 07:00

### Step 4.2: Project Memory

**Create:**
- `src/memory/project-context.ts` — read/write `.nightforge/context.md` per project
- `src/memory/learnings.ts` — extract and store reusable patterns from completed tickets
- Feed context to every worker on spawn

### Step 4.3: Smart Routing

- Use telemetry data to adjust routing probabilities
- If Qwen succeeds 95% on CRUD, keep routing CRUD to Qwen
- If Qwen fails auth tickets 40%, auto-escalate auth to Claude immediately

### Step 4.4: Overnight Batch Mode

- Time-aware scheduler: 21:00-07:00 = aggressive drain
- Auto-deploy direct-prod tickets overnight
- Queue manual-prod tickets for morning
- Send summary at 07:00

**Phase 4 Acceptance:**
- Telegram notification received on ticket completion
- /status shows running agents
- Morning digest arrives at 07:00
- Router uses historical success data
- Overnight batch drains queue autonomously

---

## Phase 5: Scale + Open-Source (Month 2+)

**Goal:** Production-hardened, multi-project, community-ready.

### Step 5.1: Multi-Project Concurrency

- Worker pool manages 6+ concurrent agents across 4+ projects
- Per-project isolation verified under load
- Lock contention handled gracefully

### Step 5.2: Web Dashboard (optional)

- `src/dashboard/api.ts` — REST endpoints for status, cost, history
- Simple HTML/HTMX frontend (or skip if Linear + Telegram sufficient)

### Step 5.3: Open-Source Polish

- README.md: compelling, clear, quick-start in < 5 minutes
- CONTRIBUTING.md: how to add providers, integrations
- LICENSE: MIT
- CI: GitHub Actions for lint + test + typecheck on PR
- Docker: `docker compose up` runs full stack locally

### Step 5.4: Production Hardening

- systemd service file for Nightforge
- Log rotation
- Redis persistence (AOF)
- Monitoring: uptime, memory, disk
- Alerting: Telegram if orchestrator itself crashes

**Phase 5 Acceptance:**
- 6+ agents concurrent, 4+ projects, no collisions
- Another developer can clone + docker-compose up + configure + run
- Orchestrator survives crashes (systemd auto-restart)
- CI passes on all PRs

---

## Dependency Graph

```
Phase 1 (sequential):
  1.1 -> 1.2 -> 1.3 -> 1.4 -> 1.5 -> 1.6 -> 1.7
                (1.3 + 1.4 can parallelize after 1.2)

Phase 2 (after Phase 1):
  2.1 -> 2.2 -> 2.3

Phase 3 (after Phase 1):
  3.1 -> 3.2 -> 3.3 -> 3.4
  (Phase 2 and 3 can run in parallel)

Phase 4 (after Phase 2 + 3):
  4.1 -> 4.2 -> 4.3 -> 4.4

Phase 5 (after Phase 4):
  5.1 -> 5.2 -> 5.3 -> 5.4
```
