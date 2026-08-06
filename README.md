> Built by Nightforge — this repo is maintained by the Nightforge agent pipeline.

# Nightforge
> Nightforge v2.1 — self-hosting verification release

**The forge that burns while you sleep.**

Open-source autonomous software engineering orchestration platform. Kanban-driven, multi-model, VPS-native, multi-project concurrent.

## What It Does

You manage priorities on a Linear Kanban board. AI agents implement, test, deploy, verify — overnight, autonomously.

- Move tickets to "Ready for AI" → agents pick them up
- Routes each ticket to the cheapest capable model (Qwen 3.8 for routine, Claude for complex)
- Tests, builds, deploys atomically, verifies, rolls back on failure
- Reports results to Linear comments
- Manages multiple projects simultaneously from one control layer

## Quick Start

```bash
# Clone
git clone https://github.com/sonozaki7/Nightforge.git
cd Nightforge

# Configure (interactive wizard)
npm install
npm run setup

# Verify the installation
npm run diagnostics

# Run with Docker
docker compose up -d

# Or run locally
npm run dev
```

## Configuration

All configuration via environment variables (see `.env.example`):

| Variable | Description |
|----------|-------------|
| `REDIS_URL` | Redis connection string |
| `LINEAR_API_KEY` | Linear GraphQL API key |
| `LINEAR_WEBHOOK_SECRET` | Webhook HMAC secret |
| `DASHSCOPE_API_KEY` | Qwen/DashScope API key |
| `ANTHROPIC_API_KEY` | Claude API key |
| `OPENROUTER_API_KEY` | OpenRouter key (routes families without a native backend) |
| `PROJECTS_DIR` | Directory containing managed projects |
| `WORKTREES_DIR` | Git worktree isolation directory |
| `MAX_CONCURRENT_WORKERS` | Max parallel agents (default: 6) |
| `MAX_DAILY_BUDGET_USD` | Daily spend cap (default: $50) |

## Model Routing

Tiered hierarchy — each agent role routes to the cheapest capable model (see [docs/PROVIDER-SDK.md](./docs/PROVIDER-SDK.md)):

| Tier | Purpose | Examples |
|------|---------|----------|
| Principal | Rare high-stakes decisions, arbitration | GPT-5.6 Sol, Claude Opus 5 |
| Senior | Engineering judgment: planning, triage, integration | Qwen 3.8 Max, Kimi K3 |
| Leaf | Bulk implementation, exploration, curation | DeepSeek V4 Flash, Qwen 3.7 Plus |

Routing rules:

1. Role defines the base tier (implementer → leaf, planner → senior).
2. Reviewer tier follows blast radius (low → leaf … critical → principal).
3. Failed 2x on a task → escalate one tier.
4. Reviews avoid the author's model family.
5. Adaptive learning adjusts within policy eligibility — never overrides it.

Deterministic regression check: `npm run bench` (11 pinned routing cases).

## Architecture

```
Linear (webhook) → Fastify Server → BullMQ Queue → Dispatcher → Worker Pool
                                                                    ↓
                                                        Git Worktree Sandbox
                                                                    ↓
                                                        Model Provider (Qwen/Claude)
                                                                    ↓
                                                        Validation → Deploy → Verify
```

## Managed Projects

Each project needs `.nightforge/project.yaml`:

```yaml
id: my-saas
name: My SaaS Product
path: /srv/apps/my-saas/repository
deployment:
  policy: direct-prod
  testCommand: npm test
  deployCommand: ./ops/deploy.sh
```

## Approvals

High-risk tickets (billing, auth, migration, …) are held before production by
[the release gate](src/queue/ticket-workflow.ts). Nightforge posts an
`⏸ Awaiting one approval` comment on the Linear ticket; the implementation
worktree is kept alive for 24h. Reply with `/approve` on the ticket and the
release stage re-runs from the same worktree with the approval granted.

- `/approve` on the ticket — approve the ticket the comment is on
- `/approve TKT-123` — approve a specific ticket

## Development

```bash
npm run lint        # ESLint
npm run typecheck   # TypeScript strict
npm test            # Vitest
npm run bench       # deterministic routing benchmark
npm run setup       # setup wizard (.env)
npm run diagnostics # installation health check
```

Documentation index: [docs/README.md](./docs/README.md). Security policy: [SECURITY.md](./SECURITY.md).

## License

MIT — see [LICENSE](./LICENSE)
