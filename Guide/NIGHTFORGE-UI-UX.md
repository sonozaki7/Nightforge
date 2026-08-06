# NIGHTFORGE UI/UX PRODUCT DESIGN SPECIFICATION

**Status:** Authoritative implementation guide  
**Audience:** Product designers, frontend engineers, backend engineers, and autonomous implementation agents  
**Scope:** Native Nightforge web application, responsive mobile experience, feedback surfaces, and integration projections  
**Updated:** 4 August 2026  
**Companion specifications:** `NIGHTFORGE-V2.1.md`, `NIGHTFORGE-MODEL-ROUTING-V2.1.md`, `NIGHTFORGE-AGENT-PROMPTS-V2.1.md`

---

# 0. How to Use This Document

This document has two layers:

1. **Stable product laws**  
   These should remain valid even if the frontend framework, model providers, integrations, or individual screens change.

2. **Concrete implementation specification**  
   These define the recommended information architecture, routes, components, state models, data contracts, interactions, and acceptance criteria for the first high-quality Nightforge product.

When requirements conflict, apply this priority:

```text
Safety and permission
→ canonical domain model
→ minimum human attention
→ evidence and trust
→ simplicity
→ speed
→ visual style
```

Normative terms:

- **MUST** — required for the product to preserve its intended behavior.
- **SHOULD** — strongly recommended; deviation requires a documented reason.
- **MAY** — optional implementation choice.

Agents implementing Nightforge MUST not treat wireframes as pixel-perfect final designs. They MUST preserve the object model, interaction rules, user flows, and acceptance criteria.

---

# 1. Product Definition

Nightforge is an **Outcome Operating System**.

It converts:

- goals;
- feedback;
- operational problems;
- user evidence;
- business constraints;
- repository state;
- system telemetry;

into:

- governed Outcomes;
- autonomous Plans;
- verified software changes;
- safe Releases;
- organizational Learning;
- concise Decisions for humans.

The defining experience is:

> **State what matters once. Leave. Return to verified progress.**

The primary product metric is:

> **Verified value delivered per waking human minute.**

Nightforge is not primarily:

- a chat interface;
- an issue tracker;
- a code editor;
- an agent animation dashboard;
- a replacement for GitHub, Linear, Sentry, Figma, or support software;
- a terminal exposed to nontechnical users.

Those systems can remain specialized surfaces. Nightforge owns the cross-system workflow from intent to verified result.

---

# 2. Product Laws

These rules apply to every screen and interaction.

## 2.1 Outcome-first

The primary user-facing unit MUST be an **Outcome**.

Tasks, agent runs, commits, tool calls, and model messages are implementation details beneath an Outcome.

Good:

```text
External contractors can be invited safely.
```

Bad:

```text
Agent 3 is editing invitation-service.ts.
```

## 2.2 One canonical object graph

Nightforge MUST maintain one canonical set of objects.

Different roles see different projections of the same object. The system MUST NOT create separate founder, product, design, and engineering copies of the same work.

## 2.3 Human judgment is scarce

Nightforge SHOULD infer reversible implementation details from:

- project policy;
- repository convention;
- accepted architecture;
- prior verified decisions;
- evidence.

Nightforge MUST ask humans when a choice materially affects:

- product behavior;
- money;
- user rights;
- data;
- security;
- legal commitments;
- irreversible architecture;
- production risk.

## 2.4 Decisions are explicit objects

A human-blocking question MUST become a `Decision`.

It MUST NOT remain buried in:

- chat;
- comments;
- logs;
- pull requests;
- Telegram messages;
- agent summaries.

## 2.5 Evidence outranks narrative

A model statement is not proof.

Completion MUST be represented through evidence such as:

- acceptance criteria;
- tests;
- browser behavior;
- screenshots;
- user validation;
- deployment health;
- observed metrics;
- rollback readiness.

## 2.6 Progress must be asynchronous and legible

Users MUST be able to leave and return without losing context.

The UI MUST show meaningful system states, not vague animation.

## 2.7 Participation and authority are separate

Anyone may contribute a Signal if allowed.

Only authorized users or policy may:

- commit an Outcome;
- approve a Decision;
- deploy;
- modify policy;
- authorize high-risk action.

## 2.8 Progressive disclosure

The default view SHOULD show:

```text
Outcome
State
Impact
Evidence
Risk
Required action
```

Technical details MUST be available to authorized users without dominating the default experience.

## 2.9 Stable objects, flexible screens

The object model and interaction rules are stable.

The exact visual layout MAY change as the product matures.

---

# 3. Users and Product Modes

## 3.1 Primary user roles

### Founder / Owner

Needs:

- cross-project priorities;
- Away Plans;
- Decisions;
- verified results;
- capacity;
- risk;
- phone approval;
- technical drill-down when desired.

### Technical Lead / Engineer

Needs:

- Plans;
- task dependencies;
- repositories;
- diffs;
- tests;
- workflow traces;
- model routes;
- interactive rescue;
- deployment evidence.

### Product / Design / Operations

Needs:

- Opportunities;
- Outcomes;
- user or process evidence;
- acceptance scenarios;
- review surfaces;
- role-specific Decisions;
- no requirement to understand code.

### Support / Sales / Customer Success

Needs:

- fast Signal capture;
- customer association;
- duplicate clustering;
- status;
- contributor follow-up.

### Public or Customer Contributor

Needs:

- simple contextual feedback;
- acknowledgment;
- privacy control;
- status;
- validation request;
- resolution update.

## 3.2 Presentation modes

The application uses one data model with four UI projections.

### Simple Mode

For:

- public users;
- executives;
- occasional reviewers;
- nontechnical contributors.

Shows:

- outcome;
- evidence summary;
- status;
- required action;
- result.

### Team Mode

For:

- product;
- design;
- operations;
- support;
- sales;
- customer success.

Adds:

- Opportunities;
- Signals;
- contributors;
- scenarios;
- experiments;
- Review Studio.

### Engineering Mode

Adds:

- Plan graph;
- tasks;
- repositories;
- diffs;
- tests;
- model route;
- environments;
- workflow history.

### Operator Mode

Adds:

- Temporal details;
- worker health;
- sandbox state;
- provider capacity;
- audit log;
- recovery controls.

Mode changes presentation and allowed actions. It MUST NOT create duplicate records.

---

# 4. Canonical Domain Model

The backend and frontend SHOULD share generated TypeScript types from a common schema package.

## 4.1 Signal

A raw contribution or observation.

```typescript
type SignalType =
  | "bug_report"
  | "improvement"
  | "user_feedback"
  | "process_problem"
  | "design_feedback"
  | "metric_anomaly"
  | "policy_concern"
  | "goal"
  | "system_event"
  | "other";

interface Signal {
  id: string;
  workspaceId: string;
  projectId?: string;
  type: SignalType;
  title: string;
  originalContent: string;
  normalizedSummary?: string;
  source: SignalSource;
  contributorId?: string;
  visibility: "public" | "customer" | "workspace" | "restricted";
  sensitivity: "normal" | "confidential" | "restricted";
  attachments: EvidenceRef[];
  environment?: EnvironmentContext;
  consent?: ConsentRecord;
  status: "received" | "triaged" | "linked" | "dismissed";
  linkedOpportunityIds: string[];
  linkedOutcomeIds: string[];
  createdAt: string;
}
```

## 4.2 Opportunity

A synthesized problem or improvement area.

