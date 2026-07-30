import pino from "pino";
import type { Tool, ToolResult } from "../types.js";

const logger = pino({ name: "nightforge-tool-google" });

export interface GoogleToolConfig {
  /** OAuth2 access token (refreshed externally) */
  accessToken: string;
  baseUrl?: string;
}

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
const CALENDAR_BASE = "https://www.googleapis.com/calendar/v3";

/**
 * Google Workspace tool covering Gmail and Calendar.
 * Uses OAuth2 bearer token for authentication.
 */
export function createGoogleTool(config: GoogleToolConfig): Tool {
  return {
    definition: {
      name: "google_api",
      description:
        "Interact with Google Workspace (Gmail + Calendar). " +
        "For Gmail: use service='gmail', action='send'|'list'|'read'|'draft'. " +
        "For Calendar: use service='calendar', action='list'|'create'|'get'|'delete'. " +
        "You know Google's API structures from training.",
      parameters: {
        type: "object",
        properties: {
          service: {
            type: "string",
            description: "Google service to use",
            enum: ["gmail", "calendar"],
          },
          action: {
            type: "string",
            description: "Action to perform on the service",
            enum: ["send", "list", "read", "draft", "create", "get", "delete"],
          },
          params: {
            type: "object",
            description:
              "Action parameters. Gmail send: {to, subject, body}. " +
              "Calendar create: {summary, start, end, description, attendees}. " +
              "List: {maxResults, query}. Read/Get/Delete: {id}.",
          },
        },
        required: ["service", "action"],
      },
      permission: "auto",
      service: "google",
    },

    async execute(args: Record<string, unknown>): Promise<ToolResult> {
      const start = Date.now();
      const service = args["service"] as string;
      const action = args["action"] as string;
      const params = (args["params"] as Record<string, unknown> | undefined) ?? {};

      try {
        if (service === "gmail") {
          return await executeGmail(action, params, config, start);
        }
        if (service === "calendar") {
          return await executeCalendar(action, params, config, start);
        }
        return {
          success: false,
          data: null,
          error: `Unknown service: ${service}. Use "gmail" or "calendar".`,
          durationMs: Date.now() - start,
        };
      } catch (err) {
        const error = err as Error;
        logger.error({ service, action, error: error.message }, "Google API failed");
        return {
          success: false,
          data: null,
          error: `Google API failed: ${error.message}`,
          durationMs: Date.now() - start,
        };
      }
    },
  };
}

async function googleFetch(
  url: string,
  config: GoogleToolConfig,
  options?: RequestInit
): Promise<{ ok: boolean; data: unknown; status: number }> {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
      "Content-Type": "application/json",
      ...(options?.headers as Record<string, string> | undefined),
    },
  });
  const data: unknown = await response.json();
  return { ok: response.ok, data, status: response.status };
}

async function executeGmail(
  action: string,
  params: Record<string, unknown>,
  config: GoogleToolConfig,
  start: number
): Promise<ToolResult> {
  const base = config.baseUrl ? `${config.baseUrl}/gmail/v1/users/me` : GMAIL_BASE;

  if (action === "send") {
    const to = params["to"] as string;
    const subject = params["subject"] as string;
    const body = params["body"] as string;
    const raw = buildMimeMessage(to, subject, body);

    const result = await googleFetch(`${base}/messages/send`, config, {
      method: "POST",
      body: JSON.stringify({ raw }),
    });

    if (!result.ok) {
      return { success: false, data: result.data, error: `Gmail send failed (${String(result.status)})`, durationMs: Date.now() - start };
    }
    return { success: true, data: result.data, durationMs: Date.now() - start };
  }

  if (action === "list") {
    const maxResults = (params["maxResults"] as number | undefined) ?? 10;
    const query = (params["query"] as string | undefined) ?? "";
    const q = query ? `?maxResults=${String(maxResults)}&q=${encodeURIComponent(query)}` : `?maxResults=${String(maxResults)}`;
    const result = await googleFetch(`${base}/messages${q}`, config);
    return { success: result.ok, data: result.data, error: result.ok ? undefined : "List failed", durationMs: Date.now() - start };
  }

  if (action === "read") {
    const id = params["id"] as string;
    const result = await googleFetch(`${base}/messages/${id}?format=full`, config);
    return { success: result.ok, data: result.data, error: result.ok ? undefined : "Read failed", durationMs: Date.now() - start };
  }

  return { success: false, data: null, error: `Unknown gmail action: ${action}`, durationMs: Date.now() - start };
}

async function executeCalendar(
  action: string,
  params: Record<string, unknown>,
  config: GoogleToolConfig,
  start: number
): Promise<ToolResult> {
  const base = config.baseUrl ?? CALENDAR_BASE;
  const calendarId = (params["calendarId"] as string | undefined) ?? "primary";

  if (action === "list") {
    const maxResults = (params["maxResults"] as number | undefined) ?? 10;
    const timeMin = (params["timeMin"] as string | undefined) ?? new Date().toISOString();
    const result = await googleFetch(
      `${base}/calendars/${calendarId}/events?maxResults=${String(maxResults)}&timeMin=${timeMin}&singleEvents=true&orderBy=startTime`,
      config
    );
    return { success: result.ok, data: result.data, error: result.ok ? undefined : "List failed", durationMs: Date.now() - start };
  }

  if (action === "create") {
    const event = {
      summary: params["summary"],
      description: params["description"],
      start: { dateTime: params["start"], timeZone: params["timeZone"] ?? "UTC" },
      end: { dateTime: params["end"], timeZone: params["timeZone"] ?? "UTC" },
      attendees: params["attendees"] as Array<{ email: string }> | undefined,
    };

    const result = await googleFetch(`${base}/calendars/${calendarId}/events`, config, {
      method: "POST",
      body: JSON.stringify(event),
    });
    return { success: result.ok, data: result.data, error: result.ok ? undefined : "Create failed", durationMs: Date.now() - start };
  }

  if (action === "get") {
    const id = params["id"] as string;
    const result = await googleFetch(`${base}/calendars/${calendarId}/events/${id}`, config);
    return { success: result.ok, data: result.data, error: result.ok ? undefined : "Get failed", durationMs: Date.now() - start };
  }

  if (action === "delete") {
    const id = params["id"] as string;
    const result = await googleFetch(`${base}/calendars/${calendarId}/events/${id}`, config, { method: "DELETE" });
    return { success: result.ok, data: result.data, error: result.ok ? undefined : "Delete failed", durationMs: Date.now() - start };
  }

  return { success: false, data: null, error: `Unknown calendar action: ${action}`, durationMs: Date.now() - start };
}

function buildMimeMessage(to: string, subject: string, body: string): string {
  const message = [
    `To: ${to}`,
    `Subject: ${subject}`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    body,
  ].join("\n");

  return Buffer.from(message).toString("base64url");
}
