# Nightforge Model Routing v2.1

**Primary pools:** Alibaba Personal Token Plan and ChatGPT Plus/Codex/ACP  
**Optional exception lane:** Claude Opus 5 API  
**Goal:** Maximize verified software delivered per human minute and per subscription credit.

## 1. Model pyramid

### Principal

- **GPT-5.6 Sol:** critical architecture, security, billing, destructive migration, final arbitration, deadlocked root-cause analysis.
- **Claude Opus 5:** optional independent frontier opinion when diversity is worth the cash cost.

### Senior

- **GPT-5.6 Terra:** integration, large-diff review, medium/high-complexity planning, cross-service debugging.
- **Qwen3.8 Max:** architecture candidates, complex implementation, large context, overnight work when credit-efficient.
- **GLM-5.2:** independent review, adversarial tests, alternate plan family.
- **Kimi K3:** optional long-horizon specialist only after private evidence.

### Leaf

- **DeepSeek V4 Flash:** default repository explorer and high-volume implementation/repair worker.
- **GPT-5.6 Luna:** independent worker, test designer, reviewer, triage agent, evidence compressor.
- **Qwen3.7 Plus:** repetitive bounded changes.

## 2. Task routing

| Task | First model | Review/second opinion | Escalation |
|---|---|---|---|
| Repository localization | DeepSeek V4 Flash | Luna | Qwen3.8 Max |
| Small tested fix | DeepSeek V4 Flash | Luna | Qwen3.8 Max |
| Repetitive CRUD/refactor | Qwen3.7 Plus | Luna | Qwen3.8 Max |
| UI/browser evidence | Qwen3.8 Max | Luna/visual specialist | Terra |
| Test plan | Luna | GLM-5.2 | Terra |
| Medium feature | Qwen3.8 or DeepSeek | GLM/Luna | Terra |
| Cross-module feature | Qwen3.8 Max | Terra | Sol |
| Integration failure | Terra | Qwen3.8 Max | Sol |
| Product architecture | Qwen3.8 + Terra candidates | Sol judge | Opus 5 |
| Security/auth/permissions | Terra or Qwen3.8 | GLM/Luna | Sol + optional Opus |
| Billing/data deletion | Terra | GLM-5.2 | Sol + human |
| Destructive migration | Terra | Qwen3.8/GLM | Sol + human |
| Long repo-wide refactor | Qwen3.8 Max | Terra | Kimi K3 or Sol |
| Release evidence | Luna | GLM-5.2 | Terra |
| Critical release | Sol | optional Opus 5 | Human |

## 3. Minimal-turn execution

```text
Human goal
→ IntakeBrief
→ RequirementsContract
→ TaskGraph
→ TaskCapsules
→ leaf implementation
→ deterministic verification
→ senior integration
→ principal arbitration only when needed
→ one consolidated decision packet
```

## 4. Routing score

```text
expected_total_cost =
  subscription_shadow_cost
  + optional_api_cost
  + expected_retry_cost
  + expected_review_cost
  + expected_human_minutes
  + regression_penalty
```

Choose the lowest expected-total-cost model that clears the role’s success and risk threshold.

## 5. Private evaluation

Measure per model, role, task class, repository, and prompt version:

- first-pass acceptance;
- acceptance after repair;
- human turns;
- credits or cash;
- wall time;
- reviewer rejection;
- rollback;
- regression within seven days.

Public benchmarks seed the router. Nightforge’s own accepted outcomes replace them.
