# Nightforge v2.1

**The forge that burns while you sleep.**

Open-source autonomous software engineering orchestration for one human managing multiple SaaS products. Kanban-driven, model-agnostic, VPS-native, durable, test-gated, and optimized for the fewest possible human interruptions.

> **Document status:** Product and technical specification  
> **Updated:** 4 August 2026  
> **Operating assumption:** Alibaba Personal Token Plan and ChatGPT Plus/Codex/ACP are the primary capacity pools configured by the operator.  
> **Primary design objective:** Convert one clear human goal into verified software with minimal human turns, while preserving evidence, rollback, and quota control.

---

## 0. Executive Decisions

Nightforge v2 keeps the original product vision and makes the following changes:

1. **The orchestrator is deterministic.** Models operate inside bounded roles; they do not own the lifecycle state machine.
2. **Temporal replaces BullMQ as the durable workflow source of truth.** Redis remains optional for caching, rate limiting, and short-lived locks.
3. **PostgreSQL stores product state, artifacts, telemetry, and audit history.** Linear is the human control surface, not the canonical execution database.
4. **Nightforge supports three entry modes:** Ticket, Epic, and Product.
5. **Every non-trivial task produces an executable contract before implementation.**
6. **A task dependency graph controls parallel work.** Agents do not edit the same file concurrently.
7. **Repository exploration is a dedicated stage with a context budget.**
8. **Acceptance criteria map to deterministic tests.** A model saying “done” is never sufficient.
9. **Blast radius, not process, determines the gate** (see `PHILOSOPHY.md`). Reversible changes ship directly to production, gated by automated verification and instant rollback. Staging-first applies only to high-risk changes. Irreversible actions require exactly one human tap — never an approval queue.
10. **Questions are bundled into a single Decision Packet.** Reversible decisions are inferred and recorded rather than repeatedly asked.
11. **Project memory becomes structured and retrieved selectively.** An ever-growing `context.md` is not sent to every agent.
12. **Nightforge is subscription-first.** Alibaba Personal Token Plan and ChatGPT Plus/Codex/ACP are the primary capacity pools selected by the operator.
13. **Model roles are hierarchical:** DeepSeek V4 Flash, Luna, and Qwen handle most leaf work; Qwen3.8 Max and Terra handle senior engineering; Sol and Claude Opus 5 handle rare principal-level decisions.
14. **The default coding loop stays small:** inspect → edit → test → repair. Multi-agent workflows activate only when complexity justifies them.
15. **Nightforge measures accepted outcomes, not benchmark prestige.** Routing eventually learns from each repository’s own telemetry.
16. **No quota evasion.** Nightforge may use supported subscription-backed clients or ACP bridges configured by the operator, but it does not automate browser behavior, conceal traffic, or bypass provider-enforced limits.
17. **Never gate what can be undone.** No PRs, no review chains, no protected-branch rituals for reversible work. The safety net is machine-speed verification plus rollback in under 60 seconds — not slow human approval.

---

## 1. Manifesto

- One human should be able to operate an engineering factory.
- The model is replaceable. The workflow, context system, verification, and accumulated evidence are the product.
- Nightforge removes the human from routine implementation, not from irreversible business decisions.
- The human manages outcomes and priorities; the forge manages decomposition, implementation, verification, and deployment.
- Every automated action must be replayable, attributable, bounded, and reversible.
- Simplicity means the user sees one coherent product, even when the internal workflow is sophisticated.
- Agents communicate through typed artifacts, Git commits, test results, and workflow state—not unbounded chat.
- Correctness comes from executable evidence.
- Open source and provider independence are non-negotiable.
- The system improves per project by learning which models, prompts, tools, and repair strategies actually succeed.

---

## 2. Product Definition

Nightforge is a self-hosted TypeScript orchestration platform running on a VPS that:

- consumes goals and tickets from Linear;
- turns vague requests into explicit acceptance contracts;
- decomposes large work into dependency-aware tasks;
- dispatches isolated coding agents concurrently;
- selects the cheapest automation-eligible model likely to succeed;
- tests, builds, integrates, deploys, verifies, and rolls back;
- reports only decisions and outcomes that need human attention;
- manages multiple SaaS products from one control plane;
- operates continuously, with optional overnight cost optimization;
- supports new projects from idea to production as well as changes to existing repositories.

Nightforge is not merely a coding chatbot. It is a **durable software-delivery operating system**.

---

## 3. Product Modes

### 3.1 Ticket Mode

Input: one bounded Linear issue.

Use for:

- bug fixes;
- isolated API changes;
- UI components;
- tests;
- refactoring;
- documentation;
- small operational improvements.

Default workflow:

```text
understand → localize → implement → validate → review if needed → deploy → verify
```

### 3.2 Epic Mode

Input: one outcome spanning several modules or services.

Use for:

- billing integration;
- organization and permission systems;
- onboarding flows;
- notification infrastructure;
- analytics pipelines;
- major migrations.

Default workflow:

```text
requirements contract
→ architecture or change design
→ dependency graph
→ parallel bounded tickets
→ integration
→ system verification
→ staged release
```

Nightforge creates and manages child tasks automatically. The user does not need to manually rewrite the epic into implementation tickets.

### 3.3 Product Mode

Input: a product idea, target users, constraints, and desired outcome.

Use for building a new SaaS product from an empty or template repository.

Default workflow:

```text
product brief
→ decision packet
→ executable PRD
→ architecture candidates
→ selected architecture contract
→ bootstrap gate
→ vertical-slice roadmap
→ implementation DAG
→ repeated build/test/integrate cycles
→ staging
→ end-to-end acceptance
→ production approval
```

Product Mode is the primary path toward “one human builds a company-scale product with AI.”

---

## 4. Minimum-Human-Turn Experience

### 4.1 The Human Contract

The human should normally do only four things:

1. state the outcome;
2. set priority and risk tolerance;
3. answer one bundled Decision Packet when necessary;
4. approve irreversible or high-blast-radius actions.

Everything else is system responsibility.

### 4.2 Ask-Once Policy

An agent may not ask a human merely because information is absent.

Every unknown is classified:

| Class | Handling |
|---|---|
| Reversible and low impact | Choose the project default and record the assumption |
| Reversible but material | Choose the recommended option and report it in the next digest |
| Irreversible, legal, financial, security-sensitive, or externally binding | Ask in a Decision Packet |
| Blocks only one branch | Pause that branch and continue independent work |
| Contradiction in explicit requirements | Ask before implementation |

### 4.3 Decision Packet

Questions are bundled, not sent one at a time.

Each item must contain:

```yaml
decision_id:
question:
why_it_matters:
recommended_option:
options:
  - id:
    description:
    consequences:
default_if_no_response:
deadline:
blocks:
```

Rules:

- maximum five decisions per packet;
- recommend one option;
- explain consequences in plain language;
- do not ask for technical preferences the system can infer;
- after one answer, propagate the decision to every affected task;
- do not ask the same question again unless facts materially change.

### 4.4 Autonomy Profile

Each project chooses one profile:

```yaml
autonomy:
  profile: balanced # conservative | balanced | aggressive
  infer_reversible_decisions: true
  max_decision_packet_items: 5
  unanswered_decision_policy: pause_affected_branch
  direct_production_max_risk: medium   # reversible work ships direct; rollback is the safety net
```

### 4.5 Morning Digest

The default digest is decision-oriented:

```text
Nightforge — Overnight Summary

Completed: 7
Verified in staging: 5
Deployed to production: 2
Waiting for one decision: 1
Automatically rolled back: 0

Your action:
NF-142 — Choose whether organizations may invite external domains.
Recommended: allow with admin approval.
[Approve recommendation] [Choose alternative]

Everything else continues automatically.
```

No stream of low-value progress messages is sent unless requested.

---

## 5. Research-Derived Design Principles

Nightforge incorporates the following findings:

| Finding | Nightforge response |
|---|---|
| Complex autonomous systems often fail during environment setup and service integration before deep business logic | Mandatory Bootstrap Gate and integration health graph |
| Simple constrained coding loops can perform extremely well on bounded issues | Leaf workers use a minimal inspect/edit/test loop |
| Deterministic localization → repair → validation can beat elaborate free-form agents | Ticket Mode uses a fixed pipeline unless complexity requires escalation |
| Large projects benefit from competing architecture proposals and a machine-checkable contract | Product/Epic Mode uses Architect candidates plus a Design Judge |
| Parallel implementation needs file/interface ownership and dependency ordering | Executable Architecture Contract and DAG scheduler |
| Long-horizon work needs recursive decomposition and compressed aggregation | Atomizer, Planner, Executor, Aggregator interfaces |
| Dedicated repository exploration strongly predicts downstream success | Explorer stage with ranked regions and a strict line/token budget |
| Injecting many generic “skills” often adds tokens without improving correctness | Skills are selective, versioned, measurable, and loaded on demand |
| End-to-end agents overestimate completion and get stuck in repetitive loops | Hard gates, failure classification, attempt diversity, and stop conditions |
| Durable human approvals cannot depend on one process remaining alive | Temporal signals, durable timers, and idempotent activities |

Research basis is listed in Appendix A.

---

## 6. High-Level Architecture

```text
                         HUMAN CONTROL SURFACES
             Linear                                      Telegram
      goals, priorities, decisions                 approvals, digest, pause
              │                                                │
              └──────────────────────┬─────────────────────────┘
                                     ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                         NIGHTFORGE CONTROL PLANE                           │
│                                                                            │
│  Fastify API                                                               │
│      │                                                                     │
│      ▼                                                                     │
│  Temporal Workflows  ←────────────── Human signals / durable timers         │
│      │                                                                     │
│      ├── ProductWorkflow                                                   │
│      ├── EpicWorkflow                                                      │
│      ├── TicketWorkflow                                                    │
│      ├── AgentRunWorkflow                                                  │
│      └── DeploymentWorkflow                                                │
│      │                                                                     │
│      ▼                                                                     │
│  Deterministic Policy Layer                                                │
│  risk • permissions • budgets • provider eligibility • concurrency         │
│      │                                                                     │
│      ▼                                                                     │
│  Model Gateway                                                             │
│  routing • prompt registry • caching • telemetry • provider adapters       │
│      │                                                                     │
│      ▼                                                                     │
│  Artifact and Context Services                                             │
│  requirements • architecture • interfaces • memory • code index            │
│                                                                            │
│  PostgreSQL: canonical app state, telemetry, artifacts, audit metadata      │
│  Object storage/filesystem: logs, traces, screenshots, reports              │
│  Redis optional: cache, rate limits, short-lived resource semaphores        │
└────────────────────────────────────┬───────────────────────────────────────┘
                                     ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                          NIGHTFORGE EXECUTION PLANE                         │
│                                                                            │
│  Sandbox Manager                                                           │
│      ├── Git worktree / branch                                              │
│      ├── Docker container or microVM                                        │
│      ├── scoped credentials                                                 │
│      ├── CPU / RAM / time / network policy                                  │
│      └── action audit                                                       │
│                                                                            │
│  ForgeRunner minimal agent loop                                             │
│      inspect → act → observe → verify → repair or stop                       │
│                                                                            │
│  Deterministic tools                                                        │
│      code search • LSP • AST • shell • patch • tests • browser • logs        │
└────────────────────────────────────┬───────────────────────────────────────┘
                                     ▼
                    repositories → staging → canary → production
```

### Architectural rule

**Temporal and PostgreSQL remember the project. Models do not.**

A conversation can be discarded and reconstructed from artifacts at any time.

---

## 7. Why Temporal Instead of BullMQ as the Core

BullMQ is useful for jobs, but Nightforge workflows include:

- runs lasting hours or days;
- nested child tasks;
- human approvals;
- timeouts and reminders;
- retries with model changes;
- pause/resume;
- partial continuation after VPS restart;
- audit requirements;
- compensation and rollback.

Temporal provides durable workflow state, signals, timers, activity retries, and replay.

### Division of responsibility

| Component | Responsibility |
|---|---|
| Temporal | Lifecycle state, retries, timers, waiting, child workflows |
| PostgreSQL | Product records, artifact metadata, telemetry, model registry |
| Redis | Optional cache, quota windows, concurrency semaphores |
| Linear | Human intent and readable progress projection |
| Telegram | Immediate decisions and digest |
| Git | Code changes and implementation history |

### Temporal workflow rules

- workflow code is deterministic;
- all network, filesystem, model, and Git operations are Activities;
- every mutating Activity is idempotent;
- external calls include workflow and step idempotency keys;
- long workflows use child workflows and Continue-As-New;
- deployment has explicit compensation activities.

---

## 8. Repository Structure

```text
nightforge/
├── apps/
│   ├── api/                         # Fastify API, Linear and Telegram webhooks
│   ├── worker/                      # Temporal activity workers
│   └── cli/                         # setup, diagnostics, local control
├── packages/
│   ├── workflows/
│   │   ├── product.workflow.ts
│   │   ├── epic.workflow.ts
│   │   ├── ticket.workflow.ts
│   │   ├── agent-run.workflow.ts
│   │   └── deployment.workflow.ts
│   ├── activities/
│   │   ├── model.activities.ts
│   │   ├── sandbox.activities.ts
│   │   ├── git.activities.ts
│   │   ├── validation.activities.ts
│   │   ├── deployment.activities.ts
│   │   └── integration.activities.ts
│   ├── agents/
│   │   ├── registry.ts
│   │   ├── prompt-loader.ts
│   │   ├── contracts.ts
│   │   └── roles/
│   ├── models/
│   │   ├── gateway.ts
│   │   ├── router.ts
│   │   ├── registry.ts
│   │   ├── policy.ts
│   │   └── providers/
│   │       ├── alibaba.ts
│   │       ├── deepseek.ts
│   │       ├── zhipu.ts
│   │       ├── moonshot.ts
│   │       ├── anthropic.ts
│   │       └── openai-acp.ts
│   ├── context/
│   │   ├── repository-index.ts
│   │   ├── task-capsule.ts
│   │   ├── interface-index.ts
│   │   └── retrieval.ts
│   ├── artifacts/
│   │   ├── schemas/
│   │   ├── store.ts
│   │   └── validators.ts
│   ├── policy/
│   │   ├── risk.ts
│   │   ├── permissions.ts
│   │   ├── budget.ts
│   │   └── approval.ts
│   ├── runtime/
│   │   ├── forge-runner.ts
│   │   ├── tools.ts
│   │   ├── sandbox.ts
│   │   └── observation-compressor.ts
│   ├── integrations/
│   │   ├── linear.ts
│   │   ├── telegram.ts
│   │   ├── github.ts
│   │   ├── sentry.ts
│   │   └── posthog.ts
│   └── telemetry/
│       ├── events.ts
│       ├── evaluation.ts
│       └── routing-stats.ts
├── prompts/                         # Versioned role prompts
├── migrations/
├── tests/
│   ├── unit/
│   ├── integration/
│   ├── workflow-replay/
│   └── end-to-end/
├── examples/
│   └── project.yaml
├── docker-compose.yml
├── NIGHTFORGE.md
├── AGENT-PROMPTS.md
├── IMPLEMENTATION.md
└── README.md
```