```typescript
interface Opportunity {
  id: string;
  projectId: string;
  title: string;
  problemStatement: string;
  affectedUsers: AudienceSummary[];
  signalIds: string[];
  evidenceStrength: "low" | "medium" | "high";
  severity: "low" | "medium" | "high" | "critical";
  trend: "declining" | "stable" | "rising" | "new";
  strategicFit: number; // 0–100
  confidence: number; // 0–100
  recommendedAction: "observe" | "research" | "experiment" | "implement" | "decline";
  linkedOutcomeIds: string[];
  ownerId?: string;
  state: "open" | "researching" | "committed" | "resolved" | "declined";
  createdAt: string;
  updatedAt: string;
}
```

## 4.3 Outcome

The central object.

```typescript
type OutcomeState =
  | "proposed"
  | "understanding"
  | "needs_decision"
  | "ready"
  | "planned"
  | "building"
  | "verifying"
  | "ready_for_review"
  | "ready_for_release"
  | "releasing"
  | "observing"
  | "completed"
  | "paused"
  | "failed"
  | "rolled_back"
  | "cancelled";

interface Outcome {
  id: string;
  projectId: string;
  title: string;
  desiredState: string;
  businessValue?: string;
  audience?: AudienceSummary[];
  state: OutcomeState;
  priority: "urgent" | "high" | "normal" | "low";
  risk: RiskLevel;
  autonomyEnvelopeId: string;
  planId?: string;
  acceptanceCriteria: AcceptanceCriterion[];
  sourceSignalIds: string[];
  sourceOpportunityIds: string[];
  decisionIds: string[];
  releaseIds: string[];
  currentGate?: GateSummary;
  progress: OutcomeProgress;
  confidence?: number;
  estimatedWindow?: TimeRange;
  ownerId?: string;
  contributorIds: string[];
  createdAt: string;
  updatedAt: string;
}
```

## 4.4 Plan

```typescript
interface ForgePlan {
  id: string;
  outcomeId: string;
  version: number;
  status: "draft" | "accepted" | "running" | "superseded" | "completed";
  summary: string;
  taskGraph: TaskGraph;
  acceptanceMap: AcceptanceMap;
  riskSummary: RiskSummary;
  capacityForecast: CapacityForecast;
  releaseStrategy: ReleaseStrategy;
  assumptions: Assumption[];
  generatedAt: string;
  acceptedAt?: string;
}
```

## 4.5 Decision

```typescript
type DecisionState =
  | "open"
  | "answered"
  | "delegated"
  | "expired"
  | "superseded"
  | "cancelled";

interface Decision {
  id: string;
  workspaceId: string;
  projectId?: string;
  outcomeIds: string[];
  type:
    | "product"
    | "design"
    | "operations"
    | "architecture"
    | "security"
    | "data"
    | "release"
    | "budget"
    | "scope"
    | "communication";
  question: string;
  whyItMatters: string;
  recommendation?: DecisionOption;
  options: DecisionOption[];
  evidenceRefs: EvidenceRef[];
  riskIfWrong?: string;
  reversible: boolean;
  estimatedAnswerSeconds?: number;
  deadline?: string;
  defaultIfUnanswered?: DecisionOption;
  requiredRole?: string;
  assigneeId?: string;
  state: DecisionState;
  answer?: DecisionAnswer;
  createdAt: string;
}
```

## 4.6 Evidence

```typescript
type EvidenceKind =
  | "user_report"
  | "screenshot"
  | "video"
  | "session_replay"
  | "test_result"
  | "build_result"
  | "browser_trace"
  | "metric"
  | "log_excerpt"
  | "diff"
  | "review"
  | "approval"
  | "deployment_health"
  | "user_validation"
  | "rollback_proof"
  | "document";

interface Evidence {
  id: string;
  projectId?: string;
  kind: EvidenceKind;
  title: string;
  summary: string;
  status: "reported" | "inferred" | "verified" | "rejected" | "expired";
  source: EvidenceSource;
  artifactUrl?: string;
  structuredData?: unknown;
  visibility: "public" | "customer" | "workspace" | "restricted";
  createdAt: string;
}
```

## 4.7 Release

```typescript
type ReleaseState =
  | "prepared"
  | "staging"
  | "validated"
  | "awaiting_approval"
  | "canary"
  | "production"
  | "observing"
  | "confirmed"
  | "rolled_back"
  | "failed";

interface Release {
  id: string;
  projectId: string;
  version: string;
  outcomeIds: string[];
  environment: "staging" | "production";
  state: ReleaseState;
  evidenceIds: string[];
  risk: RiskLevel;
  rollback: RollbackSummary;
  observationWindow?: TimeRange;
  contributorUpdateState?: "not_required" | "pending" | "sent";
  createdAt: string;
}
```

## 4.8 Away Plan

```typescript
interface AwayPlan {
  id: string;
  workspaceId: string;
  startsAt: string;
  returnAt: string;
  type: "sleep" | "meeting" | "deep_work" | "travel" | "weekend" | "vacation" | "custom";
  outcomeIds: string[];
  autonomyEnvelope: AutonomyEnvelope;
  capacityForecast: CapacityForecast;
  expectedResults: ExpectedResult[];
  protectedCapacity: ProtectedCapacity;
  notificationPolicy: AwayNotificationPolicy;
  state: "draft" | "scheduled" | "running" | "completed" | "cancelled";
}
```

## 4.9 Learning

```typescript
interface Learning {
  id: string;
  projectId: string;
  type: "product_rule" | "architecture_invariant" | "procedure" | "failure_pattern" | "preference";
  statement: string;
  evidenceIds: string[];
  confidence: number;
  visibility: "team" | "engineering" | "restricted";
  validFrom: string;
  expiresAt?: string;
  supersededById?: string;
}
```

---

# 5. State Machines and UI Mapping

The frontend MUST derive states from backend workflow truth. It MUST NOT independently invent completion states.

## 5.1 Outcome state machine

```text
proposed
  ↓
understanding
  ├── needs_decision ──answer──┐
  └────────────────────────────┘
  ↓
ready
  ↓
planned
  ↓
building
  ↓
verifying
  ├── failed → repair → building
  ├── needs_decision
  └── ready_for_review
        ↓
ready_for_release
        ↓
releasing
        ├── rolled_back
        ├── failed
        └── observing
              ↓
completed
```

Side states:

```text
paused
cancelled
```

## 5.2 Human-readable state labels

| Internal state | Default label | Meaning |
|---|---|---|
| proposed | Proposed | Not committed to execution |
| understanding | Understanding | Requirements and context being assembled |
| needs_decision | Waiting for decision | Human judgment required |
| ready | Ready | Sufficiently specified and eligible |
| planned | Planned | Execution graph accepted |
| building | Building | Active implementation |
| verifying | Verifying | Deterministic or human validation |
| ready_for_review | Ready for review | Role-specific validation needed |
| ready_for_release | Ready to release | Technical gates passed |
| releasing | Releasing | Deployment in progress |
| observing | Observing | Production or canary behavior monitored |
| completed | Verified | Outcome accepted and observed |
| paused | Paused | Intentionally stopped |
| failed | Needs intervention | Automatic path exhausted |
| rolled_back | Rolled back | Change reverted safely |
| cancelled | Cancelled | Outcome intentionally abandoned |

Avoid labels such as:

- Thinking
- Agent working
- Almost done
- Processing

## 5.3 Evidence levels

Evidence MUST display its verification level:

```text
Reported
Inferred
Tested
Reviewed
Staging observed
Production observed
User validated
```

The UI MUST NOT use one identical green check for all evidence levels.

---

# 6. Application Information Architecture

