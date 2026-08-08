import Fastify from "fastify";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { Readable } from "node:stream";
import pino from "pino";
import { z } from "zod";
import type { LinearClient, LinearIssue } from "./integrations/linear.js";
import type { Scheduler, TicketJob } from "./queue/scheduler.js";
import { linearPriorityToNightforge, mapPriority } from "./queue/scheduler.js";
import type { EpicDispatch } from "./epic/epic-dispatch.js";
import type { ApprovalStore } from "./queue/approvals.js";
import type { TeamRouter } from "./projects/team-router.js";
import type { ProjectControl } from "./projects/control.js";
import { parseControlCommand } from "./projects/control.js";

const logger = pino({ name: "nightforge" });

const READY_STATE = "Ready for AI";

/** Raw request body captured before Fastify parses JSON (signature input). */
declare module "fastify" {
  interface FastifyRequest {
    rawBody?: Buffer;
  }
}

const webhookPayloadSchema = z.object({
  action: z.string(),
  type: z.string(),
  data: z.object({
    id: z.string(),
    title: z.string(),
    description: z.string().nullable().optional(),
    priority: z.number().default(4),
    state: z.object({
      name: z.string(),
    }),
    team: z
      .object({
        id: z.string(),
        name: z.string(),
      })
      .optional(),
    labels: z
      .array(z.object({ name: z.string() }))
      .optional()
      .default([]),
  }),
});

/** Comment webhook payloads drive the Linear approval reply loop. */
const commentPayloadSchema = z.object({
  action: z.string(),
  type: z.literal("Comment"),
  data: z.object({
    id: z.string(),
    body: z.string().nullable().optional(),
    issueId: z.string(),
  }),
});

interface WebhookBody {
  action: string;
  type: string;
  data: {
    id: string;
    title: string;
    description?: string | null;
    priority: number;
    state: { name: string };
    team?: { id: string; name: string };
    labels?: Array<{ name: string }>;
  };
}

export interface ServerDeps {
  linearClient: LinearClient;
  scheduler: Scheduler;
  webhookSecret: string;
  projectId: string;
  /**
   * Routes a Linear team to a project id; falls back to projectId when a
   * team is unmapped or no router is supplied.
   */
  teamRouter?: TeamRouter;
  /**
   * When set, tickets from `controlTeam` (id or name) are treated as
   * project-management commands instead of code tickets.
   */
  projectControl?: ProjectControl;
  controlTeam?: string;
  /** Tickets held by the release gate; `/approve` comments re-run them. */
  approvalStore: ApprovalStore;
  /** When present, epic-labeled issues are routed through the epic workflow. */
  epicDispatch?: EpicDispatch;
}

