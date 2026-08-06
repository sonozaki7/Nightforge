# Integration SDK

How to connect Nightforge to a new external system (Roadmap Phase 7).
Every integration follows the same shape: a typed client module, an
interface that the rest of the system depends on, and zod validation at
the boundary.

## The pattern

1. **Module**: `src/integrations/<name>.ts` (kebab-case), one primary
   export `create<Name>Client(...)` returning an interface.
2. **Interface first**: dependents import the interface
   (`LinearClient`), never the implementation. This is what
   makes every integration mockable in tests.
3. **Validate inbound data**: webhook payloads and API responses are
   untrusted — validate with zod schemas before use
   (see `webhookPayloadSchema` in `src/server.ts`).
4. **Verify authenticity** where the protocol offers it (Linear webhooks
   use HMAC-SHA256 signatures; reject anything unsigned).
5. **Secrets from environment only**: keys arrive via `src/config.ts`,
   never as parameters baked into callers, never logged.
6. **Structured logs** with pino; include correlation ids (ticket/epic),
   never secrets.

## Outbound notifications

Ticket lifecycle events are reported to the project tracker via the
`LinearClient` (`postComment`), so status never depends on an extra
channel being configured. Decision packets are persisted as artifacts
and the recommended defaults apply — a delivery channel is an optional
add-on, not a requirement.

The `DecisionPacket` artifacts (`artifactStore`) are the source of truth
for unresolved questions; a future channel (Slack, email, comment
reply-loop) only needs to read those artifacts and call
`AskOncePolicy.answerDecision` to join the loop.

## Inbound triggers

Triggers land in the Fastify server (`src/server.ts`). Adding one means:

1. Define a zod schema for the payload.
2. Verify the request signature.
3. Translate to Nightforge types (`LinearIssue`, `TicketJob`) and hand
   off to the scheduler or epic dispatch — the webhook handler must stay
   thin.

## Tests

- Mock all network calls (vitest + `vi.fn()` implementations of the
  interface); AGENTS.md forbids real API calls in tests.
- Cover: signature rejection, invalid payload → 4xx, happy path,
  API failure handling (return a neutral value like `null`/`[]` and log).
