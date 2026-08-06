import type { TicketJob } from "./scheduler.js";
import type { WorkerResult } from "../workers/worker.js";

/**
 * Repair-context builder for triage retries (Guide §20.3 repair loop).
 * A retry that does not see the previous failure output repeats the same
 * mistake, so the next attempt's ticket carries it in the description.
 */

/** Cap validation output appended to a repair prompt. */
const REPAIR_OUTPUT_LIMIT = 2500;

/**
 * Build the retry job: same ticket, but the description carries the
 * previous failure summary, triage strategy, and validation output so the
 * model can actually fix what broke.
 */
export function withRepairContext(
  job: TicketJob,
  previous: WorkerResult,
  strategy: string
): TicketJob {
  const output = previous.testResults.trim();
  const trimmed =
    output.length > REPAIR_OUTPUT_LIMIT
      ? `…${output.slice(output.length - REPAIR_OUTPUT_LIMIT)}`
      : output;
  const repairNote = [
    "",
    "### Previous attempt FAILED — do not repeat it",
    `Failure: ${previous.summary}`,
    `Repair strategy: ${strategy}`,
    trimmed.length > 0 ? `Validation output:\n${trimmed}` : "",
  ]
    .filter((line) => line.length > 0)
    .join("\n");
  return { ...job, description: `${job.description}\n${repairNote}` };
}