## 6.1 Desktop primary navigation

```text
Today
Decisions
Outcomes
Opportunities
Projects
Releases
Capacity
Insights
────────────
Contributors
Integrations
Policies
Settings
```

Engineering Mode adds:

```text
Runs
Evidence
```

Operator Mode adds:

```text
Operator
```

## 6.2 Mobile navigation

Bottom navigation:

```text
Today
Decide
Work
Feedback
More
```

Floating primary action:

```text
Contribute
```

For Owner roles, a secondary quick action MAY be:

```text
Set Outcome
```

## 6.3 Recommended routes

```text
/
  redirects to /today

/today
/decisions
/decisions/:decisionId

/outcomes
/outcomes/new
/outcomes/:outcomeId
/outcomes/:outcomeId/plan
/outcomes/:outcomeId/evidence
/outcomes/:outcomeId/technical

/opportunities
/opportunities/:opportunityId

/projects
/projects/:projectId
/projects/:projectId/outcomes
/projects/:projectId/opportunities
/projects/:projectId/releases
/projects/:projectId/memory
/projects/:projectId/policies
/projects/:projectId/environments
/projects/:projectId/technical

/away
/away/new
/away/:awayPlanId
/return-reports/:reportId

/releases
/releases/:releaseId

/review/:reviewId
/contribute
/contributions/:trackingToken

/capacity
/insights
/contributors
/integrations
/policies
/settings

/runs
/runs/:runId
/evidence/:evidenceId
/operator
```

Routes MAY evolve, but the object hierarchy MUST remain recognizable.

---

# 7. App Shell

## 7.1 Desktop shell

Structure:

```text
┌─────────────────────────────────────────────────────────────────────┐
│ Workspace switcher | Global search / command | Status | User       │
├───────────────┬─────────────────────────────────────────────────────┤
│ Primary nav   │ Page content                                        │
│               │                                                     │
│               │                                                     │
│               │                                                     │
└───────────────┴─────────────────────────────────────────────────────┘
```

Requirements:

- left navigation width: approximately 220–260 px;
- collapsible to icon rail;
- global command/search available from every screen;
- workspace and environment status always visible;
- critical incidents appear as a persistent top banner;
- no persistent model activity animation.

## 7.2 Page header

Every object page SHOULD include:

- breadcrumb or project context;
- title;
- state;
- primary action;
- secondary actions;
- risk when material;
- last meaningful update.

## 7.3 Command bar

The command bar searches:

- Outcomes;
- Opportunities;
- Decisions;
- Projects;
- Releases;
- Contributors;
- Evidence.

Supported commands SHOULD include:

```text
Create Outcome
Contribute Signal
Prepare Away Plan
Pause project
Open Decision
Find customer
View Release
Inspect run
Invite reviewer
```

Natural-language commands MAY map to structured actions:

```text
Show work blocked by me
What can safely run tonight?
Why did project X roll back?
Show feedback increasing this week
```

A command MUST preview consequential actions before execution.

---

# 8. Core Page Specifications

# 8.1 Today

## Purpose

Give the user the highest-leverage understanding and actions for the current moment.

Today is not a generic analytics dashboard.

## Required sections

Render only sections with meaningful content.

Priority order:

1. Critical safety or incident
2. Needs your judgment
3. Prepare your absence / active Away Plan
4. Verified while away
5. Important new Signal or Opportunity
6. Active Outcomes
7. Recommended next human action

## Desktop structure

```text
┌──────────────────────────────────────────────────────────────────────┐
│ Good evening, So                         Bangkok · System healthy ●  │
│ 11h 06m until your configured return time                           │
├──────────────────────────────────────────────────────────────────────┤
│ TONIGHT'S PLAN                                                       │
│ 8 Outcomes · 3 projects · 5 expected staging · 2 production         │
│ Alibaba low-credit window begins in 47 minutes                      │
│ [Review plan] [Start recommended plan]                              │
├──────────────────────────────────────────────────────────────────────┤
│ NEEDS YOUR JUDGMENT                                                  │
│ External-domain invitations · blocks 3 Outcomes · ~45 sec           │
│ Recommended: permit with organization-admin approval                │
│ [Approve] [Review alternatives]                                     │
├──────────────────────────────────────────────────────────────────────┤
│ VERIFIED WHILE AWAY                                                  │
│ 7 Outcomes · 2 Releases · 31 checks · 0 unresolved regressions       │
│ [Open return report]                                                 │
├──────────────────────────────────────────────────────────────────────┤
│ IMPORTANT SIGNAL                                                     │
│ Mobile onboarding reports increased 38% this week                   │
│ 43 Signals consolidated into one Opportunity                        │
│ [Review Opportunity]                                                 │
├──────────────────────────────────────────────────────────────────────┤
│ NEXT BEST HUMAN ACTION                                               │
│ Validate the mobile onboarding result with three affected users     │
└──────────────────────────────────────────────────────────────────────┘
```

## Component composition

```text
TodayPage
├── ContextGreeting
├── IncidentBanner?
├── AwayPlanSummary?
├── DecisionPriorityList?
├── ReturnReportSummary?
├── ImportantSignalCard?
├── ActiveOutcomeStrip?
└── NextBestActionCard?
```

## Empty state

```text
Nothing needs your attention.
Nightforge can continue safely until 07:00.
```

## Mobile

Mobile Today MUST prioritize:

- one critical banner;
- one primary Decision;
- Away Plan;
- return summary;
- next action.

No dense multi-column grid.

## Acceptance criteria

- A founder can identify required action in under ten seconds.
- No non-actionable agent activity appears above meaningful outcomes.
- Every card links to a canonical object.
- Critical risk remains visible until resolved or acknowledged.

---

# 8.2 Create Outcome

## Purpose

Allow an authorized user to state a desired result without writing an engineering ticket.

## Entry points

- global `Set Outcome`;
- project page;
- Opportunity action;
- Signal conversion;
- integration-created draft.

## Interaction model

Use a guided composer, not a blank issue form.

Step 1:

```text
What should become true?
```

Step 2:

```text
Who benefits or is affected?
```

Step 3:

```text
How will we know it worked?
```

Nightforge then proposes:

- normalized desired state;
- acceptance criteria;
- affected project;
- probable risk;
- assumptions;
- whether a Decision Packet is required.

## Layout

```text
┌──────────────────────────────────────────────────────────────┐
│ Set an Outcome                                               │
├──────────────────────────────────────────────────────────────┤
│ Desired result                                               │
│ [Admins can invite external contractors safely.............] │
│                                                              │
│ Evidence or context                                          │
│ [Attach] [Paste URL] [Record voice]                          │
│                                                              │
│ Nightforge understanding                                     │
│ Project: Tavia                                               │
│ Users: Organization administrators                           │
│ Success: invitation accepted, audited, and permission-safe   │
│ Risk: High — authorization                                   │
│                                                              │
│ One decision may be required                                 │
│ Whether external-domain invitations require approval         │
│                                                              │
│ [Edit understanding] [Commit Outcome]                        │
└──────────────────────────────────────────────────────────────┘
```

## Rules

- The user MUST NOT choose a model or repository.
- Technical fields MAY appear only in Engineering advanced options.
- Nightforge MUST show inferred assumptions before commitment.
- High-risk Outcomes MUST show expected approval gates.

---

# 8.3 Contribute

## Purpose

Create a Signal from any role with minimal effort.

## First question

```text
What are you sharing?
```

Options:

- Something is not working
- Improvement idea
- User or customer feedback
- Process that wastes time
- Design feedback
- Data or metric change
- Policy or compliance concern
- Desired result
- Other observation

## Supported input

- text;
- voice;
- screenshot;
- screen recording;
- document;
- URL;
- spreadsheet;
- external conversation;
- contextual product metadata.

## Adaptive understanding

After submission, Nightforge shows:

```text
Nightforge understood:
- Surface: mobile applicant onboarding
- Problem: final action becomes hidden by the keyboard
- Effect: users may abandon registration
- Device: iPhone
- Evidence attached: screenshot and session reference
```

Actions:

```text
Looks correct
Edit
Add context
```

## Rules

- The system SHOULD require at most one clarification bundle.
- Public contributors MUST see consent and privacy details before contextual capture.
- The original content MUST be preserved.
- The normalized summary MUST be clearly distinguishable from the original.

## Submission result

```text
Received
Reference NF-S-2841
Linked to: Mobile onboarding completion
[Track contribution]
```

---

# 8.4 Outcomes List

## Default view

A table on desktop, list cards on mobile.

Recommended columns:

- Outcome
- Project
- State
- Impact
- Risk
- Current gate
- Expected window
- Human action

## Filters

- project;
- state;
- owner;
- risk;
- priority;
- contributor;
- release;
- requires me;
- away-plan eligible;
- overdue.

## Saved views

Examples:

- Needs me
- Ready for tonight
- High risk
- Staging ready
- Released this week
- Feedback-driven

## Bulk actions

Allowed:

- add to Away Plan;
- pause;
- change priority;
- assign owner;
- archive completed.

Not allowed as a blind bulk action:

- production approval;
- destructive cancellation;
- policy override.

---

# 8.5 Outcome Detail

## Purpose

Provide one coherent view from original intent to verified result.

## Recommended page structure

```text
OutcomeHeader
OutcomeSummary
CurrentGate
Tabs:
  Overview
  Plan
  Evidence
  Contributors
  Releases
  Technical
```

## Header

Displays:

- title;
- desired state;
- state;
- priority;
- risk;
- project;
- owner;
- expected window;
- primary action.

Primary action changes by state:

| State | Primary action |
|---|---|
| proposed | Commit Outcome |
| needs_decision | Answer Decision |
| ready | Start / Add to Away Plan |
| building | View progress |
| ready_for_review | Review |
| ready_for_release | Approve Release if authorized |
| observing | View observation |
| completed | Review result |
| failed | Review intervention options |

## Overview tab

Sections:

1. Desired state
2. Why it matters
3. Acceptance
4. Current gate
5. Important assumptions
6. Connected Signals and Opportunity
7. Latest evidence
8. Timeline

## Plan tab

Team mode:

- milestone graph;
- dependencies;
- current branch;
- blocked nodes;
- expected completion.

Engineering mode additionally shows:

- task IDs;
- file ownership;
- agents/models;
- technical validation;
- worktrees.

## Evidence tab

Evidence grouped by criterion and verification level.

Example:

```text
Criterion: External invitations require administrator approval

Reported        12 customer requests
Tested          7 integration tests
Reviewed        Authorization review approved
Staging         Playwright scenario passed
Production      18-minute observation healthy
User validated  3/3 invited reporters confirmed
```

## Contributors tab

Shows:

- original contributors;
- customer organization where allowed;
- Signals;
- follow-up status;
- validation requests.

## Technical tab

Authorized users only:

- repository;
- branch/commit;
- diff;
- test report;
- model routing;
- run history;
- workflow trace;
- logs;
- sandbox;
- cost or credit estimate.

## Failure state

The page MUST clearly state:

- whether code changed;
- whether anything deployed;
- whether rollback happened;
- current safe state;
- exact blocker;
- recommended next action.

---

# 8.6 Decisions

## List view

Sort by:

1. urgent deadline;
2. risk;
3. number of blocked Outcomes;
4. estimated answer time;
5. creation time.

Each row/card includes:

- type;
- question;
- recommendation;
- blocked impact;
- estimated answer time;
- assignee;
- deadline.

## Decision detail layout

```text
┌──────────────────────────────────────────────────────────────┐
│ Product Decision · Blocks 3 Outcomes · About 45 seconds     │
├──────────────────────────────────────────────────────────────┤
│ Should external-domain invitations require admin approval?  │
│                                                              │
│ Recommended                                                  │
│ ● Yes, require organization-admin approval                   │
│                                                              │
│ Why                                                          │
│ Preserves flexibility while reducing accidental access.     │
│                                                              │
│ Evidence                                                     │
│ 12 requests · 7 support cases · authorization review         │
│                                                              │
│ Alternatives                                                 │
│ ○ Never allow external domains                               │
│ ○ Allow without additional approval                          │
│                                                              │
│ Affects                                                      │
│ Invitations · Audit logs · Email templates                   │
│                                                              │
│ [Approve recommendation] [Choose alternative]                │
│ [Delegate] [Request more evidence]                           │
└──────────────────────────────────────────────────────────────┘
```

## Interaction requirements

- One-tap recommendation approval MAY be used for reversible Decisions.
- Irreversible/high-risk Decisions MUST show typed or explicit confirmation.
- Answering MUST display affected Outcomes.
- Delegating MUST preserve final authority and deadline.
- Answer history MUST be immutable; supersession creates a new Decision.

## Batch review

The user MAY review a Decision Packet sequentially.

The UI SHOULD display:

```text
4 Decisions · approximately 6 minutes
```

---

# 8.7 Away Plan

## Purpose

Turn a period of human unavailability into governed productive capacity.

## Creation flow

1. Choose return time or away type.
2. Review recommended Outcomes.
3. Review autonomy and capacity.
4. Resolve preparation warnings.
5. Start or schedule.

## Required fields

- start;
- return;
- selected Outcomes;
- maximum risk;
- production policy;
- protected capacity;
- cash budget;
- stop conditions;
- notification policy.

## Recommended layout

```text
┌──────────────────────────────────────────────────────────────┐
│ AWAY PLAN · Tonight 21:00 → Tomorrow 07:00                  │
├──────────────────────────────────────────────────────────────┤
│ Expected results                                             │
│ 5–7 verified Outcomes · Confidence: Medium                   │
│                                                              │
│ Selected work                                                │
│ Tavia        3 Outcomes · staging + one low-risk production  │
│ AgentScrape  2 Outcomes · production eligible               │
│ Nightforge   2 Outcomes · internal staging                  │
│                                                              │
│ Protected capacity                                           │
│ ChatGPT interactive reserve 25%                              │
│ Sol principal reserve      Protected                         │
│                                                              │
│ Safety envelope                                              │
│ Maximum unattended risk   Medium                             │
│ Production                 Low-risk only                     │
│ Stop after                 2 critical failures               │
│                                                              │
│ Preparation warning                                           │
│ One Outcome lacks measurable acceptance                     │
│ [Let Nightforge prepare it]                                  │
│                                                              │
│ [Edit] [Dry run] [Schedule at cheapest window]               │
└──────────────────────────────────────────────────────────────┘
```

## Capacity fill

Action:

```text
Fill remaining capacity
```

Nightforge proposes work according to:

- priority;
- readiness;
- dependency;
- expected duration;
- verification cost;
- risk;
- quota window;
- strategic fit.

## Active plan view

Shows:

- time remaining;
- achieved checkpoints;
- active Outcomes;
- paused/blocked work;
- capacity remaining;
- protected reserve;
- any required urgent Decision.

It SHOULD NOT show every agent action.

## Cancellation