---

## 9. Canonical Artifacts

Agents do not pass free-form summaries as the primary interface. They produce validated artifacts.

### 9.1 Product artifacts

```text
.nightforge/
├── product-brief.yaml
├── requirements.yaml
├── decision-log/
├── architecture/
│   ├── contract.yaml
│   ├── data-model.yaml
│   ├── interfaces.json
│   ├── dependency-graph.json
│   └── decisions/
├── acceptance/
│   ├── traceability.json
│   └── scenarios/
├── memory/
│   ├── invariants.yaml
│   ├── patterns.jsonl
│   ├── failures.jsonl
│   └── runbooks/
└── task-summaries/
```

### 9.2 Executable Architecture Contract

```yaml
contract_version: 1
project:
  id:
  stack:
  constraints:

components:
  - id:
    type: app | service | worker | database | external
    responsibility:
    owner_boundary:
    public_interfaces:
    dependencies:
    healthcheck:

files:
  - path:
    responsibility:
    owner_task:
    exported_symbols:
    depends_on:
    invariants:
    mutable_by:

data:
  entities:
  migrations:
  retention:
  tenancy:

quality:
  required_commands:
  acceptance_scenarios:
  nonfunctional_requirements:

deployment:
  topology:
  rollback:
  observability:
```

The contract is schema-validated before implementation.

### 9.3 Task Capsule

Every worker receives a compact task capsule:

```yaml
task:
  id:
  objective:
  acceptance_criteria:
  non_goals:
  risk:
  budget:
  stop_conditions:

context:
  architecture_fragment:
  target_regions:
  interface_briefs:
  relevant_tests:
  relevant_memory:
  previous_attempts:

execution:
  allowed_paths:
  prohibited_paths:
  allowed_tools:
  validation_commands:
```

A worker does not automatically receive the entire repository or all project memory.

---

## 10. Workflow Hierarchy

### 10.1 ProductWorkflow

Responsible for:

1. compile product brief;
2. create Decision Packet;
3. finalize requirements;
4. request architecture candidates;
5. select and validate architecture;
6. run Bootstrap Gate;
7. generate vertical-slice roadmap;
8. launch EpicWorkflows;
9. run end-to-end product acceptance;
10. prepare production release.

### 10.2 EpicWorkflow

Responsible for:

1. atomize the epic;
2. create task DAG;
3. allocate ownership;
4. launch ready TicketWorkflows;
5. aggregate outputs;
6. run integration checks;
7. repair interface drift;
8. mark epic accepted.

### 10.3 TicketWorkflow

Responsible for:

1. classify complexity and risk;
2. localize repository context;
3. prepare task capsule;
4. run implementation;
5. run deterministic validation;
6. triage failures;
7. route repair or escalation;
8. review based on risk;
9. integrate and deploy;
10. verify outcome.

### 10.4 AgentRunWorkflow

Responsible for one bounded model-driven loop:

```text
load capsule
→ call model
→ execute allowed tool
→ compress observation
→ repeat
→ produce typed result
```

### 10.5 DeploymentWorkflow

Responsible for:

- immutable release creation;
- pre-deploy checks;
- migration plan;
- staging deployment;
- smoke and browser tests;
- approval signal when required;
- canary or production deployment;
- verification window;
- automatic compensation/rollback.

---

## 11. Adaptive Complexity: Atomizer

Every incoming goal is classified as atomic or decomposable.

### Atomic task criteria

A task may remain atomic when all are true:

- one coherent objective;
- limited module footprint;
- no unresolved architecture decision;
- no independent parallel branches;
- no high-risk migration;
- expected implementation fits one worker context and runtime;
- acceptance can be verified with a small test set.

### Decomposition criteria

Decompose when any are true:

- multiple independently testable outcomes;
- more than one service or app;
- interface or schema design required;
- several teams/agents could work independently;
- context would exceed the configured capsule budget;
- task contains an irreversible decision;
- implementation requires dependency ordering.

### Recursive protocol

```text
Atomizer
  ├── atomic → Executor
  └── non-atomic → Planner → child nodes → Aggregator
```

Maximum recursion depth is configurable. The default is three levels:

```text
product → epic → ticket
```

Further decomposition occurs only for unusually large tickets.

---

## 12. Agent Roles and Current Model Assignments

The control plane is deterministic. “Manager” intelligence is invoked only for semantic decisions.

### 12.1 Role matrix

| Role | Purpose | Current default | Fallback | Notes |
|---|---|---|---|---|
| Intake Compiler | Turn human goal into product brief | Qwen3.8 Max Preview when used interactively; otherwise Qwen3.7 Max automation API | GLM-5.2 | High reasoning |
| Decision Curator | Identify only blocking human decisions | Qwen3.7 Max | GLM-5.2 | Must minimize questions |
| Atomizer / DAG Planner | Decompose work and dependencies | Qwen3.7 Max | GLM-5.2 | Structured output required |
| Architect Candidate | Produce an architecture contract candidate | Qwen3.7 Max | GLM-5.2 | Two candidates by default |
| Design Judge / CTO | Compare plans and normalize one contract | GLM-5.2 | Qwen3.7 Max | Independent family from primary architect |
| Repository Explorer | Rank relevant code regions | DeepSeek V4 Pro | Qwen3.7 Max | Read-only tools first |
| Routine Implementer | Small bounded edits | Qwen3.7 Plus or DeepSeek V4 Pro | Qwen3.7 Max | Choose from telemetry |
| Complex Implementer | Cross-module or ambiguous change | Qwen3.7 Max | GLM-5.2 / optional Kimi K2.7 Code | Longer budget |
| Test Designer | Convert criteria into executable tests | GLM-5.2 | DeepSeek V4 Pro | Independent from implementer |
| Failure Triage | Classify failure and select repair scope | DeepSeek V4 Pro | GLM-5.2 | No code edits |
| Reviewer | Requirements, diff, security, compatibility | GLM-5.2 | Qwen3.7 Max | Reviews evidence, not whole chat |
| Integrator | Resolve cross-task interfaces and system failures | Qwen3.7 Max | GLM-5.2 | High reasoning |
| Release Verifier | Analyze staging evidence and anomalies | GLM-5.2 | Qwen3.7 Max | Cannot override hard checks |
| Memory Curator | Store reusable verified learning | Qwen3.7 Plus / Qwen3.6 Flash | DeepSeek V4 Pro | Cheap and structured |
| External Arbiter | Human-triggered second opinion | GPT-5.6 Luna through ACP | Optional premium API | Not part of unattended core |

### 12.2 Operator-configured subscription assumption

Nightforge v2.1 assumes the operator has configured Alibaba Personal Token Plan and ChatGPT Plus/Codex/ACP access as primary model pools. The runtime records quota and provider-enforced limits and does not attempt to evade them. The complete v2.1 role matrix and routing policy are defined in **Appendix C**, which supersedes the older role table in this section.

### 12.3 Model diversity rule

For medium- and high-risk work:

- author and reviewer should use different model families when available;
- retries should change hypothesis or model, not merely repeat the same prompt;
- a model must not approve its own architecture or high-risk patch.

### 12.4 Reasoning effort

| Task | Reasoning |
|---|---|
| Summaries, memory, docs | low/minimal |
| Routine implementation | medium |
| Repository exploration | medium/high |
| Architecture and integration | high/max |
| Security, billing, destructive migration | max plus independent review |