export function createServer(deps: ServerDeps): FastifyInstance {
  const server = Fastify({ logger: false });

  // Linear signs the raw request body; restringifying parsed JSON can
  // break the HMAC (docs: "strongly recommended to use raw request body").
  server.addHook("preParsing", async (request, _reply, payload) => {
    const chunks: Buffer[] = [];
    for await (const chunk of payload) {
      chunks.push(chunk as Buffer);
    }
    const raw = Buffer.concat(chunks);
    request.rawBody = raw;
    return Readable.from([raw]);
  });

  server.get("/health", () => {
    return { status: "ok", uptime: process.uptime() };
  });

  /**
   * Ingests a Comment webhook: a `/approve` reply on a ticket that is
   * awaiting approval queues a release-only job for that ticket.
   */
  const handleCommentApproval = async (
    body: unknown,
    reply: FastifyReply
  ): Promise<void> => {
    const parsed = commentPayloadSchema.safeParse(body);
    if (!parsed.success) {
      logger.warn({ errors: parsed.error.issues }, "Invalid comment payload");
      await reply.status(400).send({ error: "Invalid payload" });
      return;
    }

    const payload = parsed.data;
    if (payload.action !== "create") {
      await reply.status(200).send({ message: "Ignored" });
      return;
    }

    const match = (payload.data.body ?? "").match(
      /\/approve(?:\s+([A-Za-z0-9_-]+))?/i
    );
    if (match === null) {
      await reply.status(200).send({ message: "Ignored (no approval trigger)" });
      return;
    }

    // The capture group is optional in the regex; an empty match falls back
    // to the comment's own issue id. An explicit id may be the human-readable
    // identifier (TKT-123) rather than the internal id — if it matches no
    // record, the comment's own ticket is the authority.
    const hasExplicitId = /\/approve\s+[A-Za-z0-9_-]+/i.test(
      payload.data.body ?? ""
    );
    let record = await deps.approvalStore.get(
      hasExplicitId ? match[1] : payload.data.issueId
    );
    if (record === null && hasExplicitId) {
      record = await deps.approvalStore.get(payload.data.issueId);
    }
    if (record === null) {
      await reply.status(200).send({ message: "No pending approval for ticket" });
      return;
    }

    const job: TicketJob = {
      ...record.job,
      attempt: record.job.attempt + 1,
      approvalGranted: true,
    };
    await deps.scheduler.enqueue(job);
    await deps.linearClient.postComment(
      record.job.ticketId,
      "✅ Approval received — release queued."
    );
    logger.info({ ticketId: record.job.ticketId }, "Approval granted via Linear comment");
    await reply.status(200).send({ message: "Approval queued" });
  };

  server.post(
    "/webhooks/linear",
    async (
      request: FastifyRequest<{ Body: WebhookBody }>,
      reply: FastifyReply
    ): Promise<void> => {
      const signature = request.headers["linear-signature"] as
        | string
        | undefined;

      if (!signature) {
        logger.warn("Webhook received without signature");
        await reply.status(401).send({ error: "Missing signature" });
        return;
      }

      const rawBody =
        request.rawBody ?? Buffer.from(JSON.stringify(request.body));
      const isValid = deps.linearClient.verifyWebhookSignature(
        rawBody.toString("utf8"),
        signature,
        deps.webhookSecret
      );

      if (!isValid) {
        logger.warn("Invalid webhook signature");
        await reply.status(401).send({ error: "Invalid signature" });
        return;
      }

      const body = request.body as unknown as Record<string, unknown>;
      const type = typeof body.type === "string" ? body.type : "";

      if (type === "Comment") {
        await handleCommentApproval(body, reply);
        return;
      }

      // Non-Issue, non-Comment events are acknowledged, never rejected:
      // a 4xx makes Linear retry and can disable the webhook.
      if (type !== "Issue") {
        await reply.status(200).send({ message: "Ignored" });
        return;
      }

      const parseResult = webhookPayloadSchema.safeParse(request.body);

      if (!parseResult.success) {
        logger.warn({ errors: parseResult.error.issues }, "Invalid payload");
        await reply.status(400).send({ error: "Invalid payload" });
        return;
      }

      const payload = parseResult.data;

      if (payload.action !== "update") {
        await reply.status(200).send({ message: "Ignored" });
        return;
      }

      if (payload.data.state.name !== READY_STATE) {
        await reply.status(200).send({ message: "State not triggered" });
        return;
      }

      // Control team: this ticket is a project-management command, not a
      // coding job. Parse it, run it, and reply on the ticket.
      const team = payload.data.team;
      const controlTeam = deps.controlTeam ?? "";
      const isControlTicket =
        deps.projectControl !== undefined &&
        controlTeam !== "" &&
        team !== undefined &&
        (team.id === controlTeam || team.name === controlTeam);

      if (isControlTicket) {
        const commandText = `${payload.data.title} ${payload.data.description ?? ""}`;
        const command = parseControlCommand(commandText);
        const commandReply = await deps.projectControl?.run(command);
        await deps.linearClient.postComment(
          payload.data.id,
          `⚙️ ${commandReply ?? "Command processed."}`
        );
        logger.info(
          { ticketId: payload.data.id, command: command.kind },
          "Control command processed from webhook"
        );
        await reply.status(200).send({ message: `Command ${command.kind} processed` });
        return;
      }

      const labels = payload.data.labels.map((l) => l.name);
      const priority = linearPriorityToNightforge(payload.data.priority);

      // Route by Linear team → project. Unmapped teams fall back to the
      // default project id (single-project installs are unaffected).
      const projectId =
        deps.teamRouter !== undefined && team !== undefined
          ? (deps.teamRouter.resolveProjectForTeam(team.id) ??
              deps.teamRouter.resolveProjectForTeam(team.name) ??
              deps.projectId)
          : deps.projectId;

      const issue: LinearIssue = {
        id: payload.data.id,
        identifier: payload.data.id,
        title: payload.data.title,
        description: payload.data.description ?? null,
        priority: payload.data.priority,
        labels,
        stateName: payload.data.state.name,
      };

      if (deps.epicDispatch !== undefined && deps.epicDispatch.isEpic(issue)) {
        const result = await deps.epicDispatch.handle(issue);
        const detail = result.epic?.message ?? result.atomizerReason;
        await deps.linearClient.postComment(
          issue.id,
          `🏗 Epic ${result.state}: ${detail}`
        );
        logger.info(
          { epicId: issue.id, state: result.state },
          "Epic processed from webhook"
        );
        await reply.status(200).send({ message: `Epic ${result.state}` });
        return;
      }

      const job: TicketJob = {
        ticketId: payload.data.id,
        projectId,
        title: payload.data.title,
        description: payload.data.description ?? "",
        labels,
        priority: mapPriority(priority),
        attempt: 1,
      };

      await deps.scheduler.enqueue(job);

      await deps.linearClient.postComment(
        payload.data.id,
        "🔥 Nightforge claimed this ticket. Worker starting."
      );

      logger.info(
        { ticketId: payload.data.id, title: payload.data.title, projectId },
        "Ticket enqueued from webhook"
      );

      await reply.status(200).send({ message: "Ticket enqueued" });
    }
  );

  return server;
}