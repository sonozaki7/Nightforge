import Fastify from "fastify";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import pino from "pino";
import { z } from "zod";
import type { LinearClient } from "./integrations/linear.js";
import type { Scheduler, TicketJob } from "./queue/scheduler.js";
import { linearPriorityToNightforge, mapPriority } from "./queue/scheduler.js";

const logger = pino({ name: "nightforge" });

const READY_STATE = "Ready for AI";

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
    labels: z
      .array(z.object({ name: z.string() }))
      .optional()
      .default([]),
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
    labels?: Array<{ name: string }>;
  };
}

export interface ServerDeps {
  linearClient: LinearClient;
  scheduler: Scheduler;
  webhookSecret: string;
  projectId: string;
}

export function createServer(deps: ServerDeps): FastifyInstance {
  const server = Fastify({ logger: false });

  server.get("/health", () => {
    return { status: "ok", uptime: process.uptime() };
  });

  server.post(
    "/webhooks/linear",
    async (
      request: FastifyRequest<{ Body: WebhookBody }>,
      reply: FastifyReply
    ): Promise<void> => {
      const signature = request.headers["linear-signature"] as
        | string
        | undefined;
      const rawBody = JSON.stringify(request.body);

      if (!signature) {
        logger.warn("Webhook received without signature");
        await reply.status(401).send({ error: "Missing signature" });
        return;
      }

      const isValid = deps.linearClient.verifyWebhookSignature(
        rawBody,
        signature,
        deps.webhookSecret
      );

      if (!isValid) {
        logger.warn("Invalid webhook signature");
        await reply.status(401).send({ error: "Invalid signature" });
        return;
      }

      const parseResult = webhookPayloadSchema.safeParse(request.body);

      if (!parseResult.success) {
        logger.warn({ errors: parseResult.error.issues }, "Invalid payload");
        await reply.status(400).send({ error: "Invalid payload" });
        return;
      }

      const payload = parseResult.data;

      if (payload.type !== "Issue" || payload.action !== "update") {
        await reply.status(200).send({ message: "Ignored" });
        return;
      }

      if (payload.data.state.name !== READY_STATE) {
        await reply.status(200).send({ message: "State not triggered" });
        return;
      }

      const labels = payload.data.labels.map((l) => l.name);
      const priority = linearPriorityToNightforge(payload.data.priority);

      const job: TicketJob = {
        ticketId: payload.data.id,
        projectId: deps.projectId,
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
        { ticketId: payload.data.id, title: payload.data.title },
        "Ticket enqueued from webhook"
      );

      await reply.status(200).send({ message: "Ticket enqueued" });
    }
  );

  return server;
}