Reasoning output is not stored as project memory. Only conclusions, evidence, and artifacts are retained.

---

## 13. Model Router

### 13.1 Eligibility before optimization

The router applies filters in this order:

1. **Usage policy:** is backend automation permitted?
2. **Required capability:** tools, structured output, context, vision, protocol.
3. **Data policy:** may this project’s data be sent to this region/provider?
4. **Reliability:** recent tool-call and completion health.
5. **Task fit:** measured success for role, task class, language, and project.
6. **Budget and latency.**
7. **Diversity requirement.**

A cheap model that is legally or technically ineligible is not a candidate.

### 13.2 Initial rule-based routing

```text
small + low risk:
    Qwen3.7 Plus or DeepSeek V4 Pro

medium existing-repo task:
    DeepSeek V4 Pro explorer
    → Qwen3.7 Plus or DeepSeek implementer
    → GLM-5.2 review when required

large/ambiguous/cross-module:
    Qwen3.7 Max planner and implementer
    → GLM-5.2 reviewer

architecture:
    2 candidate plans using Qwen3.7 Max / GLM-5.2
    → independent Design Judge

security/billing/auth/migration:
    high-capability author
    → independent reviewer
    → human production approval
```

### 13.3 Adaptive routing

After sufficient data, choose the cheapest model whose conservative success estimate exceeds the role threshold.

Track per:

```text
model × provider × role × task class × language × repository × prompt version
```

Key metric:

```text
accepted_success =
  acceptance criteria pass
  AND no rollback
  AND no blocking verification finding
  AND no regression within observation window
```

Suggested utility:

```text
utility =
  success_lower_bound
  - normalized_cost
  - latency_penalty
  - retry_penalty
  - policy_risk
```

Start with deterministic rules. Add adaptive routing only after at least 30 comparable runs per meaningful bucket.

### 13.4 Escalation is not a simple ladder

Bad:

```text
cheap model fails twice → expensive model repeats same task
```

Better:

```text
failure
→ classify failure
→ narrow evidence
→ change repair strategy
→ choose model suited to the failure class
```

Examples:

| Failure | Next action |
|---|---|
| Wrong files selected | Re-run Explorer with larger line budget |
| Tool-call schema failure | Switch provider adapter or strict mode |
| Test exposes local bug | Same implementer with concise test evidence |
| Cross-service contract mismatch | Integrator with interface graph |
| Repeated speculative edits | Reset worktree and use alternative implementation plan |
| Environment/bootstrap failure | Environment specialist, not a stronger coding model |
| Requirement ambiguity | Decision Curator or human packet |

---

## 14. Prompt Architecture

Exact prompts live in `AGENT-PROMPTS.md`.

### 14.1 Common prompt layers

Every call is assembled from:

```text
1. immutable Nightforge operating policy
2. role prompt
3. project invariants and applicable skills
4. task capsule
5. current evidence
6. required output schema
```

Stable prefixes are cache-friendly. Dynamic evidence appears last.

### 14.2 Prompt rules

- state one role and one responsibility;
- provide explicit completion and stop conditions;
- require typed output;
- separate facts, assumptions, and recommendations;
- forbid modifying unrelated files;
- require evidence for claims;
- do not ask for hidden chain-of-thought;
- request concise decision rationale only;
- never ask the agent to “do everything”;
- do not inject every project skill or memory item;
- version every prompt;
- measure prompt versions as experiments.

### 14.3 Universal agent covenant

All agents receive:

```text
You are one bounded component in a software delivery system.

The workflow state, requirements contract, and tool outputs are authoritative.
Do not claim success without executable evidence.
Do not invent repository facts; inspect them.
Do not widen scope without recording a deviation.
Prefer the smallest change that satisfies the acceptance criteria.
Do not modify prohibited paths or access unavailable secrets.
When blocked, return a precise blocking condition and the minimum evidence needed.
Return only the requested structured artifact.
```

---

## 15. Repository Exploration and Context Engineering

### 15.1 Exploration before editing

For existing repositories, the first model call should usually be read-only.

Explorer tools:

- repository tree;
- `ripgrep`;
- tree-sitter symbol index;
- language server definitions and references;
- import and call graph;
- Git history;
- test-to-source mapping;
- schema and route inventory;
- dependency manifests;
- semantic retrieval as a supplementary signal.

### 15.2 Explorer output

```yaml
hypothesis:
relevant_regions:
  - path:
    start_line:
    end_line:
    relevance:
    evidence:
required_interfaces:
relevant_tests:
unknowns:
recommended_context_budget:
```

### 15.3 Context budgets

Default task capsule budgets:

| Task | Target |
|---|---:|
| Small | 8K–20K tokens |
| Medium | 20K–60K |
| Large | 60K–150K |
| Emergency whole-system analysis | Explicitly approved, model-dependent |

A 1M context window is a maximum, not a design target.

### 15.4 Interface briefs

When workers depend on code owned by another task, they receive only:

- file path;
- exported symbols;
- typed signatures;
- invariants;
- compatibility status;
- latest interface change summary.

They do not automatically receive the full foreign file.

---

## 16. Implementation Model

### 16.1 Minimal ForgeRunner loop

```text
while not terminal:
    model receives task capsule + latest concise observation
    model selects one allowed action
    runtime executes action
    observation is normalized and compressed
    deterministic gates are evaluated
```

Maximum tool rounds and wall time are enforced.

### 16.2 Worker rules

- one bounded objective;
- one worktree;
- explicit writable paths;
- no production secrets;
- smallest valid patch;
- tests run early, not only at the end;
- reset after destructive failed attempts;
- commit at stable checkpoints;
- stop when success or a defined block is proven.

### 16.3 Vertical slices for new products

Product Mode implements thin end-to-end slices before broad horizontal layers.

Preferred:

```text
one user journey
→ UI
→ API
→ database
→ auth/permissions
→ tests
→ staging
```

Avoid:

```text
build every database table
→ every backend endpoint
→ every frontend screen
→ discover integration problems at the end
```

---

## 17. Architecture Competition

For Product Mode or major architectural changes:

1. generate two independent architecture candidates;
2. add a third only for critical or highly ambiguous projects;
3. Design Judge scores each candidate;
4. normalize the winner into the executable contract;
5. validate contract schema and dependency acyclicity;
6. record rejected alternatives and reasons.

### Design Judge rubric

Each category is scored 0–2:

- requirement coverage;
- simplicity and maintainability;
- interface and data consistency;
- deployability and observability;
- security and tenancy;
- testability and rollback;
- dependency fan-out;
- unresolved assumptions.

Tie-breakers:

1. fewer unsupported assumptions;
2. lower cross-module coupling;
3. simpler operational topology;
4. easier rollback;
5. smaller irreversible surface.

---

## 18. Dependency-Aware Parallelism

### 18.1 Task DAG

Every epic receives a DAG with:

```yaml
tasks:
  - id:
    objective:
    depends_on:
    owns_paths:
    reads_interfaces:
    acceptance:
    risk:
    estimated_effort:
```

### 18.2 Ownership

- each writable file has one active owner;
- tasks may read shared interfaces;
- ownership changes are explicit workflow events;
- interface changes requeue affected dependents;
- concurrent tasks touching overlapping paths are serialized.

### 18.3 Scheduling priority

Among ready tasks:

1. critical-path depth;
2. number of downstream dependents;
3. risk-reduction value;
4. user priority;
5. age.

Parallelism follows the graph, not a fixed desire to keep all agents busy.