Cancelling an Away Plan MUST:

- stop starting new Outcomes;
- preserve safe active checkpoints;
- not abruptly kill a deployment unless required;
- explain what continues and what stops.

---

# 8.8 Return Report

## Purpose

Compress an Away Plan into a three-minute briefing.

## Sections

1. Summary
2. Biggest result
3. User/business effect
4. Decisions
5. Recovered failures
6. Releases
7. Best next action
8. Technical appendix

## Example

```text
While you were away

7 Outcomes verified across 3 projects
2 production Releases
3 staging Releases
1 Decision
1 automatically recovered failure
0 unresolved regressions

Biggest result
Recruiter onboarding is ready in staging.
All 14 acceptance scenarios passed.

User effect
The change addresses 43 Signals from 18 organizations.
Three original contributors were invited to validate it.

One Decision
Require approval for external-domain invitations?
Recommended: Yes.
Estimated answer time: 45 seconds.

Recovered automatically
Queue health failed after deployment.
Nightforge rolled back, repaired an idempotency mismatch,
redeployed, and observed the service for ten minutes.

Best use of your next 15 minutes
1. Answer the invitation policy.
2. Review the mobile before/after.
3. Add business constraints to usage billing.
```

## Technical appendix

Expandable only:

- commits;
- files;
- tests;
- runs;
- models;
- quota;
- logs;
- workflow trace;
- assumptions.

---

# 8.9 Opportunities

## List view

Columns:

- Opportunity
- Signals
- Affected users
- Severity
- Trend
- Confidence
- Strategic fit
- Recommendation
- State

## Detail view

Sections:

1. Problem statement
2. Affected journey
3. Evidence summary
4. Original Signals
5. User/customer segments
6. Trend and frequency
7. Business context
8. Current workaround
9. Unknowns
10. Related Outcomes
11. Experiments
12. Contributor follow-up

## Actions

- observe;
- request research;
- create experiment;
- commit Outcome;
- decline with reason;
- merge duplicate Opportunity;
- split mixed Opportunity.

## Scoring

Any score MUST expose its factors. Do not show a magic priority number without explanation.

---

# 8.10 Review Studio

## Purpose

Allow product, design, operations, engineering, and users to validate an Outcome against evidence.

## Review modes

- Before / After
- Design / Implementation
- Desktop / Mobile
- Old process / New process
- Control / Experiment
- Staging / Production
- Expected / Actual

## Required components

```text
ReviewViewport
EvidenceTimeline
AcceptanceChecklist
AnnotationLayer
ReviewerDecisionPanel
ViewportSelector
EnvironmentSelector
```

## Layout

```text
┌────────────────────────────────────────────────────────────────┐
│ Review: Mobile onboarding · 12/14 criteria verified           │
├──────────────────────────────┬─────────────────────────────────┤
│ BEFORE                       │ AFTER                           │
│ Interactive viewport         │ Staging viewport                │
│                              │                                 │
├──────────────────────────────┴─────────────────────────────────┤
│ Evidence timeline: 00:00 ─────●──────── 00:42                  │
│                                                                │
│ ✓ CTA remains visible                                         │
│ ✓ keyboard does not obscure action                            │
│ ✓ screen-reader label                                         │
│ ! transition timing differs from design standard              │
│                                                                │
│ [Approve] [Annotate] [Request correction]                     │
└────────────────────────────────────────────────────────────────┘
```

## Annotation model

An annotation MUST store:

- review ID;
- reviewer;
- environment/build;
- screen or process step;
- viewport;
- element selector when available;
- timestamp for recordings;
- text/voice content;
- classification;
- attached evidence.

## Review result

```typescript
interface ReviewResult {
  decision: "approve" | "request_changes" | "block";
  findings: ReviewFinding[];
  acceptedCriteriaIds: string[];
  rejectedCriteriaIds: string[];
}
```

## Rules

- A reviewer MUST not need Git knowledge.
- Technical evidence MAY be expanded.
- Review comments SHOULD be classified into:
  - acceptance failure;
  - defect;
  - design preference;
  - new Opportunity;
  - out of scope.

---

# 8.11 Releases

## List view

Show:

- version;
- project;
- Outcomes;
- environment;
- state;
- risk;
- health;
- observation;
- rollback;
- created time.

## Release detail

Sections:

1. Summary
2. Outcomes delivered
3. Acceptance evidence
4. Deployment timeline
5. Health and observation
6. Rollback
7. Contributor communication
8. Technical details

## Release card example

```text
Release 2026.08.04.3
Recruiter onboarding

Production · Observed healthy for 18 minutes
2 Outcomes
Addresses 43 user reports
31/31 checks
Product review ✓
Design review ✓
Rollback ready: under 5 seconds

[View evidence] [View Outcomes] [Roll back]
```

## Rollback interaction

Rollback MUST show:

- current environment;
- expected effect;
- data implications;
- whether schema state is compatible;
- estimated interruption;
- required confirmation.

---

# 8.12 Project Workspace

## Tabs

```text
Overview
Outcomes
Opportunities
Releases
Contributors
Memory
Policies
Environments
Technical
```

## Overview sections

- Project purpose
- Current health
- Active Outcomes
- Required Decisions
- Recent Signals
- Last Release
- Away-ready work
- Important rules
- Current risk

## What Nightforge Knows

Display durable project beliefs in understandable language.

Example:

```text
Nightforge currently believes:
- Every tenant query must include organization identity.
- Invitation links expire after 72 hours.
- Production Releases require browser acceptance.
- Japanese onboarding uses localized verification wording.
```

Actions:

```text
Correct
Add rule
View evidence
View technical form
```

Changes create a Decision or Learning, depending on authorization.

---

# 8.13 Capacity

## Default view

Translate resources into expected productive output.

Show:

- available away-time window;
- ready Outcome count;
- expected verified Outcome range;
- capacity by provider pool;
- protected human reserve;
- critical reserve;
- bottlenecks.

## Advanced view

May show:

- quota reset times;
- observed credits per accepted task;
- model success by role;
- queue delay;
- provider health;
- shadow cost;
- scheduled work;
- retry overhead.

## Policy presets

- Preserve human capacity
- Maximize away-time output
- Minimize cash spend
- Fastest safe completion
- Highest confidence
- Custom

---

# 8.14 Insights

## Required insight groups

### Founder leverage

- verified Outcomes per waking hour;
- work completed while away;
- human turns per Outcome;
- Decision time;
- interruption rate.

### Feedback loop

- Signal to Opportunity;
- Opportunity to Outcome;
- Outcome to Release;
- contributor acknowledgment;
- validation;
- closed-loop rate.

### Quality

- first-pass acceptance;
- repair attempts;
- rollback;
- regression;
- evidence coverage;
- false completion.

### Model and system

Engineering only:

- success by role/model;
- quota usage;
- provider failure;
- context size;
- review disagreement;
- environment failure.

Do not make lines of code or agent count primary metrics.

---

# 9. Core Reusable Components

Components SHOULD live in a shared design-system package.

## 9.1 OutcomeCard

Props:

```typescript
interface OutcomeCardProps {
  outcome: OutcomeProjection;
  density: "comfortable" | "compact";
  showProject?: boolean;
  showHumanAction?: boolean;
  onPrimaryAction?: () => void;
}
```

Displays:

- title;
- state;
- impact;
- risk when material;
- current gate;
- expected window;
- required action.

## 9.2 StateBadge

Requirements:

- text label;
- icon;
- color;
- accessible description;
- no color-only meaning.

