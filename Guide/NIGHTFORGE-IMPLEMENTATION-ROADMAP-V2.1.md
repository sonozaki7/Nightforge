# Nightforge Implementation Roadmap

**Goal:** Build the smallest reliable version first, then add hierarchy and intelligence only after the end-to-end loop is proven.

---

## Guiding Principle

Nightforge should not begin as a large multi-agent platform.

The first useful product is:

```text
one Linear ticket
→ one durable workflow
→ one isolated worker
→ deterministic tests
→ staging deploy
→ verified result
```

Everything else builds on this spine.

---

## Phase 0 — Architecture and Safety Foundation

### Deliverables

- TypeScript monorepo.
- PostgreSQL schema.
- Temporal development cluster.
- Fastify API.
- structured event model.
- provider registry with `automation_allowed`.
- one PAYG provider adapter.
- Docker sandbox with unprivileged user.
- Git worktree manager.
- deterministic command runner.
- audit log.
- demo repository and fixed test ticket.

### Critical tests

- provider key marked interactive-only is rejected by daemon;
- sandbox cannot read host secrets;
- sandbox cannot write outside worktree;
- duplicate activity call is idempotent;
- workflow state survives worker restart.

### Exit criterion

A local CLI can execute one fixed task in a sandbox and produce a validated artifact without touching production.

---

## Phase 1 — Single Ticket Forge

### Deliverables

- Linear webhook verification.
- issue-to-TicketWorkflow mapping.
- simple risk classifier.
- task capsule.
- minimal ForgeRunner.
- one implementer prompt.
- lint/type/test/build gate.
- Git commit.
- Linear result comment.
- Telegram completion notification.

### User experience

```text
Move issue to Ready for Forge
→ receive one completion or precise blocker
```

### Do not build yet

- architecture competition;
- multiple agents;
- adaptive routing;
- dashboard;
- memory;
- direct production.

### Exit criterion

At least 15 low-risk real tickets complete with a recorded success rate and no host isolation failure.

---

## Phase 2 — Durable Deployment

### Deliverables

- immutable releases.
- staging deployment.
- health checks.
- rollback compensation.
- human approval signal.
- observation timer.
- Playwright smoke test.
- failure categories.
- workflow replay tests.

### Chaos tests

- stop worker during model call;
- stop worker during build;
- stop orchestrator while waiting for approval;
- fail health check after symlink swap;
- deliver duplicate Linear webhook;
- deliver duplicate approval signal.

### Exit criterion

Every test resumes or compensates without an ambiguous release state.

---

## Phase 3 — Exploration, Review, and Memory

### Deliverables

- tree-sitter and LSP index.
- repository Explorer.
- line/token budgets.
- independent Reviewer (high-risk classes only; reversible work is gated by automated verification + instant rollback, per `PHILOSOPHY.md`).
- Test Designer.
- Failure Triage.
- structured memory proposals and curation.
- prompt registry and versions.

### Evaluation

Compare:

```text
single implementer with broad context
vs.
explorer → bounded implementer → automated verification (plus reviewer for high-risk)
```

Measure accepted success, total tokens, human turns, and time.

### Exit criterion

The structured pipeline materially improves medium-ticket acceptance or cost per accepted outcome.

---

## Phase 4 — Epic DAG

### Deliverables

- Atomizer.
- DAG Planner.
- Temporal child workflows.
- file ownership.
- interface index and briefs.
- dependency-aware ready queue.
- integration workflow.
- requeue on interface changes.
- Decision Packet.

### Test epic

Implement a realistic feature touching:

- database;
- API;
- background job;
- frontend;
- permissions;
- browser acceptance flow.

### Exit criterion

Independent branches run concurrently without overlapping writes, then integrate successfully.

---

## Phase 5 — Product Mode

### Deliverables

- ProductWorkflow.
- Intake Compiler.
- architecture candidates.
- Design Judge.
- executable architecture contract.
- Bootstrap Gate.
- vertical-slice roadmap.
- traceability matrix.
- full product acceptance workflow.

### Reference product

Build one opinionated SaaS template:

- Next.js;
- TypeScript;
- PostgreSQL;
- authentication;
- organizations;
- background jobs;
- email;
- billing stub;
- Playwright;
- staging deployment.

The goal is not to make Nightforge dependent on this stack. It provides a reproducible end-to-end test target.

### Exit criterion

