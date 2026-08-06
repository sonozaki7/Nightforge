import pino from "pino";
import type { RequirementsContract } from "../artifacts/schemas.js";
import type {
  BlastRadius,
  BlastRadiusClassifier,
} from "../tools/blast-radius.js";
import type { ExecutionPipeline, PipelineResult } from "../projects/pipeline.js";
import type { ProjectConfig } from "../projects/registry.js";

const logger = pino({ name: "nightforge-ticket-workflow" });

/**
 * TicketWorkflow (Guide NIGHTFORGE-V2.1 §10.3) with the amended
 * blast-radius deployment policy (§22, PHILOSOPHY.md):
 *
 * - reversible releases ship direct to production — the safety net is
 *   automated verification + instant rollback, never a human gate;
 * - high-risk releases require exactly one human tap before production;
 * - irreversible releases are refused by the classifier and never run.
 */

export type ReleasePath = "direct-production" | "staging-then-approval" | "blocked";

export interface ReleaseGateResult {
  path: ReleasePath;
  radius: BlastRadius;
  reason: string;
  /** True only for direct-production or after human approval was granted. */
  mayShip: boolean;
}

export interface ReleaseGate {
  evaluate(
    contract: RequirementsContract,
    humanApproved: boolean
  ): ReleaseGateResult;
}

const HIGH_RISK_MARKERS = [
  "migration",
  "auth",
  "permission",
  "billing",
  "secret",
  "api-breaking",
];

function contractTouchesHighRiskClasses(contract: RequirementsContract): boolean {
  const text = [
    contract.objective,
    ...contract.acceptanceCriteria.map((c) => c.description),
  ]
    .join(" ")
    .toLowerCase();
  return HIGH_RISK_MARKERS.some((marker) => text.includes(marker));
}

export function createReleaseGate(
  classifier: BlastRadiusClassifier
): ReleaseGate {
  return {
    evaluate(contract, humanApproved): ReleaseGateResult {
      const risk = contract.riskLevel;

      if (risk === "critical") {
        return {
          path: "blocked",
          radius: "irreversible",
          reason: "Critical risk contracts never auto-release; requires principal decision",
          mayShip: false,
        };
      }

      const radius = classifier.classify("deploy", "production");
      const touchesHighRisk = contractTouchesHighRiskClasses(contract);

      if (risk === "high" || touchesHighRisk) {
        return {
          path: "staging-then-approval",
          radius,
          reason: "High-risk classes detected; staging-first, then one human tap",
          mayShip: humanApproved,
        };
      }

      // Reversible work: ship direct. Verification + rollback is the gate.
      return {
        path: "direct-production",
        radius: "low",
        reason: "Reversible change; direct production with automated verification",
        mayShip: true,
      };
    },
  };
}

export interface TicketOutcome {
  ticketId: string;
  state:
    | "shipped"
    | "rolled_back"
    | "awaiting_approval"
    | "blocked"
    | "merge_failed"
    | "deploy_failed"
    | "verify_failed";
  gate: ReleaseGateResult;
  pipeline: PipelineResult | null;
  criteriaVerified: number;
  criteriaTotal: number;
  message: string;
}

export interface TicketWorkflowDeps {
  releaseGate: ReleaseGate;
  pipeline: ExecutionPipeline;
}

export interface TicketWorkflow {
  /**
   * Run the release stage of a ticket after validation evidence exists.
   * Acceptance criteria must be verified before this is called —
   * a model saying "done" is never sufficient (Guide executive decision 8).
   */
  runReleaseStage(
    ticketId: string,
    contract: RequirementsContract,
    project: ProjectConfig,
    worktreePath: string,
    summary: string,
    options?: { humanApproved?: boolean }
  ): Promise<TicketOutcome>;
}

export function createTicketWorkflow(deps: TicketWorkflowDeps): TicketWorkflow {
  return {
    async runReleaseStage(
      ticketId,
      contract,
      project,
      worktreePath,
      summary,
      options
    ): Promise<TicketOutcome> {
      const log = logger.child({ ticketId, projectId: project.id });
      const gate = deps.releaseGate.evaluate(
        contract,
        options?.humanApproved ?? false
      );

      const verified = contract.acceptanceCriteria.filter((c) => c.verified).length;
      const total = contract.acceptanceCriteria.length;

      if (verified < total) {
        log.warn({ verified, total }, "Unverified acceptance criteria; refusing release");
        return {
          ticketId,
          state: "verify_failed",
          gate,
          pipeline: null,
          criteriaVerified: verified,
          criteriaTotal: total,
          message: `${String(total - verified)} acceptance criteria unverified`,
        };
      }

      if (!gate.mayShip) {
        const state = gate.path === "blocked" ? "blocked" : "awaiting_approval";
        log.info({ path: gate.path }, "Release held by gate");
        return {
          ticketId,
          state,
          gate,
          pipeline: null,
          criteriaVerified: verified,
          criteriaTotal: total,
          message: gate.reason,
        };
      }

      log.info({ path: gate.path }, "Release gate passed; running pipeline");
      const result = await deps.pipeline.execute(
        worktreePath,
        project,
        ticketId,
        summary
      );

      const state =
        result.state === "shipped"
          ? "shipped"
          : result.state === "rolled_back"
            ? "rolled_back"
            : result.state;

      return {
        ticketId,
        state,
        gate,
        pipeline: result,
        criteriaVerified: verified,
        criteriaTotal: total,
        message: result.message,
      };
    },
  };
}