## 9.3 RiskBadge

Levels:

```text
Low
Medium
High
Critical
```

Risk badge SHOULD be hidden for low-risk routine views unless needed for comparison.

## 9.4 DecisionCard

Displays:

- type;
- question;
- recommendation;
- blocked Outcomes;
- answer time;
- deadline;
- primary action.

## 9.5 EvidenceSummary

Displays evidence grouped by verification level.

## 9.6 AcceptanceChecklist

Each criterion has:

- description;
- state;
- evidence count;
- verifier;
- expandable proof.

## 9.7 ProgressGate

Shows current meaningful gate:

```text
Understanding
Implementation
Technical verification
Product review
Release approval
Production observation
```

## 9.8 ContributorChip

Shows contributor identity according to permission and privacy.

## 9.9 CapacityForecastCard

Displays:

- available time;
- expected result range;
- confidence;
- protected reserve;
- bottleneck.

## 9.10 AutonomyEnvelopeEditor

Controls:

- maximum risk;
- production permission;
- project scope;
- budget;
- provider reserve;
- stop condition;
- notification policy.

It MUST include presets and advanced settings.

## 9.11 BeforeAfterViewer

Supports:

- image;
- browser frame;
- video;
- process diagram;
- text/document diff.

## 9.12 TechnicalEvidenceDrawer

Authorized expandable drawer containing:

- repository;
- commits;
- tests;
- diff;
- run;
- model;
- logs;
- workflow trace.

## 9.13 WhyPanel

Every automated choice MAY expose:

```text
Why this happened
```

The panel references:

- policy;
- evidence;
- risk;
- project rules;
- capacity.

## 9.14 ContributionComposer

Supports adaptive inputs and preserves original content.

## 9.15 EmptyState

An empty state MUST explain:

- current condition;
- whether Nightforge can continue;
- useful optional action.

Good:

```text
No Decisions need you.
Nightforge can continue safely until 07:00.
```

---

# 10. End-to-End User Flows

# 10.1 Founder: complex feature

```text
Set Outcome
→ Nightforge understanding
→ confirm assumptions
→ one Decision Packet
→ Plan
→ add to Away Plan
→ autonomous execution
→ Return Report
→ role reviews
→ production approval
→ Release
→ observation
→ contributor follow-up
```

Maximum expected human interactions:

1. State Outcome
2. Answer consolidated Decision
3. Approve high-risk Release

## Acceptance

- No repository/model selection required.
- All human Decisions are consolidated.
- Technical detail remains available.
- Release links to source Signals and evidence.

---

# 10.2 Operations: automate process

```text
Contribute process problem
→ upload SOP/spreadsheet
→ Nightforge process understanding
→ one authority/source-of-truth Decision
→ scenarios
→ Outcome
→ staging tool
→ operations Review Studio
→ approval
→ Release
→ exception monitoring
```

## Acceptance

- Operations user never needs code terminology.
- Exceptions are visible.
- Sensitive fields respect permissions.
- Validation uses realistic scenarios.

---

# 10.3 Designer: experience correction

```text
Open Review Studio
→ annotate viewport/state
→ classification
→ bounded Outcome or task
→ implementation
→ visual/accessibility verification
→ designer approval
```

## Acceptance

- Annotation remains tied to build and state.
- New preference is not mislabeled as defect.
- Before/after is preserved.

---

# 10.4 Public user: feedback loop

```text
Submit contextual Signal
→ consent
→ acknowledgment
→ duplicate clustering
→ Opportunity
→ Outcome or experiment
→ validation invitation
→ Release
→ resolution update
```

## Acceptance

- User can submit without technical knowledge.
- User sees what context is attached.
- User cannot access private internal data.
- Public feedback cannot authorize production.
- Contributor receives closure when appropriate.

---

# 10.5 Founder: overnight operation

```text
Open Today
→ review recommended Away Plan
→ accept
→ sleep
→ Return Report
→ answer one Decision
→ validate biggest result
```

## Acceptance

- Plan preparation takes minutes.
- System protects configured quota.
- Report is understandable without opening technical details.
- Work near return time ends at stable checkpoints.

---

# 11. Notifications and Communication

## 11.1 Notification classes

### Immediate

- production incident;
- automatic rollback;
- security/data risk;
- hard budget stop;
- urgent Decision.

### Digest

- completed Outcomes;
- recovered failures;
- Opportunity changes;
- Away Plan result;
- Release observation;
- capacity forecast.

### Silent

- model retry;
- routine test failure;
- internal handoff;
- intermediate progress.

## 11.2 Notification schema

```typescript
interface Notification {
  id: string;
  severity: "info" | "action" | "warning" | "critical";
  title: string;
  summary: string;
  actionRequired: boolean;
  recommendedAction?: ActionRef;
  deadline?: string;
  consequenceIfIgnored?: string;
  objectRef: ObjectRef;
  channels: NotificationChannel[];
}
```

## 11.3 Telegram/mobile action

Actions MUST be secure and idempotent.

Examples:

- Approve recommendation
- Pause project
- Cancel Away Plan
- Roll back Release
- Open Review

High-risk actions MUST open the app for full consequence display.

---

# 12. Permissions and Privacy

## 12.1 Role examples

- Owner
- Technical Admin
- Product Lead
- Designer
- Operations
- HR Restricted
- Support/Sales
- Contributor
- Customer Reviewer
- External Expert
- Viewer

## 12.2 Permission dimensions

Authorization SHOULD evaluate:

- workspace;
- project;
- object;
- field;
- data classification;
- environment;
- action;
- role;
- temporary grant.

## 12.3 UI behavior

Unauthorized information MUST not be fetched and merely hidden in the frontend.

The BFF/API MUST return role-specific projections.

## 12.4 Sensitive content

The UI MUST support:

- redaction;
- consent;
- restricted visibility;
- retention;
- audit;
- temporary access;
- model/provider restrictions;
- secure attachment handling.

## 12.5 Public projection

Public users may see:

- their contribution;
- public status;
- questions addressed to them;
- released resolution.

They must not see:

- internal architecture;
- other customers;
- unreleased security detail;
- model logs;
- private priority;
- internal Decisions.

---

# 13. Integration UX

## 13.1 Canonical ownership

Each integration MUST document which system owns each field.

Example:

```text
Linear owns:
- human product priority
- human assignee
- planning description

Nightforge owns:
- autonomous state
- Plan
- Evidence
- Decisions
- Release
```

## 13.2 Linear

Recommended projection:

- parent Outcome links to one Linear issue/project;
- Nightforge posts concise state changes;
- autonomous child tasks remain internal unless human coordination requires visibility;
- detailed evidence links to Nightforge.

## 13.3 GitHub

Use for:

- repositories;
- commits;
- pull requests when configured;
- releases;
- code evidence.

Nightforge MUST not make GitHub the only place to understand product state.

## 13.4 Trello/Plane

Use as lightweight intake or planning adapters.

Do not project the complete autonomous task graph into a simple board.

## 13.5 Slack/Teams/Email

Conversations may create Signals or Decisions.

Nightforge MUST show a confirmation before converting ambiguous conversation into committed work.

## 13.6 Sentry/PostHog/support systems

These provide Evidence and Signals.

Nightforge connects them to:

- Opportunities;
- Outcomes;
- Releases;
- contributor follow-up.

---

# 14. Frontend Technical Architecture

## 14.1 Recommended stack