From one product brief and at most one Decision Packet, Nightforge produces a usable staging application.

---

## Phase 6 — Adaptive Model Routing

### Deliverables

- per-role and per-task outcome statistics.
- model/provider health.
- cost and credit accounting.
- prompt-version attribution.
- conservative success estimates.
- cheapest-capable routing.
- family-diverse review.
- experiment and canary system.

### Rules

- no adaptive routing before enough samples;
- never explore models on critical production work;
- policy eligibility is never overridden by the learning router;
- keep a deterministic fallback configuration.

### Exit criterion

Adaptive routing beats fixed rules on the private Nightforge benchmark without increasing regressions.

---

## Phase 7 — Open-Source Product

### Deliverables

- one-command Docker installation.
- setup wizard.
- diagnostics command.
- backup and upgrade procedures.
- sample Linear workspace configuration.
- provider adapter SDK.
- integration SDK.
- documentation site.
- optional web dashboard.
- public benchmark harness.
- security policy and threat model.

### Exit criterion

A new technical user can install Nightforge, connect one project, and complete a safe demo ticket in under 30 minutes.

---

## Initial PostgreSQL Entities

```text
projects
project_configs
workflows
tickets
task_graphs
task_nodes
agent_runs
model_calls
artifacts
artifact_versions
decisions
approvals
validation_runs
deployments
memory_records
provider_credentials
model_registry
routing_statistics
audit_events
```

---

## Initial Temporal Workflows

```text
TicketWorkflow
AgentRunWorkflow
DeploymentWorkflow
```

Add later:

```text
EpicWorkflow
ProductWorkflow
BenchmarkWorkflow
PromptCanaryWorkflow
```

---

## Initial Tools

Read-only:

```text
list_tree
search_text
list_symbols
get_definition
get_references
read_region
git_history
read_test_map
```

Mutating:

```text
apply_patch
create_file
delete_file_with_policy
run_command
git_commit
```

Validation:

```text
run_lint
run_typecheck
run_tests
run_build
run_browser_test
read_logs
```

Do not begin with unrestricted shell tool schemas exposed directly to every role. The runtime may implement commands through a constrained shell activity.

---

## First 90-Day Milestones

### Days 1–14

- Phase 0 complete.
- One provider.
- One sandbox.
- One deterministic test repo.

### Days 15–35

- Phase 1 complete.
- 15–30 real low-risk tickets.
- Fix workflow and prompt failure modes before adding roles.

### Days 36–55

- Phase 2 complete.
- staging and rollback.
- chaos/replay tests.

### Days 56–75

- Phase 3 complete.
- Explorer, Reviewer, Failure Triage.
- first private benchmark report.

### Days 76–90

- Phase 4 prototype.
- one complex epic.
- decision packet and dependency-aware parallelism.

Product Mode should begin only after the ticket and epic foundations are reliable.

---

## Definition of Done for Nightforge Features

A Nightforge feature is complete only when:

- workflow behavior is deterministic and replay-tested;
- mutating activities are idempotent;
- failure and retry behavior are specified;
- audit events are emitted;
- permissions are enforced by runtime, not prompt;
- user-facing outcome is visible in Linear or Telegram;
- tests cover duplicate events and process restarts;
- documentation is updated;
- no interactive-only provider key is accepted by unattended execution.

---

## v2.1 Subscription-First Implementation Override

### Phase 0 provider deliverables

Build these adapters first:

1. Alibaba subscription-backed model lane.
2. ChatGPT/Codex/ACP lane with Luna, Terra, and Sol selection.
3. Provider quota snapshots and reset times.
4. Subscription shadow-price calculator.
5. Human-use and principal-use quota reserves.
6. Optional Claude Opus 5 PAYG adapter, disabled by default.

### First routing sequence to implement

```text
DeepSeek V4 Flash explorer
→ DeepSeek/Luna routine implementer
→ deterministic tests
→ Luna/GLM review when required
→ Terra integration on medium tasks
→ Sol only through PrincipalDecisionMemo
```

### Initial provider tests

- Alibaba quota exhaustion pauses or reroutes without losing task state.
- ChatGPT quota reserve cannot be consumed by ordinary leaf tickets.
- Sol cannot be selected for a leaf-role request.
- Principal calls without a PrincipalDecisionMemo are rejected.
- optional Opus spend cannot exceed its monthly cap.
- duplicate ACP result delivery is idempotent.
- provider reset restores paused work safely.
