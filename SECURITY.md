# Security Policy — Nightforge

Nightforge orchestrates autonomous coding agents with real credentials and
release authority. This document is the security policy and threat model
(Roadmap Phase 7 deliverable).

## Scope

In scope: the Nightforge orchestrator (webhook server, queue, workers,
integrations, artifact store). Out of scope: vulnerabilities in upstream
model providers or in the code the agents produce for other projects.

## Reporting

Report suspected vulnerabilities privately to the maintainers before any
public disclosure. Do not open public issues for unpatched security bugs.
Confirmed issues get a fix release and a credit in the changelog.

## Threat model

### Assets

1. Provider and integration credentials (Linear, DashScope,
   Anthropic, OpenRouter, Stripe, Cloudflare).
2. The repositories Nightforge manages (source of truth for user projects).
3. Release authority: the ability to merge, deploy, or roll back.
4. Human attention: approval gates and Decision Packets.

### Threat actors

- External attackers reaching the webhook endpoint or the dashboard.
- Compromised or misbehaving model output (prompt injection via ticket
  descriptions, issue bodies, or repository content).
- Insider misuse of the host running Nightforge.

### Key threats and mitigations

| Threat | Mitigation |
| --- | --- |
| Forged Linear webhooks | HMAC-SHA256 signature verification with a dedicated secret; unsigned or invalid payloads are rejected with 401. |
| Secret leakage in logs | Structured logs carry correlation ids only; secrets are read from environment variables and never logged. Diagnostics report presence, never values. |
| Agents touching production | Blast-radius classification gates releases; high-risk classes require human approval; the reviewer blocks prohibited paths; workers get scoped repository access only. |
| Prompt injection via ticket text | Ticket content is treated as untrusted data, validated with zod schemas, and never executed as instructions outside the bounded agent contract. |
| Runaway spend | Daily budget cap, per-ticket cost accounting in the unified cost ledger, and conservative adaptive routing that never explores models on critical work. |
| Silent failure | Every failure produces a triage record; releases that fail verification are auto-reverted; the morning digest surfaces only shipped evidence. |
| Memory poisoning | Agents never write memory directly; lessons become proposals and are curated with a corroboration threshold before acceptance. |

## Operational rules

- All secrets come from environment variables; `.env` files are never committed.
- Workers never receive production credentials; sandboxes are per-ticket worktrees.
- One human approval is required for high blast-radius changes (PHILOSOPHY.md).
- Backups of `.nightforge/artifacts` and Redis persistence are the operator's
  recovery path (see `docs/OPERATIONS.md`).

## Supported versions

Only the latest release receives security fixes. Upgrade procedure is
documented in `docs/OPERATIONS.md`.