- TypeScript strict mode;
- React;
- Next.js App Router or equivalent;
- server components for initial authenticated page shell where beneficial;
- client components for interactive tables, graph, review, and live updates;
- TanStack Query for asynchronous server state;
- TanStack Table for dense lists;
- React Flow for Plan/Work Map;
- accessible headless primitives such as Radix;
- Tailwind or token-driven CSS;
- Tiptap/Lexical for structured contributions and rich evidence;
- Monaco only in Engineering/Operator technical surfaces;
- Playwright for end-to-end testing;
- Storybook for component states;
- PWA support for mobile Decisions and Return Reports;
- SSE or WebSocket for live domain events.

## 14.2 Package structure

```text
apps/
  web/
  public-feedback-widget/
  public-feedback-portal/
  review-link/
  docs/

packages/
  ui/
  design-tokens/
  domain-types/
  api-client/
  permissions/
  outcome-components/
  evidence-components/
  decision-components/
  feedback-sdk/
  localization/
  analytics/
```

## 14.3 Backend-for-frontend

The web application MUST use a Nightforge BFF.

The frontend SHOULD NOT query Temporal, model providers, or deployment systems directly.

BFF projections:

```typescript
type Projection =
  | FounderTodayProjection
  | OutcomeTeamProjection
  | OutcomeEngineeringProjection
  | ContributorOutcomeProjection
  | PublicContributionProjection;
```

## 14.4 Live updates

Domain events update the UI.

Recommended event names:

```text
signal.created
signal.linked
opportunity.updated
outcome.state_changed
outcome.progress_updated
decision.required
decision.answered
plan.updated
review.requested
review.completed
release.state_changed
release.rolled_back
evidence.verified
contributor.validation_requested
learning.created
capacity.updated
incident.created
```

The UI MUST treat events as hints and refetch canonical data where correctness matters.

## 14.5 Optimistic updates

Allowed for:

- draft editing;
- reorder;
- local filter;
- acknowledgment;
- reversible assignment;
- pause request display.

Not allowed for:

- deployment success;
- rollback success;
- Decision approval;
- permission change;
- destructive action.

## 14.6 Caching

- static project metadata may use long cache;
- Decisions, Releases, active Outcomes, and incidents require short cache or live invalidation;
- public tracking pages should use scoped cache;
- sensitive role projections must never leak across users.

## 14.7 Offline/PWA

Mobile SHOULD support:

- cached Return Report;
- cached open Decisions;
- draft contribution;
- offline read of recent Release evidence.

Consequential actions require confirmed connectivity.

---

# 15. API and BFF Contracts

Exact endpoint names MAY change. The resource boundaries SHOULD remain.

## 15.1 Core reads

```text
GET /api/today
GET /api/decisions
GET /api/decisions/:id
GET /api/outcomes
GET /api/outcomes/:id
GET /api/outcomes/:id/plan
GET /api/outcomes/:id/evidence
GET /api/opportunities
GET /api/opportunities/:id
GET /api/projects/:id
GET /api/releases/:id
GET /api/capacity
GET /api/return-reports/:id
```

## 15.2 Core writes

```text
POST /api/signals
POST /api/outcomes
POST /api/outcomes/:id/commit
POST /api/outcomes/:id/pause
POST /api/outcomes/:id/cancel
POST /api/decisions/:id/answer
POST /api/decisions/:id/delegate
POST /api/away-plans
POST /api/away-plans/:id/start
POST /api/away-plans/:id/cancel
POST /api/reviews/:id/submit
POST /api/releases/:id/approve
POST /api/releases/:id/rollback
```

## 15.3 Idempotency

All consequential mutations MUST support an idempotency key.

```http
Idempotency-Key: <uuid>
```

## 15.4 Error shape

```typescript
interface ApiError {
  code: string;
  message: string;
  userMessage: string;
  retryable: boolean;
  fieldErrors?: Record<string, string>;
  objectRef?: ObjectRef;
  correlationId: string;
}
```

The UI MUST display `userMessage`, with technical details available only in authorized views.

---

# 16. Visual Design System

## 16.1 Direction

The marketing site may preserve the old demon-game/forge identity.

The application MUST optimize for legibility and trust.

Desired tone:

- calm;
- dark-first;
- technical but not intimidating;
- ambitious;
- restrained;
- premium;
- inclusive.

## 16.2 Color roles

Use semantic tokens, not hard-coded component colors.

```text
background
surface
surface-elevated
border
text-primary
text-secondary
accent
success
warning
danger
critical
decision
info
```

Recommended visual character:

- deep neutral blue-black background;
- restrained cyan accent;
- warm near-white text;
- amber warning;
- red destructive;
- violet for principal/critical Decision;
- green for verified/healthy.

Offer light mode.

## 16.3 Typography

- body/UI: high-legibility sans-serif;
- display: distinctive brand face used sparingly;
- code/IDs: monospace;
- metrics: tabular figures.

## 16.4 Spacing

Use an 8 px base scale.

Common spacing:

```text
4, 8, 12, 16, 24, 32, 48, 64
```

## 16.5 Radius and elevation

Use subtle radius and elevation.

Avoid heavily rounded consumer-style cards across dense technical screens.

## 16.6 Motion

Allowed:

- meaningful state transition;
- expanding evidence;
- graph change;
- incoming Decision;
- deployment stage transition.

Disallowed:

- continuous agent thinking;
- ornamental particles in application content;
- blinking terminal activity;
- sound by default.

## 16.7 Density

Modes:

- Comfortable
- Compact
- Operator

Default Team/Simple: Comfortable  
Default Engineering: Compact

---

# 17. Responsive Design

## 17.1 Breakpoints

Exact values MAY follow the chosen design system, but behavior should support:

- phone;
- tablet;
- laptop;
- wide desktop.

## 17.2 Mobile priorities

Mobile is for:

- Today;
- Decisions;
- Away Plan;
- Return Report;
- contribution;
- Release approval;
- incident response;
- concise Outcome review.

Complex graph editing and full technical evidence MAY open a simplified view or recommend desktop.

## 17.3 Mobile patterns

- bottom navigation;
- sticky primary action;
- full-screen Decision flow;
- stacked cards;
- swipe only as optional enhancement, never sole interaction;
- large touch targets;
- no hover dependency.

## 17.4 Desktop patterns

- persistent navigation;
- side-by-side review;
- dense tables;
- resizable evidence drawer;
- Work Map;
- command bar.

---

# 18. Loading, Empty, Error, and Recovery States

Every screen MUST define these states before implementation is complete.

## 18.1 Loading

Use skeletons reflecting actual layout.

Avoid generic full-page spinners after initial navigation.

## 18.2 Empty

Explain:

- what the empty condition means;
- whether Nightforge can continue;
- one useful optional action.

## 18.3 Error

State:

- what failed;
- what remains safe;
- whether retry is available;
- whether action is required;
- correlation ID in technical details.

## 18.4 Stale data

For live workflow pages, show:

```text
Last updated 18 seconds ago
Reconnect
```

## 18.5 Partial failure

If one widget fails, preserve the rest of the screen.

Example:

- Capacity unavailable;
- Decisions and Outcomes still visible.

## 18.6 Permission denied

Explain the object exists only when revealing that fact is permitted.

Otherwise return a generic inaccessible state.

---

# 19. Accessibility and Internationalization

Target WCAG 2.2 AA.

Requirements:

- full keyboard navigation;
- visible focus;
- semantic headings;
- screen-reader labels;
- no color-only status;
- reduced motion;
- text zoom;
- high contrast;
- accessible graphs with tabular alternative;
- captions/transcripts;
- touch target minimums;
- language-aware date/time;
- timezone clarity;
- original-language evidence;
- translated summaries where configured.

