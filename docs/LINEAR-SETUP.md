# Linear Workspace Setup (Sample Configuration)

Nightforge listens to Linear webhooks and acts only on issues it can trust.
This sample configuration sets up a fresh Linear workspace for Nightforge
(Roadmap Phase 7 deliverable).

## 1. Workflow states

Create (or rename) team states so tickets move through one trigger state:

| State | Type | Purpose |
| --- | --- | --- |
| Backlog | Triage | Ideas, not picked up. |
| Todo | Unstarted | Scoped work waiting for Nightforge. |
| Ready for AI | Unstarted | **Trigger state.** Moving an issue here hands it to Nightforge. |
| In Progress | Started | Nightforge claimed the ticket (comment confirms). |
| Awaiting Approval | Started | High blast-radius change held for one human tap. |
| Done | Completed | Shipped and verified. |
| Canceled | Canceled | Not happening. |

The trigger state name must be exactly `Ready for AI` (see `src/server.ts`).

## 2. Labels

| Label | Meaning |
| --- | --- |
| `epic` | Marks a parent issue whose children are executed as an epic DAG (waves, exclusive ownership). |
| `bug`, `feature`, `refactor`, `docs` | Free-form context passed into the ticket job. |
| `high-risk` (optional) | Hint for stricter review; the blast-radius classifier makes the final call. |

Label matching is case-insensitive.

## 3. Issue content conventions

- Title = one bounded objective.
- Description = acceptance criteria; mention repo-relative file paths
  (e.g. `src/queue/scheduler.ts`) — epic intake derives task ownership from
  them.
- Child issues of an epic each describe one independently shippable slice.

## 4. Webhook

Create a webhook in Linear (Settings → API → Webhooks):

- URL: `https://<your-host>/webhooks/linear`
- Resource: **Issues** (create/update)
- Secret: any strong random string; set it as `LINEAR_WEBHOOK_SECRET`.

Nightforge verifies every payload with HMAC-SHA256 and ignores anything
that is not an Issue update entering `Ready for AI`.

## 5. API key

Create a Linear API key (Settings → API → Personal API keys) with read/write
access to the team. Set it as `LINEAR_API_KEY`. Nightforge uses it to fetch
issues and child issues, post progress comments, and move states.

## 6. Verify

```bash
npm run diagnostics
```

Expect `[ok]` for `linear`. Then move a small test issue to `Ready for AI`
and watch for the "Nightforge claimed this ticket" comment.
