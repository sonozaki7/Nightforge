import path from "node:path";
import type { PipelineResult } from "../projects/pipeline.js";

/**
 * Linear result comment for shipped tickets (IMPLEMENTATION.md Phase 2:
 * "Report cost in Linear comment on ticket completion"; telemetry contract:
 * model used, tokens in/out, cost, duration). The comment is the user-facing
 * receipt of the run: what changed, what shipped, which model did it, and
 * exactly what it cost.
 */

export interface ShippedReportInput {
  summary: string;
  filesChanged: string[];
  model: string;
  tokensUsed: number;
  inputTokens?: number;
  outputTokens?: number;
  costUsd: number;
  /** Wall-clock duration of the whole ticket run. */
  durationMs: number;
  /** Null when the ticket needed no release pipeline. */
  pipeline: PipelineResult | null;
}

export function buildShippedComment(report: ShippedReportInput): string {
  const lines: string[] = [`✅ Shipped: ${report.summary}`];

  if (report.filesChanged.length > 0) {
    lines.push("", `**Changes (${String(report.filesChanged.length)} file${report.filesChanged.length === 1 ? "" : "s"})**`);
    for (const file of report.filesChanged) {
      lines.push(`- \`${file}\``);
    }
  }

  const pipelineLines: string[] = [];
  if (report.pipeline !== null) {
    const merge = report.pipeline.merge;
    if (merge?.commitSha) {
      pipelineLines.push(`Commit: \`${merge.commitSha.slice(0, 7)}\`${merge.tag ? ` · Tag: \`${merge.tag}\`` : ""}`);
    }
    if (report.pipeline.deploy?.releasePath) {
      pipelineLines.push(`Release: ${path.basename(report.pipeline.deploy.releasePath)}`);
    }
    pipelineLines.push(`Pipeline: ${report.pipeline.message} (${formatDuration(report.pipeline.durationMs)})`);
  } else {
    pipelineLines.push("Pipeline: no deploy needed");
  }
  lines.push("", "**Release**", ...pipelineLines);

  const tokenDetail =
    report.inputTokens !== undefined && report.outputTokens !== undefined
      ? `${String(report.inputTokens)} in / ${String(report.outputTokens)} out (${String(report.tokensUsed)} total)`
      : `${String(report.tokensUsed)} total`;

  lines.push(
    "",
    "**Run**",
    `Model: ${report.model} · Tokens: ${tokenDetail}`,
    `Cost: $${report.costUsd.toFixed(4)} · Duration: ${formatDuration(report.durationMs)}`
  );

  return lines.join("\n");
}

function formatDuration(ms: number): string {
  const seconds = ms / 1000;
  return seconds < 10 ? `${seconds.toFixed(1)}s` : `${String(Math.round(seconds))}s`;
}