### 18.4 Git coordination record

Each stable commit includes machine-readable metadata:

```yaml
nightforge_update:
  task_id:
  changed_interfaces:
  compatibility: compatible | breaking | internal
  affected_tasks:
  tests:
  assumptions:
```

---

## 19. Verification Architecture

### 19.1 Requirements traceability

Every acceptance criterion maps to one or more verifiers.

```yaml
criterion_id:
description:
verifiers:
  - type: unit | integration | contract | browser | static | operational
    command:
    evidence_path:
status:
```

A criterion cannot be marked complete with only an LLM review.

### 19.2 Bootstrap Gate

Before feature work on a new project:

```text
clean checkout succeeds
dependencies install
required services start
environment schema validates
migrations run on an empty database
seed/test data loads
backend and frontend connect
queue/cache dependencies respond
test database resets deterministically
base test suite runs
health endpoints pass
CI or equivalent clean build passes
```

Failure blocks downstream implementation.

### 19.3 Validation layers

1. format;
2. lint;
3. type checking;
4. unit tests;
5. affected integration tests;
6. contract/schema tests;
7. migration dry run;
8. full build;
9. acceptance scenarios;
10. staging smoke tests;
11. browser tests;
12. log and error-monitoring checks.

Run the cheapest and fastest checks first.

### 19.4 Test generation

Test Designer receives the requirement contract before the implementation diff where practical.

Tests should cover:

- happy path;
- boundary and invalid inputs;
- permissions and tenant separation;
- retries and idempotency;
- failure recovery;
- migration compatibility;
- resource and performance constraints where relevant.

Generated tests are reviewed for false assumptions and can be run against the pre-change state to confirm they reproduce the missing behavior or defect.

### 19.5 Completion definition

```text
accepted =
  all required criteria verified
  AND required checks pass
  AND review policy satisfied
  AND integration state is healthy
  AND deployment policy satisfied
  AND no unresolved high-severity finding
```

---

## 20. Failure Triage and Repair

### 20.1 Failure taxonomy

```text
requirement
localization
architecture
environment
dependency-install
compile/type
unit-behavior
integration/interface
database/migration
browser/UI
performance
security
provider/tool-call
flaky-infrastructure
```

### 20.2 Failure record

```yaml
failure_id:
category:
symptom:
command:
minimal_error_excerpt:
suspected_scope:
confidence:
attempt_history:
recommended_next_strategy:
requeue_tasks:
```

### 20.3 Repair rules

- repair the smallest suspected scope;
- do not send complete logs when a concise excerpt and artifact path suffice;
- after two similar failures, force strategy diversity;
- maximum ordinary repair loops: three;
- no unbounded self-reflection;
- if progress metrics do not improve, stop and escalate;
- reset to the last known-good commit before a materially different approach.

---

## 21. Review Policy

### 21.0 Philosophy alignment

Review is **not** the default gate. Per `PHILOSOPHY.md`:

- reversible work ships on **automated verification + instant rollback** — no reviewer, no PR, no approval queue;
- the Reviewer role activates only for the high-risk classes listed in 21.3;
- when a reviewer does block, the finding must be evidence-backed and the path forward is repair or one human tap — never a queue of approvers.

### 21.1 Review inputs

Reviewer receives:

- objective and acceptance criteria;
- architecture fragment;
- diff;
- changed interfaces;
- test and build evidence;
- risk classification;
- known assumptions;
- relevant security invariants.

It does not receive the implementation agent’s persuasive narrative as authoritative evidence.

### 21.2 Review outputs

```yaml
decision: approve | request_changes | block
findings:
  - severity: critical | high | medium | low
    category:
    path:
    evidence:
    required_change:
acceptance_coverage:
security_invariants:
migration_safety:
scope_discipline:
```

### 21.3 Mandatory independent review

Reserved for high-blast-radius classes only. Required for:

- authentication;
- authorization and tenant isolation;
- billing and financial calculations;
- destructive or data-transforming migrations;
- account deletion and retention;
- secrets and infrastructure;
- public API breaking changes;
- Nightforge self-modification.

---

## 22. Deployment and Release Safety

### 22.1 Default deployment policy

```yaml
deployment:
  default: blast-radius
```

Blast-radius classification drives the path:

| Class | Path |
|---|---|
| Reversible, rollback < 60s | Direct production. Automated verification + instant rollback is the safety net |
| High-risk (cannot roll back instantly, or touches 21.3 classes) | Staging-first, then release |
| Irreversible / financial / data-destructive | One human tap. Never an approval chain |

Staging is a tool for the dangerous few releases, not a waiting room for every change.

### 22.2 Direct-production eligibility

This is the **standard path** for reversible work. All must be true:

- risk classified low;
- no schema migration;
- no auth, permission, billing, secret, dependency, or infrastructure change;
- no public API contract change;
- tests and build pass;
- rollback is immediate;
- deployment health checks are available.

Changes that fail any of the schema/auth/billing/API conditions fall to staging-first or one-tap approval per 22.1 — they are not blocked outright.

### 22.3 Release layout

```text
/srv/apps/{project}/
├── repository/
├── worktrees/
├── releases/
│   ├── 20260804-220000/
│   └── 20260805-013000/
├── shared/
│   ├── .env
│   ├── uploads/
│   └── persistent-data/
└── current -> releases/20260805-013000/
```

### 22.4 Deployment flow

```text
validate artifact
→ create immutable release
→ pre-deploy backup/checkpoint if required
→ migration dry run
→ staging deploy
→ health + smoke + browser checks
→ approval if required
→ canary or production swap
→ observe
→ confirm or compensate
```

### 22.5 Database migration policy

- expand/contract migrations preferred;
- destructive operations require explicit approval;
- backup or recovery checkpoint required;
- backward compatibility verified during rolling transition;
- application rollback must account for schema state;
- migration version and checksum stored as evidence.

---

## 23. Security Model

### 23.1 Sandbox

Each task receives:

- isolated Git worktree;
- isolated container or microVM;
- dedicated unprivileged identity;
- CPU, memory, process, disk, and wall-time limits;
- explicit network allowlist;
- scoped temporary credentials;
- no production `.env` access;
- append-only action audit.

### 23.2 Tool capability tokens

Agents do not receive a generic unrestricted shell authority.

Example capability set:

```yaml
capabilities:
  filesystem:
    read:
      - repository/**
    write:
      - repository/src/**
      - repository/tests/**
  commands:
    - npm
    - npx
    - git
  network:
    - registry.npmjs.org
  services:
    - staging_database
  prohibited:
    - production_database
    - root
    - system_config
```

### 23.3 Prompt-injection defense

Repository content, issue text, logs, and web pages are untrusted data.

Agents are instructed and runtime-enforced to:

- ignore instructions embedded in repository data;
- never expose secrets;
- require policy-layer authorization for tool capabilities;
- treat fetched content as evidence, not system instructions;
- redact credential-like strings from model context and logs.

### 23.4 Nightforge self-modification

Nightforge cannot autonomously deploy changes to its own production orchestrator.

Self-change workflow:

```text
separate staging instance
→ full replay and end-to-end tests
→ independent review
→ human approval
→ controlled upgrade
```

---

## 24. Memory and Compounding Intelligence

### 24.1 Do not feed an ever-growing context file

The old single `.nightforge/context.md` concept is replaced by selective structured memory.

### 24.2 Memory classes

