/**
 * ACP Client — spawns an ACP adapter binary as a subprocess and communicates
 * via JSON-RPC 2.0 over stdio. Mimics how Goose connects to ACP agents.
 *
 * Lifecycle: spawn → initialize → session/new → session/prompt → collect → kill
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import { EventEmitter } from "node:events";
import pino from "pino";
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcNotification,
  InitializeRequest,
  InitializeResponse,
  NewSessionRequest,
  NewSessionResponse,
  PromptRequest,
  PromptResponse,
  SessionUpdateNotification,
  PermissionRequest,
  PermissionResponse,
  ProtocolVersion,
  SessionId,
  AcpAdapterConfig,
} from "./types.js";
import { LATEST_PROTOCOL_VERSION } from "./types.js";

const logger = pino({ name: "nightforge-acp-client" });

export interface AcpClientEvents {
  /** Agent sent a session/update notification */
  "session:update": (update: SessionUpdateNotification) => void;
  /** Agent requested permission for a tool call */
  "permission:request": (request: PermissionRequest) => void;
  /** Subprocess exited */
  exit: (code: number | null) => void;
  /** Raw stderr output (for debugging) */
  stderr: (data: string) => void;
}

export interface AcpClientOptions {
  /** Working directory for the ACP session */
  cwd: string;
  /** Protocol version to negotiate */
  protocolVersion?: ProtocolVersion;
  /** Timeout for individual RPC calls (ms) */
  rpcTimeoutMs?: number;
  /** Permission handler — called when agent requests approval */
  onPermissionRequest?: (request: PermissionRequest) => Promise<PermissionResponse>;
}

const DEFAULT_RPC_TIMEOUT = 300_000; // 5 minutes (agents can take a while)

/**
 * AcpClient manages a single ACP agent subprocess.
 * It handles JSON-RPC framing, request/response correlation, and notifications.
 */
