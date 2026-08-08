import pino from "pino";
import type { ProjectConfig } from "./registry.js";
import type { Deployer, DeployResult } from "./deployer.js";
import type { AutoMerger, AutoMergeResult } from "./auto-merge.js";
import type { HealthChecker, HealthCheckResult } from "../integrations/health.js";
import type { CiGate, CiGateResult } from "./ci-gate.js";

const logger = pino({ name: "nightforge-pipeline" });

/** Outcome of the full execution pipeline */
export interface PipelineResult {
  success: boolean;
  /** Final state: shipped | rolled_back | merge_failed | ci_failed | deploy_failed | verify_failed */
  state: "shipped" | "rolled_back" | "merge_failed" | "ci_failed" | "deploy_failed" | "verify_failed";
  merge: AutoMergeResult | null;
  deploy: DeployResult | null;
  health: HealthCheckResult | null;
  ciGate: CiGateResult | null;
  /** Total pipeline duration in ms */
  durationMs: number;
  message: string;
}

export interface PipelineDeps {
  deployer: Deployer;
  autoMerger: AutoMerger;
  healthChecker: HealthChecker;
  ciGate: CiGate;
}

export interface ExecutionPipeline {
  /**
   * Full speed-first pipeline:
   * merge → push → CI gate → deploy → verify → done.
   * If CI is red or verify fails → rollback deploy + revert merge. Instant undo.
   */
  execute(
    worktreePath: string,
    projectConfig: ProjectConfig,
    ticketId: string,
    summary: string
  ): Promise<PipelineResult>;
}

export function createExecutionPipeline(deps: PipelineDeps): ExecutionPipeline {
  return {
    async execute(
      worktreePath: string,
      projectConfig: ProjectConfig,
      ticketId: string,
      summary: string
    ): Promise<PipelineResult> {
      const startTime = Date.now();
      const log = logger.child({ ticketId, projectId: projectConfig.id });

      log.info("Pipeline started: merge → push → CI gate → deploy → verify");

      // Step 1: Auto-merge to main (no PR, no review)
      const mergeResult = await deps.autoMerger.commitAndMerge(
        worktreePath,
        projectConfig.path,
        ticketId,
        summary
      );

      if (!mergeResult.success) {
        log.warn({ message: mergeResult.message }, "Pipeline aborted: merge failed");
        return {
          success: false,
          state: "merge_failed",
          merge: mergeResult,
          deploy: null,
          health: null,
          ciGate: null,
          durationMs: Date.now() - startTime,
          message: mergeResult.message,
        };
      }

      // No changes produced — still a success (e.g. ops-only ticket)
      if (!mergeResult.mergeSha) {
        log.info("No code changes to deploy");
        return {
          success: true,
          state: "shipped",
          merge: mergeResult,
          deploy: null,
          health: null,
          ciGate: null,
          durationMs: Date.now() - startTime,
          message: "No code changes produced. Ticket resolved without deployment.",
        };
      }

      // Step 1.5: Push to origin so GitHub CI can judge the commit
      const pushed = await deps.autoMerger.pushToRemote(
        projectConfig.path,
        mergeResult.tag
      );

      if (!pushed) {
        log.warn("Push failed — reverting merge");

        await deps.autoMerger.revertMerge(
          projectConfig.path,
          mergeResult.mergeSha
        );

        return {
          success: false,
          state: "ci_failed",
          merge: mergeResult,
          deploy: null,
          health: null,
          ciGate: null,
          durationMs: Date.now() - startTime,
          message: `Push to origin failed. Merge reverted.`,
        };
      }

      // Step 1.75: CI gate — wait for GitHub Actions to pass this commit
      const ciGateResult = await deps.ciGate.waitForGreen(
        projectConfig.path,
        mergeResult.mergeSha
      );

      if (!ciGateResult.passed) {
        log.warn(
          { state: ciGateResult.state, message: ciGateResult.message },
          "CI gate blocked release — reverting merge"
        );

        await deps.autoMerger.revertMerge(
          projectConfig.path,
          mergeResult.mergeSha
        );

        return {
          success: false,
          state: "ci_failed",
          merge: mergeResult,
          deploy: null,
          health: null,
          ciGate: ciGateResult,
          durationMs: Date.now() - startTime,
          message: `CI gate blocked: ${ciGateResult.message}. Merge reverted and pushed back.`,
        };
      }

      // Step 2: Deploy (atomic symlink swap)
      const deployResult = await deps.deployer.deploy(
        projectConfig,
        worktreePath
      );

      if (!deployResult.success) {
        log.warn("Deploy failed, reverting merge");

        // Revert the merge since deploy failed
        if (mergeResult.mergeSha) {
          await deps.autoMerger.revertMerge(
            projectConfig.path,
            mergeResult.mergeSha
          );
        }

        return {
          success: false,
          state: "deploy_failed",
          merge: mergeResult,
          deploy: deployResult,
          health: null,
          ciGate: ciGateResult,
          durationMs: Date.now() - startTime,
          message: `Deploy failed: ${deployResult.message}. Merge reverted.`,
        };
      }

      // Step 3: Health check (the ONLY gate — automated, not human)
      const healthResult = await deps.healthChecker.verify(projectConfig);

      if (!healthResult.healthy) {
        log.warn("Health check failed, rolling back");

        // Rollback deploy (instant symlink swap)
        await deps.deployer.rollback(projectConfig);

        // Revert the merge commit
        if (mergeResult.mergeSha) {
          await deps.autoMerger.revertMerge(
            projectConfig.path,
            mergeResult.mergeSha
          );
        }

        return {
          success: false,
          state: "rolled_back",
          merge: mergeResult,
          deploy: deployResult,
          health: healthResult,
          ciGate: ciGateResult,
          durationMs: Date.now() - startTime,
          message: "Health check failed. Deployed rolled back, merge reverted.",
        };
      }

      // SUCCESS — shipped to production, no human touched it
      log.info(
        { durationMs: Date.now() - startTime, tag: mergeResult.tag },
        "Pipeline complete: shipped to production"
      );

      return {
        success: true,
        state: "shipped",
        merge: mergeResult,
        deploy: deployResult,
        health: healthResult,
        ciGate: ciGateResult,
        durationMs: Date.now() - startTime,
        message: `Shipped. Tag: ${mergeResult.tag ?? "none"}. Duration: ${String(Date.now() - startTime)}ms`,
      };
    },
  };
}
