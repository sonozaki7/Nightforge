# Nightforge

**The forge that burns while you sleep.**

Open-source autonomous software engineering orchestration platform. Kanban-driven, multi-model, VPS-native, multi-project concurrent.

---

## 1. Manifesto

- AI inference cost is approaching zero. One human can now run an engineering factory.
- The model is a commodity. The orchestration layer is the asset.
- Nightforge removes the human from the implementation loop for routine work.
- You manage priorities on a Kanban board. Agents implement, test, deploy, verify.
- Open-source: anyone can run their own forge. No vendor lock-in.
- The system gets smarter per-project over time (compounding memory).
- Models will keep improving. Nightforge is model-agnostic by design.

---

## 2. Product Definition

A self-hosted TypeScript orchestration platform running on a VPS that:

- Consumes Kanban tickets (from Linear) as the unit of work
- Dispatches concurrent AI agents to implement them
- Routes each ticket to the cheapest capable model
- Tests, builds, deploys atomically, verifies, and rolls back on failure
- Reports results via Linear comments
- Manages multiple SaaS projects simultaneously from one control layer
- Works 24/7 but optimizes for overnight batch (human sleeps, forge burns)

---

## 3. The Daily Workflow

**Evening (queue):**

- Open Linear on phone/laptop
- Move tickets to "Ready for AI" column
- Set priorities, add labels (urgent, architecture, staging-first, etc.)
- Close laptop

**Overnight (forge burns):**

- Scheduler drains queue using cheapest available model
- Multiple agents work concurrently across different projects
- Low-risk changes deploy directly to production
- High-risk changes queue for morning approval
- Failures auto-retry with escalation, then stop after max attempts

**Morning (review):**

- Open Linear on phone
- Approve/reject/re-queue from anywhere
- Answer "Needs Input" tickets with clarifications

---

## 4. System Architecture

```
Linear (Kanban board, phone/laptop)
          |
          | webhook: ticket -> "Ready for AI"
          v
+------------------------------------------+
|        NIGHTFORGE ORCHESTRATOR           |
|        (Fastify HTTP server)             |
|                                          |
|  +------------+                          |
|  | Webhook    |                          |
|  | Receiver   |                          |
|  +-----+------+                          |
|        |                                 |
|        v                                 |
|  +----------------------------------+   |
|  |     BullMQ Task Queue (Redis)    |   |
|  +----------------------------------+   |
|        |                               |
|        v                               |
|  +----------------------------------+   |
|  |     Scheduler + Dispatcher       |   |
|  |  (concurrency, locks, priority)  |   |
|  +----------------------------------+   |
|        |                               |
|        v                               |
|  +----------------------------------+   |
|  |     Worker Pool                  |   |
|  |  (spawn/monitor/kill agents)     |   |
|  +----------------------------------+   |
|        |                               |
|        v                               |
|  +----------------------------------+   |
|  |     Model Router                 |   |
|  |  (pick cheapest capable model)   |   |
|  +----------------------------------+   |
|        |                               |
|        v                               |
|  +----------------------------------+   |
|  |     Deployer + Verifier          |   |
|  |  (atomic release, health check)  |   |
|  +----------------------------------+   |
|        |                               |
|        v                               |
|  +----------------------------------+   |
|  |     Memory + Telemetry           |   |
|  |  (project context, success rates)|   |
|  +----------------------------------+   |
+------------------------------------------+
          |
          v
  /srv/apps/{project-a}/
  /srv/apps/{project-b}/
  /srv/apps/{project-c}/
```

---

## 5. Repository Structure

```
nightforge/
├── src/
│   ├── server.ts                 # Fastify HTTP server entry
│   ├── config.ts                 # Env config, provider keys, limits
│   ├── queue/
│   │   ├── scheduler.ts          # Priority + concurrency scheduler
│   │   ├── dispatcher.ts         # Assigns tickets to workers
│   │   └── locks.ts             # Per-project Redis locks (SET NX + TTL)
│   ├── workers/
│   │   ├── pool.ts              # Worker pool manager (spawn/kill/monitor)
│   │   ├── worker.ts            # Single agent worker process
│   │   └── sandbox.ts           # Git worktree isolation per task
│   ├── router/
│   │   ├── model-router.ts      # Routing decision engine
│   │   ├── escalation.ts        # Retry with stronger model on failure
│   │   └── providers/
│   │       ├── qwen.ts          # DashScope OpenAI-compatible
│   │       ├── claude.ts        # Anthropic API
│   │       ├── composer.ts      # Cursor SDK
│   │       ├── kimi.ts          # Moonshot API
│   │       └── minimax.ts       # MiniMax API
│   ├── projects/
│   │   ├── registry.ts          # Load/validate .nightforge/project.yaml
│   │   └── deployer.ts          # Atomic deploy + rollback controller
│   ├── integrations/
│   │   ├── linear.ts            # Linear webhook + GraphQL API client
│   │   └── health.ts            # Post-deploy verification pipeline
│   ├── memory/
│   │   ├── project-context.ts   # Per-project architecture/rules cache
│   │   ├── learnings.ts         # Cross-ticket knowledge accumulation
│   │   └── telemetry.ts         # Model success rates, cost tracking
│   └── dashboard/
│       └── api.ts               # REST API for status/control (optional web UI)
├── .nightforge/
│   └── project.yaml             # Template for managed projects
├── tests/
│   ├── queue.test.ts
│   ├── router.test.ts
│   ├── deployer.test.ts
│   └── worker.test.ts
├── docker-compose.yml            # Redis + Nightforge for local dev
├── package.json
├── tsconfig.json
├── NIGHTFORGE.md                 # This bible
├── AGENTS.md                     # Rules for AI agents building Nightforge
├── IMPLEMENTATION.md             # Build order and phases
├── LICENSE                       # MIT
└── README.md
```

