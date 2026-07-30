# Nightforge — Full Development Context

> Complete conversation history and technical decisions for the Nightforge project.
> Compiled for team sharing. Covers architecture, tooling, strategy, and implementation.

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Infrastructure Setup](#infrastructure-setup)
3. [Desktop Tooling Decision](#desktop-tooling-decision)
4. [Model Provider Strategy](#model-provider-strategy)
5. [Prompt Caching Architecture](#prompt-caching-architecture)
6. [MCP vs Direct Integration](#mcp-vs-direct-integration)
7. [Tool System Architecture](#tool-system-architecture)
8. [Agentic Worker Design](#agentic-worker-design)
9. [Orchestrator Decision](#orchestrator-decision)
10. [Effort Levels](#effort-levels)
11. [Mode-Aware Execution](#mode-aware-execution)
12. [Competitive Analysis](#competitive-analysis)
13. [Product Strategy Critique](#product-strategy-critique)
14. [Current Codebase State](#current-codebase-state)

---

## Project Overview

**Nightforge** is a self-hosted autonomous agent orchestrator that turns a Linear ticket board into a self-executing swarm. It processes tickets (code tasks, ops automation, research, outreach) using LLM-powered agents with tool access.

**Core value proposition:** "Drag a card to In Progress → 4 minutes later you have a PR, a deployed staging environment, and a summary in Telegram."

**Tech stack:**
- TypeScript / Node.js
- Fastify (HTTP server)
- BullMQ + Redis (job queue)
- pino (structured logging)
- zod (runtime validation)
- Linear (ticket source)
- Telegram (notifications + approval gates)
- Docker (deployment)

**Primary model:** Qwen 3.8 via Alibaba Cloud Model Studio (extremely cheap)
**Escalation model:** Claude (for hard problems)
**Uncensored models:** Hermes 4 70B/405B, DeepSeek V3.2 via OpenRouter

---

## Infrastructure Setup

### Alibaba Cloud Model Studio Token Plan (Singapore)

Two plan-exclusive base URLs:

| Protocol | Base URL | Use with |
|----------|----------|----------|
| OpenAI-compatible | `https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1` | Any tool expecting OpenAI API format |
| Anthropic-compatible | `https://token-plan.ap-southeast-1.maas.aliyuncs.com/apps/anthropic` | Any tool expecting Claude/Anthropic API format |

Configuration:
```
OPENAI_API_KEY=your-alibaba-key
OPENAI_BASE_URL=https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1
```

### Cost Model

| Workload | Method | Monthly Cost |
|----------|--------|------|
| Nightforge automation (Qwen default) | DashScope API | ~$1-5/mo |
| Nightforge escalation (Claude Opus) | Anthropic API | Only fires on hard tickets |
| Uncensored tasks (Hermes) | OpenRouter API | ~$0.13-0.40/M tokens |
| Manual desktop work | $20 Claude Pro subscription | $20/mo flat |

**Key insight:** $20 Claude Pro subscription gives ~45 Opus messages per 5-hour window — equivalent to $150-400+/month in API costs. Use subscription for interactive work, API for automation.

---

## Desktop Tooling Decision

**Requirement:** Chat-first desktop app (not an IDE, not terminal). Similar to Codex Desktop UX — open project → chat → AI does everything → review changes.

**Decision: Goose** ([github.com/aaif-goose/goose](https://github.com/aaif-goose/goose))

- Standalone desktop app (macOS, Linux, Windows)
- Chat-first UI, no traditional editor interface
- Apache 2.0, Linux Foundation backed
- Supports 15+ providers including custom OpenAI-compatible endpoints
- MCP extensions (70+) for connecting to Linear, GitHub, docs
- Multi-step task execution

**Setup:**
1. Download desktop app from releases
2. Provider settings → OpenAI-compatible
3. Base URL: Alibaba token plan endpoint
4. API Key: Alibaba key
5. Add model names (qwen3-coder-plus, claude-sonnet, etc.)

**ACP (Agent Client Protocol):** Allows Goose to use existing Claude Code / ChatGPT subscriptions as backends. Goose wraps the official CLI binary as a subprocess. Gray zone for ToS but works today.

**Workflow split:**
- Goose = manual daily work (plans, small edits, exploration)
- Nightforge = autonomous ticket-driven development

---

## Model Provider Strategy

### Routing Table (Priority Order)

| Priority | Trigger Label | Model | Cost (in/out per M) | Use Case |
|----------|--------------|-------|---------------------|----------|
| 1 | `unrestricted` | Hermes 4 405B | $1.00 / $3.00 | Zero censorship + max capability |
| 2 | `uncensored` | Hermes 4 70B | $0.13 / $0.40 | Guaranteed no refusal |
| 3 | `permissive` | DeepSeek V3.2 | $0.27 / $0.40 | Tasks others *might* refuse |
| 4 | `architecture`/`security`/`billing` | Claude | Premium | Hard reasoning |
| 5 | `urgent` | Claude | Premium | Time-sensitive |
| 6 | 2+ failures | Claude (escalation) | Premium | Retry with better model |
| 7 | Overnight (21:00–07:00) | Qwen | $0.005/M | Batch processing |
| 8 | Default | Qwen | $0.005/M | Everything else |

### Censorship Spectrum

| Tier | Models | Reality |
|------|--------|---------|
| Heavily restricted | GPT, Claude, Gemini | Refuse + lecture |
| Permissive | DeepSeek V3.2, Mistral, Qwen | Fewer refusals, some lines |
| Uncensored (trained) | Hermes 4 70B/405B | Fine-tuned to remove refusal behavior |
| Truly unrestricted | Local open-weight models | No provider, no API, no cutoff risk |

All uncensored models use the same `OPENROUTER_API_KEY` — no additional env vars needed.

---

## Prompt Caching Architecture

### Design Principle

Prompt caching (KV caching) reuses computation for **identical starting prefixes**. A single token difference early in the prompt breaks the match from that point onward. Therefore: **put unchanging material first, variable part last.**

### Layered Prompt Structure

```
┌─────────────────────────────────────────────────┐
│  Layer 1: System Identity (NEVER changes)       │  ← Always cached
│  "You are Nightforge..." + coding standards     │
├─────────────────────────────────────────────────┤
│  Layer 2: Project Context (changes rarely)      │  ← Usually cached
│  Architecture, patterns, gotchas, failures      │
├─────────────────────────────────────────────────┤
│  Layer 3: Project Config (changes rarely)       │  ← Usually cached
│  Commands, constraints, deployment policy       │
├─────────────────────────────────────────────────┤
│  Layer 4: Ticket Content (unique per request)   │  ← Fresh compute only
│  Title, description, labels                     │
└─────────────────────────────────────────────────┘
```

Every ticket for the same project reuses Layers 1–3 from cache. Only Layer 4 needs fresh computation.

### Provider-Specific Optimizations

| Provider | Caching Mechanism |
|----------|------------------|
| Claude (Anthropic) | Native `cache_control: {"type": "ephemeral"}` on each system block. 90% discount on cached tokens. |
| Qwen (DashScope) | Auto prefix caching ≥1024 tokens. Stable blocks joined first. |
| OpenRouter (Hermes) | Same auto prefix caching. Stable-first ordering. |

### Expected Savings

For 20 tickets/day with ~2000 tokens of system context:
- **Claude**: ~$0.18/day saved (90% off cached portion)
- **Latency**: Prefill skip = faster first-token time
- **Qwen/OpenRouter**: Minimal cost impact but latency improves

---

## MCP vs Direct Integration

### Key Decision: Direct-First Architecture

**MCP (Model Context Protocol)** is a plugin system for AI apps you don't control. It solves: "I can't edit Claude Desktop's source code, so I need a standard way to bolt tools on from outside."

**Nightforge is our own system.** We can just add code directly.

```
MCP:              Worker → JSON-RPC protocol → separate MCP process → Stripe API
Direct:           Worker → stripe_api() function → Stripe API
```

Same outcome. Direct is simpler, faster, more reliable, easier to test.

### When MCP Makes Sense (Exceptions)

| Scenario | Use MCP? |
|----------|----------|
| Official MCP maintained by vendor (Cloudflare, Stripe) | **Yes** — free, maintained, complete |
| Browser-use (complex vision loop) | **Yes** — too complex to rebuild |
| Sharing tools across Goose + Nightforge | **Yes** — write once, use everywhere |
| Simple API wrapper (Gmail, Calendar) | **No** — 50-100 lines of direct code |

### Final Integration Strategy

| Service | Approach | Who Maintains |
|---------|----------|---------------|
| Cloudflare | Official MCP server | Cloudflare |
| Stripe | Official MCP/agent-toolkit | Stripe |
| Google (Gmail, Calendar, Drive) | google_workspace_mcp (community) | taylorwilsdon |
| GitHub | Official MCP | GitHub |
| X.com | Browser-use or direct API | Us |
| Web crawling | Crawl4AI (self-hosted, free) + SearXNG | Us |

### Web Crawling Stack (Self-Hosted, $0)

```
Step 1: SEARCH → SearXNG (self-hosted meta-search, unlimited)
Step 2: CRAWL  → Crawl4AI (self-hosted, unlimited pages, JS rendering)
Step 3: EXTRACT → Regex + LLM extraction (Qwen, ~$0.0001/page)
Step 4: VERIFY → MX record check (dns lookup, $0)
```

Total cost: ~$0/month for unlimited crawling.

---

## Tool System Architecture

### The Generic Tool Pattern

Instead of 300 specific tools, build **one generic tool per service**:

```typescript
{
  name: "stripe_api",
  description: "Call any Stripe API endpoint. You know the Stripe API from training.",
  parameters: {
    method: "GET | POST | DELETE",
    path: "string (e.g. /v1/customers)",
    body: "object (optional)",
  },
  execute: (params) => stripe.request(params),
}
```

The LLM **already knows** Stripe's entire API from training data. You don't teach it endpoints — you give it keys and a guardrail.

### Three-Layer Tool Architecture

```
Layer 1: Common tools (typed, safe, auto-approved)
   "send_email", "deploy_worker", "create_task"
   → ~10-20 tools. Agent uses freely.

Layer 2: Generic service access (powerful, approval-gated)
   "stripe_api", "cloudflare_api", "google_api"
   → One tool per service. ANY endpoint.
   → Requires Telegram approval before execution.

Layer 3: Shell / browser (escape hatch, strict approval)
   "run_command", "browse_web"
   → Always requires approval.
```

### Permission System

```typescript
const permissions = {
  auto: [
    "stripe_api:GET:*",          // Reading = always fine
    "gmail:send:*",              // Sending email = fine
    "cloudflare:GET:*",          // Reading CF = fine
  ],
  approve: [
    "stripe_api:POST:/v1/charges",    // Charging money = ask first
    "stripe_api:DELETE:*",            // Deleting = ask first
    "cloudflare:POST:*",              // Deploying = ask first
  ],
  forbidden: [
    "stripe_api:DELETE:/v1/accounts", // Never delete account
    "*:POST:/v1/transfers",           // Never move money out
  ],
};
```

### Function Calling vs MCP (Clarification)

```
Function calling = "LLM picks which tool to use and what params to pass"
MCP             = "tools live in a separate process instead of your code"
```

You need the first (agent decides dynamically). You don't need the second (deployment choice).

---

## Agentic Worker Design

### The Core Loop

```typescript
while (iteration < maxIterations) {
  if (cost >= tokenBudgetUsd) → STOP, return partial result
  
  response = LLM.generateWithTools(messages, tools)
  
  if (response has no tool_calls) → DONE, return summary
  
  for each tool_call:
    check permission tier (auto/approve/forbidden)
    execute tool
    push result back into messages
  
  if (messages.length > compactionThreshold):
    summarize middle messages (keep head + tail)
}
```

### Context Compaction

When conversation exceeds threshold (40/60/80 messages depending on effort):
- Keep first message (system prompt context)
- Keep last N messages (recent work)
- Summarize everything in between
- Prevents context window overflow on long tasks

### Sub-Agent Spawning (Swarm)

For complex tickets, the orchestrator decomposes work and spawns concurrent sub-agents:

```typescript
const subTasks = orchestrator.decompose(ticket); // LLM decides sub-tasks

const results = await Promise.allSettled(
  subTasks.map(task => spawnAgent(task, {
    tools: registry.getDefinitions(),
    maxIterations: task.effort.maxIterations,
    approvalHandler: telegramApproval,
  }))
);

const summary = await orchestrator.synthesize(ticket, results);
```

### What Makes Agents Smart (Not Frameworks)

```
Agent quality = Model (80%) + System prompt (15%) + Orchestration code (5%)
```

- **Model providers** do the fine-tuning (Anthropic trains Claude for tool-use, Alibaba trains Qwen for reasoning)
- **Frameworks** (Mastra, LangGraph) add zero intelligence — they call the same models
- **System prompt** is where iteration matters: "verify your work," "read before writing," "run tests after changes"
- **Claude Code's architecture** is literally a while loop + tools + permissions. No framework.

Key behavioral patterns (all via system prompt, not code):
1. Read before write — check current state before modifying
2. Verify after action — run tests, check output, confirm success
3. Narrow scope — one file at a time
4. Explain before doing — plan in text, then execute
5. Fail fast — if something errors twice, try different approach
6. Context compression — summarize older parts when history gets long

---

## Orchestrator Decision

### Evaluated Frameworks

| Framework | Verdict |
|-----------|---------|
| **Mastra** | TypeScript-native, full-featured. Overkill for what we need. |
| **OpenAI Agents JS** | Lightweight handoffs. No durable state. |
| **LangGraph.js** | Maximum control but verbose. Python-first mindset. |
| **Custom (chosen)** | ~700 lines. Full control. Zero dependency tax. |

### Why Custom Won

Nightforge already has:
- BullMQ (durable queue, retries) → replaces "checkpointing"
- pino (structured logging) → replaces "observability"
- Redis (state) → replaces "memory store"
- Model router (multi-provider) → replaces "provider abstraction"
- Telegram bot → replaces "human-in-the-loop UI"

A framework gives you the same things wrapped in someone else's abstraction.

### Orchestrator Architecture

```
Linear ticket
    │
    ▼
┌─────────────────────────────────────────────┐
│           ORCHESTRATOR (LLM + meta-tools)    │
│                                             │
│  1. Reads ticket                            │
│  2. Decomposes into sub-tasks               │
│  3. Assigns to agents (concurrent)          │
│  4. Manages tool permissions/approvals      │
│  5. Handles failures → retry/reassign       │
│  6. Synthesizes results                     │
│  7. Reports to Linear + Telegram            │
└────────┬──────────┬──────────┬──────────────┘
         │          │          │
    ┌────▼───┐ ┌───▼────┐ ┌──▼─────┐
    │Agent A │ │Agent B │ │Agent C │  (concurrent)
    │crawl + │ │stripe  │ │deploy  │
    │extract │ │setup   │ │to CF   │
    └────────┘ └────────┘ └────────┘
```

Meta-tools (tools for managing other agents):
- `spawn_agent` — Create a sub-agent for a sub-task
- `wait_for_agents` — Wait for sub-agents to complete
- `request_approval` — Ask human for approval via Telegram
- `report_progress` — Update Linear ticket with progress
- `finish` — Mark task complete with summary

---

## Effort Levels

### Naming (from OpenAI Codex)

Codex's actual scale: `none → minimal → low → medium → high → xhigh → max`

Nightforge uses the top 3: **high → xhigh → max**

- `high` = hard reasoning, complex tasks
- `xhigh` = "extra high" — deep research, long async runs
- `max` = maximum, all-out

### Label Resolution

```
resolveEffortLevel(["ops", "xhigh"])  → "xhigh"
resolveEffortLevel(["max"])           → "max"
resolveEffortLevel(["bug"])           → "high" (default)
```

### Key Design Insight

**Effort is a prompt parameter, not a code path.** The loop is identical; the model thinks harder because instructed to. Only hard enforcement: iterations + budget (code-level stops).

---

## Mode-Aware Execution

### Two Modes

| Mode | Trigger Labels | Purpose |
|------|---------------|---------|
| `ticket` | Default (everything) | A problem to solve. Big tasks. Swarm-style. |
| `automation` | `automation`, `ops`, `routine` | Routine/recurring work. Safe execution. |

### Ticket Mode (Swarm, Parallel, Fast)

| Effort | Iterations | Sub-agents | Budget | Philosophy |
|--------|-----------|------------|--------|------------|
| high | 40 | 2 | $0.25 | Parallelize independent parts immediately |
| xhigh | 70 | 4 | $0.50 | Decompose + concurrent sub-agents, thorough verify |
| max | 120 | 8 | $1.00 | Full swarm — research, implement, verify all in parallel |

Sub-agents at ALL effort levels because even "high" should parallelize independent work. Qwen 3.8 is cheap enough that 2-8 concurrent agents costs pennies — bottleneck is time, not money.

### Automation Mode (Safe, Auditable)

| Effort | Iterations | Sub-agents | Budget | Philosophy |
|--------|-----------|------------|--------|------------|
| high | 20 | 0 | $0.15 | Sequential routine, one check |
| xhigh | 35 | 2 | $0.30 | Parallelize independent routine steps |
| max | 50 | 3 | $0.60 | Decompose + parallel + full audit + rollback |

### Prompt Differences

- **Ticket prompts:** Focus on thinking, decomposition, not breaking stuff, parallel execution
- **Automation prompts:** Focus on safe execution, side-effect detection, audit trail, rollback on failure

### Automation Scheduling

BullMQ repeatable jobs with cron support:

```yaml
schedule:
  every: "daily"          # hourly, daily, weekly, monthly
  timezone: "Asia/Tokyo"
  enabled: true

# Or custom cron:
schedule:
  cron: "0 */6 * * *"    # every 6 hours
  enabled: true
```

Interval-to-cron mapping:
- hourly → `0 * * * *`
- daily → `0 9 * * *`
- weekly → `0 9 * * 1`
- monthly → `0 9 1 * *`

---

## Competitive Analysis

### Landscape (July 2026)

100+ agent orchestrators exist. Closest competitors:

| Project | What it does | Status |
|---------|-------------|--------|
| Vibe Kanban (BloopAI) | Kanban board for AI coding agents | **Sunsetted** |
| cyrus | Watches Linear/GitHub/GitLab, isolated worktree per issue | Active |
| background-agents | Triggers from Slack/Linear/webhooks/cron, cloud sandboxes | Active |
| paperclip | Self-hosted, agents claim tickets, org charts, budgets | Active |
| kandev | Kanban workbench, multi-step workflows, human gates | Active |
| Fusion | Multi-node kanban, plan-review-execute gates | Active |
| gastown | 20-30 agents, coordinator, Bors-style merge queue | Active |
| loki-mode | 41 agents in 8 swarms, 9 quality gates | Active |
| Orchestra AI | Jira + GitHub → autonomous agents → deployment | Active |
| sortie | Tracker tickets → agent sessions, single Go binary | Active |

### Nightforge Strengths (vs competitors)

1. **Mode-aware effort** — Nobody else has "effort means different things per task type"
2. **Ops + Code unified** — 90% of competitors are code-only. Nightforge handles Stripe, Cloudflare, email, crawling
3. **Permission tiers + Telegram approval** — More granular than any competitor's all-or-nothing
4. **Cost-aware by design** — $0.15-$1.00 safety rails on cheap models vs competitors assuming Claude pricing
5. **Recurring automations** — BullMQ cron jobs. Most competitors are one-shot only
6. **LLM-orchestrated** — Not hard-coded DAGs. The LLM decides what to do

### Critical Gaps

| Priority | Gap | Why it matters |
|----------|-----|----------------|
| **P0** | Visual dashboard / Kanban UI | Managers can't adopt what they can't see |
| **P0** | Git worktree isolation | Can't swarm on code — sub-agents will conflict |
| **P1** | PR/diff review workflow | Output must be a reviewable PR, not a log message |
| **P1** | Quality gates (plan → approve → execute → verify → merge) | Managers need checkpoints |
| **P2** | Cross-ticket memory/learning | Compound intelligence is the long-term moat |
| **P2** | Multi-tracker (GitHub Issues, Jira) | "Any developers" means not Linear-only |
| **P3** | Sandbox isolation | Safety when running 8 concurrent agents |
| **P3** | Conflict detection / merge queue | Only matters after worktree isolation |

### Unique Positioning

Nobody else combines: **Linear-native + ops automation + code tickets + effort levels + permission gates + cheap model swarm + recurring automations** in one system.

---

## Product Strategy Critique

### Two-Audience Proposal (Evaluated)

**Idea:** Target ordinary managers (any industry) AND tech solopreneurs.

**Verdict: Kill the manager audience. Focus on one.**

### Why Managers Won't Work

- Competing with Zapier ($5B), Microsoft Copilot, Notion AI — all adding AI natively
- Managers won't self-host Docker. They want a URL + 2-click integrations
- "Independent from AI labs" is irrelevant to them. They care about convenience
- Your differentiators (self-hosted, model-agnostic, cheap) don't matter to this audience

### Why Tech Solopreneurs Are Hard Too

- Claude Code + Codex + Cursor already solve "technical challenges exponentially better"
- They already have 5 tools that work
- Their question: "Why set up Nightforge instead of Claude Code + Zapier?"

### The "Independent from AI Labs" Angle

- Nobody chooses a tool because it uses Qwen instead of Claude
- "Independent" still means calling Alibaba's API — that's a big lab
- What actually matters: **"$0.15 per ticket instead of $500/month for Devin"**
- Frame as cost, not independence

### Recommended Focus

> **"I'm a technical founder/operator. I have a Linear board. I want tickets to just... get done. Code tickets, ops tickets, research tickets, outreach tickets. All from one board. Without paying $500/mo per agent seat."**

| | Two audiences | One audience (technical operators) |
|---|---|---|
| Focus | Split | Sharp |
| Competition | Zapier + Devin (funded) | DIY duct-tape (beatable) |
| Moat | None | Cost + integration depth |
| Time to value | Months | Weeks |

### The Holy-Shit Demo

> "I dragged a card to 'In Progress' and 4 minutes later I had a PR, a deployed staging environment, and a summary in my Telegram."

Build toward that demo. Everything else is distraction until that works end-to-end.

---

## Current Codebase State

### Test Results (Latest)

- lint: **pass**
- typecheck: **pass**
- tests: **115 passed, 0 failed** (9 test files)

### Key Files

```
src/
├── config.ts                          # App configuration
├── main.ts                            # Entry point
├── server.ts                          # Fastify HTTP server
├── dashboard/
│   └── api.ts                         # Dashboard API routes
├── integrations/
│   ├── health.ts                      # Health checks
│   ├── linear.ts                      # Linear webhook + API
│   └── telegram.ts                    # Telegram bot (notifications + approvals)
├── memory/
│   ├── learnings.ts                   # Cross-ticket learning
│   ├── project-context.ts            # Project knowledge store
│   └── telemetry.ts                   # Metrics collection
├── projects/
│   ├── deployer.ts                    # Deployment pipeline
│   └── registry.ts                    # Project registry
├── queue/
│   ├── automation-scheduler.ts        # Recurring job management (BullMQ cron)
│   ├── dispatcher.ts                  # Webhook → queue routing
│   ├── locks.ts                       # Distributed locking
│   └── scheduler.ts                   # Job scheduling + TicketJob interface
├── router/
│   ├── escalation.ts                  # Model escalation logic
│   ├── model-router.ts               # Label → provider routing
│   ├── prompt-builder.ts             # Layered cache-optimized prompts
│   └── providers/
│       ├── base.ts                    # Provider interface + ToolUseProvider
│       ├── claude.ts                  # Anthropic (native cache_control)
│       ├── composer.ts               # Composer provider
│       ├── deepseek.ts               # DeepSeek V3.2 (permissive)
│       ├── hermes405b.ts             # Hermes 4 405B (unrestricted)
│       ├── kimi.ts                    # Kimi provider
│       ├── minimax.ts                # MiniMax provider
│       ├── openrouter.ts             # OpenRouter (Hermes 70B)
│       └── qwen.ts                    # Qwen (primary, cheapest)
├── tools/
│   ├── executor.ts                    # Tool execution + permission gates
│   ├── registry.ts                    # Tool registry + pattern matching
│   ├── types.ts                       # Tool interfaces, TicketMode, permissions
│   └── services/
│       ├── browser.ts                 # Playwright browser automation
│       ├── cloudflare.ts             # Generic Cloudflare API v4
│       ├── crawler.ts                 # SearXNG + Crawl4AI
│       ├── google.ts                  # Gmail + Calendar
│       └── stripe.ts                  # Generic Stripe API
└── workers/
    ├── agentic-worker.ts             # THE LOOP: multi-turn tool-use + compaction + sub-agents
    ├── effort-levels.ts              # Mode-aware effort configs (high/xhigh/max)
    ├── pool.ts                        # Worker pool + routing
    ├── sandbox.ts                     # Execution sandboxing
    └── worker.ts                      # Original code worker

tests/
├── config.test.ts
├── deployer.test.ts
├── effort-levels.test.ts
├── linear.test.ts
├── queue.test.ts
├── registry.test.ts
├── router.test.ts
├── tools.test.ts
└── worker.test.ts
```

### Environment Variables (.env.example)

```bash
# Core
REDIS_URL=redis://localhost:6379
LINEAR_API_KEY=lin_api_xxx
LINEAR_WEBHOOK_SECRET=xxx
TELEGRAM_BOT_TOKEN=xxx
TELEGRAM_CHAT_ID=xxx

# Model Providers
DASHSCOPE_API_KEY=xxx                    # Qwen (primary)
ANTHROPIC_API_KEY=xxx                    # Claude (escalation)
OPENROUTER_API_KEY=sk-or-xxx            # Hermes + DeepSeek

# Service Integrations
STRIPE_SECRET_KEY=sk_live_xxx
CLOUDFLARE_API_TOKEN=xxx
GOOGLE_CLIENT_ID=xxx
GOOGLE_CLIENT_SECRET=xxx
GOOGLE_REFRESH_TOKEN=xxx

# Self-Hosted Services
CRAWL4AI_URL=http://localhost:11235
SEARXNG_URL=http://localhost:8080
```

### Docker Compose Services

```yaml
services:
  redis:        # Job queue + state
  nightforge:   # Main application
  crawl4ai:     # Web crawling (unlimited, free)
  searxng:      # Web search (unlimited, free)
```

---

## Next Steps (Priority Order)

1. **P0: Visual dashboard** — Web UI showing active agents, progress, cost, approval queue
2. **P0: Git worktree isolation** — Each sub-agent gets its own worktree
3. **P1: PR workflow** — Agent → branch → PR → review gate → merge
4. **P1: Quality gates** — Plan → approve → execute → verify → merge pipeline
5. **P2: Cross-ticket memory** — Compound learning between runs
6. **P2: Multi-tracker** — GitHub Issues + Jira support
7. **P3: Sandbox isolation** — Container per agent
8. **P3: Conflict detection** — Merge queue for concurrent code changes

---

*Document compiled from full development conversation. All implementation work verified with lint + typecheck + 115 passing tests.*