| Class | Example | Write policy |
|---|---|---|
| Invariant | “Every tenant query requires organization_id” | Human- or test-verified |
| Architecture decision | “Use outbox pattern for billing events” | Accepted contract |
| Procedure | “Run fixture reset before browser tests” | Verified successful run |
| Failure pattern | “Node 22 image requires libvips package” | Reproduced evidence |
| Preference | “Use server actions only in admin app” | Project configuration |
| Ephemeral fact | Current ticket hypothesis | Do not promote automatically |

### 24.3 Memory record

```yaml
memory_id:
type:
statement:
scope:
evidence:
confidence:
created_by:
verified_by:
valid_from:
expires_at:
supersedes:
retrieval_tags:
```

### 24.4 Memory promotion

A worker may propose memory. Memory Curator checks:

- reusable beyond the current ticket;
- supported by evidence;
- not already captured;
- not version-conflicted;
- scoped narrowly;
- contains expiry when appropriate.

### 24.5 Selective skills

A skill is loaded only when:

- task tags match;
- framework/version match;
- prior telemetry shows benefit;
- token overhead remains acceptable.

Every skill has a version, applicability rule, and measured utility.

---

## 25. Observability and Evaluation

### 25.1 Correlation

Every event carries:

```text
project_id
workflow_id
ticket_id
agent_run_id
model_call_id
deployment_id
```

### 25.2 Metrics

#### Outcome

- accepted task rate;
- rollback rate;
- regression rate;
- human intervention rate;
- criteria coverage;
- time to accepted outcome.

#### Agent

- first-attempt success;
- repair success;
- tool-call validity;
- context size;
- output tokens;
- runtime;
- repeated-action rate;
- premature-completion rate.

#### Model routing

- cost/credits per accepted task;
- accepted success by role and task class;
- reviewer rejection by author model;
- latency;
- provider error rate;
- cache hit rate.

#### Human efficiency

- human turns per accepted task;
- decisions per epic;
- time spent reading summaries;
- percentage completed with zero follow-up.

The north-star metric is:

```text
verified value delivered per human minute
```

### 25.3 Evaluation set

Create a private Nightforge benchmark from real repositories:

- 20 small tickets;
- 20 medium features;
- 10 complex epics;
- 5 environment/bootstrap failures;
- 5 security or migration reviews.

Pin repository commits and deterministic verifiers. Re-run after model, prompt, or orchestration changes.

---

## 26. Linear Integration

### Linear’s role

Linear stores:

- human goal;
- priority;
- visible status;
- decisions;
- concise outcome summary;
- links to evidence.

It does not store full model transcripts or canonical workflow state.

### Labels

```text
forge:ticket
forge:epic
forge:product
risk:low
risk:medium
risk:high
deploy:direct
deploy:staging
deploy:manual
```

Most users should not need to set technical labels. Nightforge infers them and allows override.

### States

```text
Backlog
Ready for Forge
Understanding
Building
Verifying
Waiting for Decision
Ready for Approval
Released
Failed
Rolled Back
```

Internal substates remain in Temporal and are summarized into these human-readable states.

---

## 27. Telegram Interface

Commands:

```text
/status
/today
/decisions
/approve NF-123
/reject NF-123 reason
/pause project-id
/resume project-id
/cancel NF-123
/budget
/explain NF-123
```

`/explain` returns:

- what Nightforge understood;
- what it changed;
- evidence;
- assumptions;
- current risk;
- next action.

No hidden reasoning transcript is required.

---

## 28. Project Configuration

```yaml
version: 2

project:
  id: my-saas
  name: My SaaS
  repository: /srv/apps/my-saas/repository
  timezone: Asia/Bangkok

autonomy:
  profile: balanced
  infer_reversible_decisions: true
  max_decision_packet_items: 5
  unanswered_decision_policy: pause_affected_branch

workflow:
  engine: temporal
  max_product_depth: 3
  max_parallel_tickets: 4
  max_write_tasks: 1
  max_readonly_tasks: 3
  max_runtime_minutes: 90
  max_repairs_per_strategy: 2
  max_total_attempts: 4

context:
  small_token_budget: 20000
  medium_token_budget: 60000
  large_token_budget: 150000
  max_additional_interface_briefs: 2

validation:
  install_command: npm ci
  lint_command: npm run lint
  typecheck_command: npm run typecheck
  unit_command: npm test
  integration_command: npm run test:integration
  build_command: npm run build
  browser_command: npm run test:e2e
  bootstrap_command: ./ops/bootstrap-check.sh

deployment:
  default_policy: blast-radius
  direct_prod_allowed: true
  deploy_command: ./ops/deploy.sh
  healthcheck_command: ./ops/healthcheck.sh
  rollback_command: ./ops/rollback.sh
  observation_minutes: 10

risk:
  approval_required:
    - authentication
    - authorization
    - billing
    - destructive-migration
    - account-deletion
    - secrets
    - infrastructure
    - public-api-breaking

models:
  roles:
    explorer:
      preferred: [deepseek-v4-pro, qwen3.7-max]
    routine_implementer:
      preferred: [qwen3.7-plus, deepseek-v4-pro]
    complex_implementer:
      preferred: [qwen3.7-max, glm-5.2]
    reviewer:
      preferred: [glm-5.2, qwen3.7-max]
  require_family_diversity_for:
    - high
    - critical

budget:
  ordinary_ticket_usd: 3
  complex_ticket_usd: 10
  epic_usd: 30
  daily_usd: 50
  alert_at_percent: 80

permissions:
  allowed_services:
    - github
    - sentry
    - cloudflare
  prohibited_actions:
    - delete-production-database
    - rotate-production-secrets
    - disable-authentication
    - force-push-main
```

---

## 29. Provider Registry and Policy

Model prices, promotions, context limits, and availability change. Do not hard-code them in business logic.

```yaml
providers:
  - id: alibaba-payg
    protocol: openai-compatible
    automation_allowed: true
    data_region: global
    models:
      - id: qwen3.7-max
        family: qwen
        capabilities: [reasoning, tools, structured-output, long-context]
      - id: qwen3.7-plus
        family: qwen
        capabilities: [reasoning, tools, structured-output, vision]
      - id: glm-5.2
        family: glm
        capabilities: [reasoning, tools, structured-output]
        adapter:
          tool_stream: true
      - id: deepseek-v4-pro
        family: deepseek
        capabilities: [reasoning, tools]

  - id: alibaba-personal-token-plan
    protocol: openai-compatible
    automation_allowed: false
    usage_mode: interactive-only
```

Registry updates are signed/config-reviewed. A provider-health job checks models and capabilities without automatically changing production routing.

---

## 30. Cost Control

### Principles

- optimize cost per accepted outcome, not cost per token;
- use smaller task capsules;
- use stable cacheable prefixes;
- suppress verbose narratives;
- stop repeated non-progress loops;
- use deterministic tools before model calls;
- use high-capability models when they reduce retries;
- schedule eligible work during cheaper windows only when provider terms permit automation.

### Budget object

```yaml
budget:
  currency: USD
  hard_limit:
  soft_limit:
  max_model_calls:
  max_tool_rounds:
  max_wall_minutes:
  escalation_reserve:
```

### Progress-aware termination

Stop an agent when:

- same command/action repeats without new evidence;
- test pass count does not improve across configured attempts;
- diff size grows while acceptance coverage does not;
- budget reserve is required for review or integration;
- provider errors exceed retry policy.

---

## 31. Build Strategy: What to Implement First

Nightforge itself must be built in thin vertical slices.

### Phase 0 — Safety and feasibility

Deliver:

- provider usage-policy registry;
- local Docker sandbox;
- one demo repository;
- deterministic validation runner;
- audit events;
- no production deployment.