---

## 6. Technology Stack

| Component | Choice | Rationale |
|-----------|--------|----------|
| Runtime | Node.js 22+ / TypeScript strict | Async-native, matches existing expertise |
| HTTP | Fastify | Fast, typed, plugin ecosystem, webhook-friendly |
| Queue | BullMQ + Redis 7 | Durable, priority queues, retry, concurrency control, locks |
| Board | Linear ($10/mo Basic) | Native agent sessions, webhooks, GraphQL API, mobile app |
| Default model | Qwen 3.8 via DashScope | Cheapest available inference, OpenAI-compatible endpoint |
| Escalation | Claude API (pay-per-use) | Best for hard architecture/security/debugging |
| Secondary | Composer 2.5 Standard / Kimi K2.7 | Redundancy, comparison, overflow |
| Process mgr | systemd (production) / PM2 (dev) | Keep orchestrator alive, auto-restart |
| Isolation | Git worktrees + dedicated Linux user | No file collisions between concurrent agents |
| VPS | Ubuntu on Linode | Hardened, LUKS encrypted |

---

## 7. Model Router

### Provider Cost Hierarchy (cheapest first)

| Provider | Model | Input $/M | Output $/M | Use for |
|----------|-------|-----------|------------|--------|
| DashScope | Qwen 3.8 (night promo) | ~$0.005 | ~$0.025 | Overnight bulk queue |
| DashScope | Qwen 3.8 (day promo) | ~$0.025 | ~$0.125 | Daytime routine |
| Cursor | Composer 2.5 Standard | $0.50 | $2.50 | Daytime fallback |
| Moonshot | Kimi K2.7 Code | $0.95 | $4.00 | Secondary coding lane |
| Anthropic | Claude Sonnet | $3.00 | $15.00 | Hard problems |
| Anthropic | Claude Opus | $15.00 | $75.00 | Critical architecture only |

### Routing Rules (evaluated in order)

```
1. Label "architecture" OR "security" OR "billing" -> Claude (frontier)
2. Label "urgent" -> Composer Fast OR Claude
3. Ticket failed 2x on current model -> escalate to next tier
4. Time is 21:00-07:00 Bangkok -> prefer Qwen 3.8 (cheapest)
5. Default (CRUD, UI, tests, refactoring) -> Qwen 3.8 day OR Composer Standard
```

### Escalation Ladder

```
Qwen 3.8 -> Composer Standard -> Kimi K2.7 -> Claude Sonnet -> Claude Opus
```

Each escalation triggers after N failures (default: 2) on the current tier.

### DashScope Configuration

```
base_url: https://dashscope.aliyuncs.com/compatible-mode/v1
model: qwen3-235b-a22b (or latest qwen3.8 variant)
api_key: DASHSCOPE_API_KEY env var
```

---

## 8. Agent Worker Contract

### Lifecycle

```
spawn -> receive ticket -> read project context -> implement -> validate -> report -> cleanup
```

### Isolation

- Each worker gets its own git worktree: `/srv/nightforge/worktrees/{project}-{ticket-id}`
- Workers run as dedicated `nightforge` Linux user (no root)
- Workers cannot access other projects' directories
- Workers cannot access production `.env` files directly

### Inputs (given to each worker)

- Ticket content (title, description, acceptance criteria, labels)
- Project context (architecture summary, patterns, past learnings)
- AGENTS.md rules for the target project
- Allowed tools/services list
- Budget cap and runtime cap

### Outputs (required from each worker)

- Structured progress updates (posted to Linear)
- Final result: success/failure + summary
- Files changed list
- Test results
- Token consumption report
- Cost incurred

### Limits

- Max runtime: 90 minutes per ticket (configurable per project)
- Max budget: $5-10 per ordinary ticket (configurable)
- Max repair attempts: 3 before escalating or stopping
- Max concurrent workers per project: 1 write-task (configurable)