Every technical summary SHOULD have a plain-language projection.

---

# 20. Analytics and Product Telemetry

UI telemetry MUST measure whether the product reduces human work.

## 20.1 Core UX events

```text
outcome_created
outcome_committed
decision_opened
decision_answered
decision_delegated
away_plan_created
away_plan_started
return_report_opened
return_report_expanded_technical
signal_submitted
signal_understanding_corrected
opportunity_committed
review_started
review_completed
release_approved
release_rolled_back
contributor_followup_sent
```

## 20.2 Human efficiency metrics

- human interactions per Outcome;
- time to create Outcome;
- time to answer Decision;
- Away Plan preparation time;
- Return Report comprehension proxy;
- percentage completed without follow-up;
- number of repeated questions;
- notification action rate.

## 20.3 Do not optimize for engagement

Long session duration is not automatically positive.

A successful founder experience may be:

```text
Open app
→ answer one Decision
→ approve plan
→ leave in under two minutes
```

---

# 21. Implementation Phases

## Phase 1 — Founder control loop

Build:

- app shell;
- Today;
- Outcomes;
- Outcome detail;
- Decisions;
- Away Plan;
- Return Report;
- Releases;
- Capacity;
- Linear/GitHub links;
- Telegram deep links.

Exit criteria:

- Founder can create one Outcome.
- Founder can prepare one Away Plan.
- Founder can return to a concise verified report.
- Founder can answer a Decision from mobile.
- Technical detail is available but not required.

## Phase 2 — Team contribution and review

Build:

- Contribute;
- Signal;
- role projections;
- Review Studio;
- contributor tracking;
- Operations/design flows;
- permissions;
- Slack/email intake.

Exit criteria:

- Nontechnical team member can submit useful context.
- Designer can review staging without Git knowledge.
- Signal can become Opportunity or Outcome.
- Contributor receives status.

## Phase 3 — Opportunity intelligence

Build:

- Opportunity list/detail;
- clustering;
- evidence provenance;
- customer association;
- transparent prioritization;
- experiment linkage.

Exit criteria:

- Duplicate feedback consolidates correctly.
- Product user can inspect source evidence.
- Opportunity can become an Outcome without manual rewriting.

## Phase 4 — Public feedback loop

Build:

- embedded widget;
- public tracking;
- consent;
- contextual capture;
- abuse controls;
- validation invitation;
- resolution update.

Exit criteria:

- Public user can submit and track.
- Privacy boundary is enforced.
- Public feedback cannot authorize production.
- Closed-loop update works.

## Phase 5 — Advanced engineering/operator UX

Build:

- Runs;
- workflow trace;
- sandbox state;
- provider capacity;
- interactive rescue;
- deep evidence;
- audit.

Exit criteria:

- Engineer can diagnose a blocked workflow.
- Founder never needs Operator Mode for routine work.
- Technical rescue returns control to the canonical Outcome workflow.

---

# 22. Screen-Level Definition of Done

A page is complete only when:

- purpose is explicit;
- canonical object source is defined;
- permissions are enforced server-side;
- loading state exists;
- empty state exists;
- error state exists;
- stale/live behavior exists;
- mobile behavior exists;
- keyboard behavior exists;
- analytics events exist;
- accessibility is tested;
- consequential actions use idempotency;
- plain-language projection exists where technical content appears;
- end-to-end test covers the primary action.

---

# 23. Agent Implementation Rules

Autonomous implementation agents MUST:

1. Read this document before modifying product UI.
2. Identify the canonical object involved.
3. Identify the user role and projection.
4. Define required state and permissions.
5. Reuse existing components before adding a new component.
6. Keep Outcome, Decision, Evidence, and Release terminology consistent.
7. Avoid adding model/provider detail to default nontechnical views.
8. Add loading, empty, error, mobile, and accessibility behavior.
9. Add or update Storybook states.
10. Add Playwright coverage for the primary workflow.
11. Record deviations from this specification.
12. Prefer fewer, stronger screens over a large collection of shallow dashboards.

Agents MUST NOT:

- make chat the only way to use a feature;
- expose raw workflow events as the default progress view;
- introduce fantasy terminology that reduces comprehension;
- add agent avatars or animated “thinking” as primary UI;
- duplicate canonical objects inside integrations;
- ask nontechnical users for repositories, models, or implementation choices;
- mark an Outcome verified without evidence;
- hide a required Decision inside comments;
- add a dashboard metric without a clear decision or action it supports.

---

# 24. Critical End-to-End Acceptance Scenarios

These scenarios should eventually exist as Playwright or equivalent product tests.

## Scenario 1 — Founder sets and runs an Outcome

```gherkin
Given an Owner is on Today
When they create an Outcome in plain language
Then Nightforge shows its normalized understanding
And the Owner can correct assumptions
And commit the Outcome
And the user is not asked for a repository or model
```

## Scenario 2 — Decision blocks work

```gherkin
Given an Outcome requires a product policy
When Nightforge creates a Decision
Then the Decision appears in Decisions and Today
And shows a recommendation and consequences
And answering it unblocks all affected Outcomes
And the question is not asked again
```

## Scenario 3 — Away Plan

```gherkin
Given several Outcomes are ready
When the Owner prepares an Away Plan
Then Nightforge forecasts expected results and confidence
And shows the Autonomy Envelope
And protects configured model capacity
And the Owner can start the plan with one confirmation
```

## Scenario 4 — Return Report

```gherkin
Given an Away Plan completed
When the Owner opens Today
Then a Return Report summarizes verified Outcomes
And shows Decisions before technical details
And identifies recovered failures
And recommends the next human action
```

## Scenario 5 — Nontechnical contribution

```gherkin
Given an Operations user has a process problem
When they contribute a description and spreadsheet
Then Nightforge shows its understanding
And does not ask for technical implementation details
And creates a Signal with provenance
And can convert it into an Opportunity or Outcome
```

## Scenario 6 — Design review

```gherkin
Given an Outcome is ready for design review
When a Designer opens Review Studio
Then they can compare expected and actual behavior
And annotate a specific state
And approve or request correction
Without viewing Git or model details
```

## Scenario 7 — Public feedback

```gherkin
Given a public user submits contextual feedback
When consent is granted
Then Nightforge stores the original Signal and allowed context
And returns a tracking reference
And does not reveal private information
And may later request validation
And can send a resolution update
```

## Scenario 8 — Release rollback

```gherkin
Given a production Release is unhealthy
When Nightforge rolls it back
Then the Release state becomes Rolled back
And the Outcome explains the safe current state
And an immediate notification is sent
And the user can inspect rollback evidence
```

## Scenario 9 — Permission projection

```gherkin
Given a Customer Reviewer and an Engineer view the same Outcome
Then they receive different projections
And the Customer Reviewer cannot fetch technical or private evidence
And both views reference the same Outcome identity
```

---

# 25. Final Product Standard

Nightforge should make an organization feel faster and more coherent, not merely more automated.

The product is successful when:

- founders spend minutes directing hours of verified work;
- nontechnical people can improve systems without translating themselves into engineering language;
- public users can contribute evidence and receive closure;
- technical users retain complete inspectability and control;
- important Decisions are explicit and scarce;
- every Release connects to Outcomes and Evidence;
- the system remains understandable as autonomous capacity grows.

The operating principle is:

> **One contribution, one canonical context, minimum handoffs, verified result.**

The user experience is:

> **Say what matters once. Leave. Return to verified progress.**