Exit:

- one bounded task can be executed without host access or secret leakage.

### Phase 1 — Single Ticket Forge

Deliver:

- Linear webhook;
- Temporal TicketWorkflow;
- one model provider;
- ForgeRunner;
- Git worktree;
- tests and result comment;
- Telegram completion notice.

Exit:

- one low-risk ticket runs end to end after one human action.

### Phase 2 — Reliable Verification and Deployment

Deliver:

- staging release;
- health checks;
- rollback compensation;
- Playwright smoke test;
- workflow restart/replay test;
- approval signal.

Exit:

- kill and restart the orchestrator during a run; workflow resumes correctly.

### Phase 3 — Context and Independent Review

Deliver:

- repository index;
- Explorer;
- task capsules;
- reviewer (high-risk classes only, per §21);
- failure triage;
- structured memory proposals.

Exit:

- medium tickets succeed with bounded context and automated verification; high-risk tickets additionally pass independent evidence review.

### Phase 4 — Epic DAG

Deliver:

- Atomizer;
- Planner;
- dependency scheduler;
- ownership;
- interface briefs;
- integration workflow.

Exit:

- one multi-module epic completes with parallel independent tasks and no file collision.

### Phase 5 — Product Mode

Deliver:

- product brief;
- Decision Packet;
- architecture competition;
- executable architecture contract;
- Bootstrap Gate;
- vertical-slice roadmap.

Exit:

- a small SaaS is built from one high-level goal to staging.

### Phase 6 — Adaptive Routing

Deliver:

- outcome telemetry;
- prompt versions;
- role/task success estimates;
- conservative cheapest-capable routing;
- experiment framework.

Exit:

- routing decisions outperform fixed rules on the private benchmark.

### Phase 7 — Open-Source Productization

Deliver:

- one-command installer;
- diagnostics;
- upgrade and backup;
- documentation;
- optional dashboard;
- provider SDK;
- integration SDK.

Do not build the web dashboard before the Linear/Telegram workflow is excellent.

---

## 32. Non-Goals for v1

- a simulated company with dozens of talking personas;
- unrestricted agent-to-agent chat;
- autonomous production changes to Nightforge itself;
- full repository context on every call;
- support for every model provider;
- self-modifying prompts without evaluation;
- vector database as the sole code-understanding method;
- direct production as the default;
- replacing deterministic tests with model judgment;
- browser automation, quota evasion, or mechanisms intended to conceal provider usage.

---

## 33. Open-Source Strategy

- **License:** Apache-2.0 or MIT after reviewing desired patent protection; choose once before public launch.
- **Core:** provider-agnostic orchestration, artifacts, policies, execution.
- **Adapters:** independent packages for providers, boards, notifications, and sandboxes.
- **Examples:** one Next.js/PostgreSQL SaaS and one multi-service project.
- **Documentation:** one-command quick start, architecture, safety, provider policy, extension guides.
- **Community:** GitHub Discussions, Issues, public roadmap, reproducible benchmark.
- **Compatibility:** versioned artifact schemas and migration guides.
- **Trust:** publish benchmark methodology, failure cases, and cost accounting.

---

## 34. Success Criteria

Nightforge is successful when a technically capable product owner can:

1. describe a feature or product outcome once;
2. leave the system unattended;
3. return to verified staging software;
4. receive at most one consolidated decision request;
5. inspect clear evidence and assumptions;
6. approve production from a phone;
7. recover automatically from ordinary failures;
8. improve throughput and quality as project telemetry accumulates.

Initial measurable targets:

```text
≥ 70% low-risk tickets accepted with zero human follow-up
≤ 1 human decision packet per medium epic
100% changes linked to executable evidence
100% production deployments have a rollback path
0 attempts to bypass provider-enforced quota or supported-client limits
0 concurrent file ownership conflicts
```

---

## Appendix A — Research Basis

The architecture synthesizes mechanisms from:

- **SaaSBench: Exploring the Boundaries of Coding Agents in Long-Horizon Enterprise SaaS Engineering** — arXiv:2605.17526
- **CodeTeam: An LLM-Powered Multi-Agent Framework for Repository-Level Code Generation** — arXiv:2606.22082
- **ROMA: Recursive Open Meta-Agent Framework for Long-Horizon Multi-Agent Systems** — arXiv:2602.01848
- **Agyn: A Multi-Agent System for Team-Based Autonomous Software Engineering** — arXiv:2602.01465
- **Agentless: Demystifying LLM-based Software Engineering Agents** — arXiv:2407.01489
- **SWE-Explore: Benchmarking How Coding Agents Explore Repositories** — arXiv:2606.07297
- **SWE-Skills-Bench: Do Agent Skills Actually Help in Real-World Software Engineering?** — arXiv:2603.15401
- **RepoZero: Can LLMs Generate a Code Repository from Scratch?** — arXiv:2605.07122
- **ProjDevBench: Benchmarking AI Coding Agents on End-to-End Project Development** — arXiv:2602.01655
- **SWE-agent and mini-SWE-agent**
- **OpenHands runtime architecture**
- **Temporal durable execution and human approval patterns**

These sources inform design choices; they do not prove that any single architecture can currently complete arbitrary SaaS products without human oversight. Nightforge’s own benchmark and production telemetry remain the ultimate validation.

---

## Appendix B — Glossary

| Term | Definition |
|---|---|
| Artifact | Typed, validated output shared between workflow stages |
| Atomizer | Decides whether a task is atomic or must be decomposed |
| Bootstrap Gate | Mandatory clean-environment setup verification |
| Decision Packet | Bundled set of only the human decisions that are truly required |
| Executable Architecture Contract | Machine-checkable design governing interfaces, ownership, dependencies, tests, and deployment |
| ForgeRunner | Minimal bounded model/tool loop used by leaf agents |
| Interface brief | Compact description of a dependency’s public surface |
| Product Mode | End-to-end workflow from idea to deployed SaaS |
| Task capsule | Compact task-specific context given to one worker |
| Temporal Activity | Retriable external operation invoked by a durable workflow |
| Vertical slice | A thin user-visible capability implemented through all system layers |

---

## Appendix C — Nightforge v2.1 Subscription-First Model Strategy

**This appendix supersedes Sections 12, 13, and 29 wherever they conflict.**

### C.1 Engineering hierarchy

```text
LEVEL 3 — PRINCIPAL ENGINEERS
GPT-5.6 Sol • optional Claude Opus 5
Critical architecture, security, billing, destructive migrations, final arbitration

LEVEL 2 — SENIOR ENGINEERS
Qwen3.8 Max • GPT-5.6 Terra • GLM-5.2 • optional Kimi K3
Planning, decomposition, complex implementation, integration, independent review

LEVEL 1 — LEAF WORKERS
DeepSeek V4 Flash • GPT-5.6 Luna • Qwen3.7 Plus • Qwen3.8 Max when discounted
Exploration, routine implementation, tests, repairs, summaries, bounded review
```

The majority of model calls must remain at Level 1. Principal models receive compressed decision artifacts, not raw transcripts or entire logs.

### C.2 Primary capacity pools

#### Alibaba subscription pool

Use as the main high-volume execution pool:

- **Qwen3.8 Max:** overnight planning, complex implementation, multimodal UI diagnosis, and large-context reasoning while its observed credit economics remain attractive.
- **DeepSeek V4 Flash:** default repository explorer, routine coder, repair worker, log analyst, and candidate generator.
- **Qwen3.7 Plus:** repetitive CRUD, mechanical refactors, documentation, and low-risk bounded tasks.
- **GLM-5.2:** independent reviewer, adversarial test designer, and alternate reasoning family.
- **Qwen3.7 Max:** pinned/stable fallback when Qwen3.8 Preview behavior is inconsistent.