---

## 9. Project Configuration Schema

Every managed project contains `.nightforge/project.yaml`:

```yaml
id: my-saas
name: My SaaS Product
path: /srv/apps/my-saas/repository

deployment:
  policy: direct-prod          # direct-prod | staging-first | manual-prod
  test_command: npm test
  lint_command: npm run lint
  typecheck_command: npx tsc --noEmit
  build_command: npm run build
  deploy_command: ./ops/deploy.sh
  healthcheck_command: ./ops/healthcheck.sh
  rollback_command: ./ops/rollback.sh

concurrency:
  max_write_tasks: 1
  max_readonly_tasks: 3

agent:
  default_model: qwen3.8
  max_attempts: 3
  max_runtime_minutes: 90
  max_ticket_cost_usd: 8

permissions:
  allowed_services:
    - github
    - sentry
    - cloudflare
  prohibited_actions:
    - delete-production-database
    - rotate-production-secrets
    - disable-authentication
    - modify-billing-without-approval

risk:
  approval_required_for:
    - billing
    - authentication
    - destructive-migration
    - account-deletion
```

---

## 10. Deployment Model

### Directory Structure (per managed project)

```
/srv/apps/{project}/
├── repository/              # Main working copy
├── releases/
│   ├── 20260729-151500/     # Immutable release snapshots
│   ├── 20260729-163200/
│   └── 20260729-181000/
├── shared/
│   ├── .env                 # Production secrets (NEVER touched by agents)
│   ├── uploads/
│   └── persistent-data/
└── current -> releases/20260729-181000/   # Symlink to active release
```

### Deploy Flow

```
1. Agent completes implementation in worktree
2. Run tests + lint + typecheck + build
3. Create new release directory (timestamp-named)
4. Copy built artifacts to release dir
5. Swap `current` symlink to new release
6. Restart service (systemctl/pm2)
7. Run health check
8. IF health passes -> commit, tag, report success
9. IF health fails -> swap symlink back, restart, report failure + rollback
```

### Rollback

Instant: `current -> previous release`, restart service, verify. Agent does this automatically on failed health checks.

### Verification Pipeline (post-deploy)

1. HTTP health endpoint returns 200
2. Service log scan for new errors (last 30s)
3. Key API endpoint smoke tests
4. Optional: Playwright browser test for critical flows
5. Optional: Sentry check for new exceptions (5 min window)

---

## 11. Task Lifecycle State Machine

```
Backlog
   |  (human moves to Ready)
   v
Ready for AI
   |  (webhook triggers, scheduler claims)
   v
Running
   |  (agent implements)
   v
Testing
   |  (lint + typecheck + tests + build)
   v
Deploying
   |  (atomic release swap)
   v
Verifying
   |  (health checks pass)
   v
Done
```

Side states:

- **Needs Input** — agent uncertain, asks human a specific question
- **Failed** — max attempts exhausted, needs human intervention
- **Rolled Back** — deployed but health check failed, auto-reverted
- **Paused** — human paused execution (via Linear)

---

## 12. Concurrency and Scheduling

### Global Limits (initial, scale up over time)

```
Max concurrent agent runs:           6
Max write-tasks per project:         1
Max readonly investigations/project: 3
Max concurrent heavy builds:         2
Max concurrent production deploys:   1
Max attempts per ticket:             3
Max cost per ordinary ticket:        $5-10
Max daily total spend:               $50 (hard stop)
```

### Priority Rules

1. Label "urgent" -> jump queue
2. Higher Linear priority value -> earlier dispatch
3. Older tickets first (FIFO within same priority)
4. Overnight batch: drain ALL ready tickets regardless of priority

### Locking

- Redis SET NX with TTL for per-project write locks
- Lock acquired before worktree creation
- Lock released only after deploy + verify (or rollback) completes
- Dead worker detection: lock TTL expires -> scheduler reclaims

### Overnight Batch Mode

- 21:00-07:00 Bangkok: scheduler aggressively drains queue
- Prefers cheapest model (Qwen 3.8 at lowest rate)
- Deploys low-risk (direct-prod policy) tickets automatically
- Queues high-risk (manual-prod) tickets for morning approval

---

## 13. Security Model

### Agent User Isolation

- Dedicated `nightforge` Linux user (no root, no unrestricted sudo)
- Narrow sudoers entries only: `restart {project}`, `deploy {project}`, `rollback {project}`
- Cannot access `/root`, cannot modify system configs
- Cannot access other users' home directories

### Credential Isolation

- Production `.env` files: owned by root, readable only by service user
- Agent gets staging/dev credentials only
- Per-project scoped GitHub tokens (branch + PR creation, no admin)
- Secrets in env vars or secret manager, NEVER in tickets/prompts/git