export class AcpClient extends EventEmitter {
  private process: ChildProcess | null = null;
  private readline: Interface | null = null;
  private nextId = 1;
  private pendingRequests = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (err: Error) => void; timer: NodeJS.Timeout }
  >();
  private sessionId: SessionId | null = null;
  private readonly adapter: AcpAdapterConfig;
  private readonly options: AcpClientOptions;
  private alive = false;

  constructor(adapter: AcpAdapterConfig, options: AcpClientOptions) {
    super();
    this.adapter = adapter;
    this.options = options;
  }

  /** Spawn the adapter subprocess and perform initialization handshake */
  async connect(): Promise<InitializeResponse> {
    const log = logger.child({ adapter: this.adapter.id });
    log.info({ command: this.adapter.command }, "Spawning ACP adapter");

    const env = { ...process.env };

    this.process = spawn(this.adapter.command, this.adapter.args, {
      stdio: ["pipe", "pipe", "pipe"],
      env,
      cwd: this.options.cwd,
    });

    this.alive = true;

    this.process.on("exit", (code) => {
      this.alive = false;
      log.info({ code }, "ACP adapter exited");
      this.emit("exit", code);
      this.rejectAllPending(new Error(`ACP adapter exited with code ${String(code)}`));
    });

    this.process.on("error", (err) => {
      this.alive = false;
      log.error({ err: err.message }, "ACP adapter spawn error");
      this.rejectAllPending(err);
    });

    if (this.process.stderr) {
      this.process.stderr.on("data", (chunk: Buffer) => {
        this.emit("stderr", chunk.toString());
      });
    }

    // Set up line-based JSON-RPC reading from stdout
    if (!this.process.stdout) {
      throw new Error("ACP adapter stdout not available");
    }

    this.readline = createInterface({ input: this.process.stdout });
    this.readline.on("line", (line) => {
      this.handleLine(line);
    });

    // Perform initialization handshake
    const initRequest: InitializeRequest = {
      protocolVersion: this.options.protocolVersion ?? LATEST_PROTOCOL_VERSION,
      clientInfo: { name: "nightforge", version: "1.0.0" },
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
        terminal: true,
      },
    };

    const response = await this.request<InitializeResponse>("initialize", initRequest);
    log.info(
      { agent: response.agentInfo, version: response.protocolVersion },
      "ACP initialized"
    );

    return response;
  }

  /** Create a new session with the agent */
  async createSession(mcpServers: NewSessionRequest["mcpServers"] = []): Promise<SessionId> {
    const request: NewSessionRequest = {
      cwd: this.options.cwd,
      mcpServers,
    };

    const response = await this.request<NewSessionResponse>("session/new", request);
    this.sessionId = response.sessionId;
    logger.info({ sessionId: this.sessionId }, "ACP session created");
    return response.sessionId;
  }

  /**
   * Send a prompt to the agent and wait for completion.
   * Session updates and permission requests are emitted as events during execution.
   */
  async prompt(text: string, sessionId?: SessionId): Promise<PromptResponse> {
    const sid = sessionId ?? this.sessionId;
    if (!sid) throw new Error("No active session. Call createSession() first.");

    const request: PromptRequest = {
      sessionId: sid,
      prompt: [{ type: "text", text }],
    };

    return this.request<PromptResponse>("session/prompt", request);
  }

  /** Cancel ongoing operations in a session */
  cancel(sessionId?: SessionId): void {
    const sid = sessionId ?? this.sessionId;
    if (!sid) return;
    this.notify("session/cancel", { sessionId: sid });
  }

  /** Respond to a permission request from the agent */
  respondToPermission(permissionId: string, response: PermissionResponse): void {
    // Permission responses are sent as JSON-RPC responses to the agent's request
    // The agent sends session/request_permission as a request TO the client
    // We respond via the pending request mechanism
    const pending = this.pendingRequests.get(Number(permissionId));
    if (pending) {
      clearTimeout(pending.timer);
      pending.resolve({ outcome: response });
      this.pendingRequests.delete(Number(permissionId));
    }
  }

  /** Gracefully shut down the adapter subprocess */
  async disconnect(): Promise<void> {
    this.alive = false;
    this.rejectAllPending(new Error("Client disconnecting"));

    if (this.readline) {
      this.readline.close();
      this.readline = null;
    }

    if (this.process) {
      this.process.kill("SIGTERM");
      // Give it 3 seconds to exit gracefully, then force kill
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          if (this.process) this.process.kill("SIGKILL");
          resolve();
        }, 3000);
        if (this.process) {
          this.process.on("exit", () => {
            clearTimeout(timer);
            resolve();
          });
        } else {
          clearTimeout(timer);
          resolve();
        }
      });
      this.process = null;
    }
  }

  get isAlive(): boolean {
    return this.alive;
  }

  get currentSessionId(): SessionId | null {
    return this.sessionId;
  }

  /* --- Internal JSON-RPC handling --- */

  private handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;

    let parsed: JsonRpcResponse | JsonRpcNotification;
    try {
      parsed = JSON.parse(trimmed) as JsonRpcResponse | JsonRpcNotification;
    } catch {
      logger.debug({ line: trimmed.slice(0, 200) }, "Non-JSON line from adapter");
      return;
    }

    // Response to one of our requests
    if ("id" in parsed) {
      const response = parsed;
      const pending = this.pendingRequests.get(response.id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingRequests.delete(response.id);
        if (response.error) {
          pending.reject(
            new Error(`ACP error ${String(response.error.code)}: ${response.error.message}`)
          );
        } else {
          pending.resolve(response.result);
        }
      }
      return;
    }

    // Notification from the agent
    this.handleNotification(parsed);
  }

  private handleNotification(notification: JsonRpcNotification): void {
    const { method, params } = notification;

    switch (method) {
      case "session/update":
        this.emit("session:update", params);
        break;

      case "session/request_permission": {
        const permReq = params as unknown as PermissionRequest;
        this.emit("permission:request", permReq);
        // Auto-handle if handler is provided
        if (this.options.onPermissionRequest) {
          void this.options.onPermissionRequest(permReq).then((response) => {
            this.sendPermissionResponse(permReq.permissionId, response);
          });
        }
        break;
      }

      default:
        logger.debug({ method }, "Unhandled ACP notification");
    }
  }

  private sendPermissionResponse(permissionId: string, response: PermissionResponse): void {
    // Permission responses go back as a JSON-RPC response to the agent's request
    // The agent's request_permission has an id we need to respond to
    const raw = JSON.stringify({
      jsonrpc: "2.0",
      id: permissionId,
      result: { outcome: response },
    });
    this.writeLine(raw);
  }

  private request<T>(method: string, params: unknown): Promise<T> {
    if (!this.alive) {
      return Promise.reject(new Error("ACP client not connected"));
    }

    const id = this.nextId++;
    const request: JsonRpcRequest = { jsonrpc: "2.0", id, method, params: params as Record<string, unknown> };
    const timeoutMs = this.options.rpcTimeoutMs ?? DEFAULT_RPC_TIMEOUT;

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`ACP request '${method}' timed out after ${String(timeoutMs)}ms`));
      }, timeoutMs);

      this.pendingRequests.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      });

      this.writeLine(JSON.stringify(request));
    });
  }

  private notify(method: string, params: unknown): void {
    const notification: JsonRpcNotification = { jsonrpc: "2.0", method, params: params as Record<string, unknown> };
    this.writeLine(JSON.stringify(notification));
  }

  private writeLine(data: string): void {
    if (this.process?.stdin?.writable) {
      this.process.stdin.write(`${data}\n`);
    }
  }

  private rejectAllPending(err: Error): void {
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(err);
      this.pendingRequests.delete(id);
    }
  }
}