The router learns actual credits per accepted task. It does not invent a fixed dollar conversion for opaque subscription credits.

#### ChatGPT Plus / Codex / ACP pool

Use as the second primary pool:

- **GPT-5.6 Luna:** economical independent worker, test designer, failure triage agent, reviewer, and artifact compressor.
- **GPT-5.6 Terra:** default senior engineer for integration, large-diff review, medium/high-complexity planning, and difficult repair.
- **GPT-5.6 Sol:** principal engineer for the highest-impact decisions and deadlocked failures.

The ChatGPT pool is quota-aware and reserves capacity for human interactive work and principal escalation.

#### Optional premium API pool

- **Claude Opus 5:** optional independent principal when frontier-family diversity has high expected value.
- **Kimi K3:** optional long-horizon repository specialist only after private evaluation proves a measurable advantage.
- **A visual specialist such as a current Gemini Flash-class model:** optional only if Qwen’s visual/browser performance is insufficient on Nightforge’s own UI benchmark.

Do not add providers merely to make the model list larger.

### C.3 Role matrix

| Role | Default | Alternative | Principal escalation |
|---|---|---|---|
| Intake Compiler | Qwen3.8 Max | Terra | Sol |
| Decision Curator | Terra | Qwen3.8 Max | Sol |
| Atomizer / DAG Planner | Qwen3.8 Max | Terra | Sol |
| Architecture Candidate A | Qwen3.8 Max | — | — |
| Architecture Candidate B | Terra | GLM-5.2 | — |
| Design Judge | Terra normally; Sol for critical designs | GLM-5.2 | Claude Opus 5 |
| Repository Explorer | DeepSeek V4 Flash | Luna | Qwen3.8 Max |
| Routine Implementer | DeepSeek V4 Flash | Luna / Qwen3.7 Plus | Qwen3.8 Max |
| Complex Implementer | Qwen3.8 Max | Terra | Sol |
| Test Designer | Luna | GLM-5.2 / DeepSeek V4 Flash | Terra |
| Failure Triage | DeepSeek V4 Flash | Luna | Terra |
| Routine Reviewer | Luna | GLM-5.2 | Terra |
| High-risk Reviewer | Terra | GLM-5.2 | Sol / Claude Opus 5 |
| Integrator | Terra | Qwen3.8 Max | Sol |
| Release Verifier | Luna | GLM-5.2 | Terra |
| Memory Curator | DeepSeek V4 Flash | Qwen3.7 Plus / Luna | — |
| Progress Summarizer | Luna | Qwen3.7 Plus | — |
| Very long repo-wide specialist | Qwen3.8 Max | optional Kimi K3 | Sol |

### C.4 Model-specific use

#### DeepSeek V4 Flash

Use when the task is bounded, tests are strong, and many inexpensive attempts are valuable. It is the default for exploration, routine implementation, test repair, and log analysis.

Do not give it unreviewed control over architecture, authentication, permissions, billing, destructive migrations, or production release decisions.

#### GPT-5.6 Luna

Use Luna partly for model-family diversity. It is especially useful for:

- second-opinion localization;
- test design;
- routine implementation through ACP;
- concise diff review;
- failure classification;
- release evidence review;
- compressing worker results into senior-engineer artifacts.

#### Qwen3.8 Max

Qwen3.8 Max is a bridge model: it can be an economical worker during favorable credit windows and a senior planner or complex implementer. Use pinned aliases when possible and retain Qwen3.7 Max/Terra fallbacks because Preview behavior can change.

#### GPT-5.6 Terra

Terra is the default senior engineer. It should:

- review large diffs;
- integrate task branches;
- diagnose cross-service failures;
- normalize architecture into an implementation DAG;
- repair work that passes local checks but fails system acceptance;
- prepare concise Principal Decision Memos for Sol.

#### GPT-5.6 Sol

Sol is the principal engineer, not the routine manager. Invoke it for:

- material product architecture choices;
- contradictory requirements;
- security, tenancy, authorization, billing, or destructive migration decisions;
- final root-cause analysis after senior models fail;
- high-blast-radius release review;
- deciding whether an unsafe workflow must stop for the human.

Sol receives only the accepted contract, options, evidence, risks, and exact question.

#### Claude Opus 5

Use only when one of these conditions is met:

- the Sol and Qwen/Terra conclusions conflict on a critical decision;
- a security or data-loss concern remains unresolved;
- two senior strategies have failed;
- an architecture is expensive to reverse and warrants an external frontier opinion.

#### GLM-5.2

Use as a family-diverse reviewer inside the Alibaba pool, especially for Qwen-authored plans and DeepSeek/Qwen patches.

#### Hermes

Hermes Agent is a runtime/harness, not a model tier. Nightforge may borrow its provider and terminal-runtime ideas, but Hermes is not selected as a foundation-model worker.

### C.5 Subscription-aware routing

The router minimizes:

```text
subscription shadow cost
+ optional API cash cost
+ expected retries
+ expected review cost
+ expected human minutes
+ regression risk
```

#### Default rules

```text
read-only repository exploration
  → DeepSeek V4 Flash
  → Luna second opinion if confidence is low

small, low-risk, strongly tested task
  → DeepSeek V4 Flash
  → Luna or Qwen3.7 Plus for repair/diversity

Qwen3.8 promotional window and observed credits are favorable
  → allow Qwen3.8 as the default overnight implementer

cross-module design or implementation
  → Qwen3.8 Max or Terra

integration-heavy failure
  → Terra
  → Qwen3.8 alternative
  → Sol only after a compressed failure memo

auth, permissions, billing, deletion, secrets, destructive migration
  → Qwen3.8 or Terra author
  → independent GLM/Luna/Terra review
  → Sol principal review
  → human production approval

critical disagreement
  → optional Claude Opus 5 tie-breaker
```

### C.6 Suggested subscription reserves

```yaml
alibaba_pool:
  overnight_leaf_work: 55%
  complex_qwen_work: 25%
  independent_glm_review: 10%
  emergency_reserve: 10%

chatgpt_pool:
  luna_leaf_and_review: 30%
  terra_senior_work: 30%
  sol_principal_work: 15%
  human_interactive_reserve: 25%
```

These are initial policies. Actual routing should use observed quotas and acceptance telemetry.

### C.7 Shadow pricing

Subscription models receive a dynamic shadow price:

```text
Qwen3.8 during a favorable credit window → very low shadow price
Luna with abundant credits              → low shadow price
Terra near quota reset                   → medium/high shadow price
Sol with little reserve                  → very high shadow price
GLM reviewing a Qwen patch               → diversity bonus
```

This makes subscription and optional API lanes comparable without pretending their billing units are identical.

### C.8 Principal-call gate

A Sol or Claude Opus 5 call requires:

```yaml
principal_decision_memo:
  exact_question:
  business_consequence:
  accepted_requirements:
  architecture_invariants:
  candidate_options:
  evidence:
  failed_strategies:
  risk_if_wrong:
  output_needed:
```

### C.9 Minimal-human-turn principle

```text
one human outcome
→ one requirements contract
→ one task graph
→ many bounded worker tasks
→ deterministic evidence
→ one senior integration pass
→ principal model only for unresolved consequential decisions
→ one consolidated human decision packet if needed
```

High-level models create durable directives once. They do not repeatedly supervise every tool call.
