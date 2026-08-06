import type { CostLedger } from "./cost-ledger.js";
import type { SpeedMetrics } from "./speed-metrics.js";
import type { Telemetry } from "./telemetry.js";
import { PROMPT_REGISTRY_VERSION } from "../agents/role-registry.js";

/**
 * Records one finished ticket across every evidence store: speed metrics
 * (digest streaks), telemetry (daily budget), and the unified cost ledger.
 * Extracted from main.ts so the entrypoint stays focused on wiring.
 */

export interface TicketOutcomeInput {
  ticketId: string;
  projectId: string;
  /** Model identifier used for cost attribution. */
  model: string;
  totalDurationMs: number;
  agentDurationMs: number;
  pipelineDurationMs: number;
  costUsd: number;
  tokensUsed: number;
  shipped: boolean;
  /** Prompt registry version; defaults to the current registry. */
  promptVersion?: string;
}

export interface OutcomeRecorder {
  record(input: TicketOutcomeInput): Promise<void>;
}

export interface OutcomeRecorderDeps {
  speedMetrics: SpeedMetrics;
  telemetry: Telemetry;
  costLedger: CostLedger;
  /** Provider the cost ledger attributes usage to. */
  provider: string;
}

export function createOutcomeRecorder(deps: OutcomeRecorderDeps): OutcomeRecorder {
  return {
    async record(input): Promise<void> {
      const timestamp = Date.now();

      await deps.speedMetrics.record({
        ticketId: input.ticketId,
        projectId: input.projectId,
        totalDurationMs: input.totalDurationMs,
        agentDurationMs: input.agentDurationMs,
        pipelineDurationMs: input.pipelineDurationMs,
        costUsd: input.costUsd,
        success: input.shipped,
        humanTouched: false,
        timestamp,
      });

      await deps.telemetry.recordTicketCost({
        ticketId: input.ticketId,
        projectId: input.projectId,
        model: input.model,
        inputTokens: 0,
        outputTokens: input.tokensUsed,
        costUsd: input.costUsd,
        durationMs: input.totalDurationMs,
        success: input.shipped,
        timestamp,
        promptVersion: input.promptVersion ?? PROMPT_REGISTRY_VERSION,
      });

      await deps.costLedger.record(
        {
          provider: deps.provider,
          model: input.model,
          inputTokens: 0,
          outputTokens: input.tokensUsed,
        },
        input.ticketId
      );
    },
  };
}
