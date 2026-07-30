# Nightforge

**The forge that burns while you sleep.**

Open-source autonomous software engineering orchestration platform. Kanban-driven, multi-model, VPS-native, multi-project concurrent.

## What It Does

You manage priorities on a Linear Kanban board. AI agents implement, test, deploy, verify — overnight, autonomously.

- Move tickets to "Ready for AI" → agents pick them up
- Routes each ticket to the cheapest capable model (Qwen 3.8 for routine, Claude for complex)
- Tests, builds, deploys atomically, verifies, rolls back on failure
- Reports results via Telegram and Linear comments
- Manages multiple projects simultaneously from one control layer

## Quick Start

```bash
# Clone
git clone https://github.com/sonozaki7/Nightforge.git
cd Nightforge

# Configure
cp .env.example .env
# Edit .env with your API keys

# Run with Docker
docker compose up -d

# Or run locally
npm install
npm run dev
```

## Configuration

All configuration via environment variables (see `.env.example`):

| Variable | Description |
|----------|-------------|
| `REDIS_URL` | Redis connection string |
| `LINEAR_API_KEY` | Linear GraphQL API key |
| `LINEAR_WEBHOOK_SECRET` | Webhook HMAC secret |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token |
| `TELEGRAM_CHAT_ID` | Your Telegram chat ID |
| `DASHSCOPE_API_KEY` | Qwen/DashScope API key |
| `ANTHROPIC_API_KEY` | Claude API key |
| `PROJECTS_DIR` | Directory containing managed projects |
| `WORKTREES_DIR` | Git worktree isolation directory |
| `MAX_CONCURRENT_WORKERS` | Max parallel agents (default: 6) |
| `MAX_DAILY_BUDGET_USD` | Daily spend cap (default: $50) |

## Model Routing

Cost-optimized routing (cheapest first):

| Provider | Model | Use For |
|----------|-------|---------|
| DashScope | Qwen 3.8 | Overnight bulk, routine CRUD/UI/tests |
| Moonshot | Kimi K3 | Secondary coding lane |
| Anthropic | Claude Opus 5 | Architecture, security, hard problems |

Routing rules:
1. Labels `architecture`/`security`/`billing` → Claude
2. Label `urgent` → Claude
3. Failed 2x on current model → escalate
4. Overnight (21:00-07:00) → Qwen (cheapest)
5. Default → Qwen

## Telegram Commands

Control from anywhere (iPhone, MacBook):

- `/status` — running agents
- `/pause {project}` — pause work
- `/resume {project}` — resume
- `/approve {ticket-id}` — approve production deploy
- `/cancel {ticket-id}` — kill running agent
- `/budget` — today's spend

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

## Development

```bash
npm run lint        # ESLint
npm run typecheck   # TypeScript strict
npm test            # Vitest
```

## License

MIT — see [LICENSE](./LICENSE)