### Approval Gates

Tickets labeled with these require human approval before production deploy:

- `billing`
- `authentication`
- `destructive-migration`
- `account-deletion`
- `permissions`

### Prohibited Actions (hard-coded)

- Delete production database
- Rotate production secrets
- Disable authentication
- Modify billing without approval
- Force-push to main
- Access unrelated projects
- Modify Nightforge orchestrator itself (separate approval)

### Budget Enforcement

- Per-ticket hard cap (default $10)
- Per-day global hard cap (default $50)
- Worker killed immediately if budget exceeded

---

## 14. Integrations

### Linear

- Webhook receiver: POST /webhooks/linear
- Trigger: issue moved to "Ready for AI" state OR assigned to AI agent identity
- API: GraphQL client for posting comments, updating state, reading issue details
- Agent sessions: link external run URL to Linear issue
- States mapped: Linear custom states -> Nightforge lifecycle

### Health Checks

- HTTP GET to project's health endpoint
- Expect 200 within 10 seconds
- Retry 3 times with 5s delay before declaring failure

### Optional: Sentry / PostHog

- Read-only access for error monitoring
- Agent can query Sentry for new exceptions post-deploy
- PostHog for feature flag verification

---

## 15. Memory and Intelligence Layer

### Per-Project Context

Each project accumulates a context file (`.nightforge/context.md`):

- Architecture decisions and rationale
- Common code patterns
- Past failures and their fixes
- Deployment quirks
- Test coverage gaps
- Known gotchas

Fed to every agent working on that project. Grows over time.

### Model Success Telemetry

Track per-model, per-task-type:

```json
{
  "qwen3.8": { "crud": 0.94, "ui": 0.89, "auth": 0.62, "migration": 0.71 },
  "claude-sonnet": { "crud": 0.97, "ui": 0.95, "auth": 0.96, "migration": 0.94 }
}
```

Router uses this data: don't waste Claude on CRUD, always escalate auth to Claude.

### Cross-Ticket Learnings

When an agent discovers a reusable pattern or pitfall:

- Store in project memory
- Available to future agents on same project
- Reduces repeated mistakes

---

## 16. Coding Standards

- TypeScript strict mode, no `any`
- All functions typed, no implicit returns
- Structured logging (pino) with correlation IDs per ticket
- Error handling: never swallow errors, always log + report
- Tests: unit tests for router/scheduler/deployer, integration tests for worker lifecycle
- File naming: kebab-case for files, PascalCase for classes, camelCase for functions
- Commits: conventional commits (feat, fix, chore, test, docs)
- Max file size: 300 lines (split if larger)
- Dependencies: minimize, prefer Node.js built-ins where possible

---

## 17. Open-Source Strategy

- **License:** MIT (maximum adoption)
- **README:** Problem -> Solution -> Quick Start -> Architecture -> Configuration -> Contributing
- **Contributing guide:** How to add a new model provider, how to add an integration
- **Documentation:** NIGHTFORGE.md lives in repo root as the spec
- **Community:** GitHub Discussions for Q&A, Issues for bugs/features
- **Versioning:** SemVer. Breaking changes get migration guide.

---

## 18. Economics

### Monthly Budget (initial)

| Item | Cost |
|------|------|
| Qoder Pro+ (Qwen 3.8 promo) OR DashScope API | $60 |
| Linear Basic | $10 |
| Claude API (escalation only) | $20-50 |
| Composer/Kimi API (secondary) | $20-40 |
| Redis on VPS | $0 (self-hosted) |
| VPS (existing server) | $0 marginal |
| **Total** | **$110-160/month** |

### Per-Ticket Cost Targets

- Routine CRUD/UI ticket: < $1 (overnight Qwen)
- Medium feature ticket: $2-5
- Hard architecture ticket: $5-15 (Claude escalation)
- Average across all tickets: < $3

### Scaling Projection

- 10 tickets/day at $3 avg = $30/day = $900/month (aggressive)
- With 70% overnight Qwen: effective $400-500/month at full throughput
- Compare: one junior developer = $4000+/month

---

## 19. Glossary

| Term | Definition |
|------|------------|
| Ticket | A Linear issue = one unit of work |
| Worker | An isolated agent process implementing one ticket |
| Forge | The Nightforge orchestrator system |
| Batch | Overnight queue drain (21:00-07:00) |
| Escalation | Retrying a failed ticket with a stronger/more expensive model |
| Release | An immutable timestamped deployment snapshot |
| Rollback | Reverting `current` symlink to previous release |
| Lock | Redis-based per-project write mutex |
| Provider | An AI model API (Qwen, Claude, Kimi, etc.) |
| Router | The component that selects which provider handles a ticket |
| Context | Accumulated per-project knowledge fed to agents |
| Telemetry | Success rates, costs, and timing data per model/task-type |
