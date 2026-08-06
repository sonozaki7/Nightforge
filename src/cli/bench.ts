import { formatReport, runBenchmark } from "../bench/benchmark.js";
import { SEED_CASES } from "../bench/seed-cases.js";
import { createTieredModelRouter } from "../router/model-tiers.js";

/**
 * CLI for the public benchmark harness: `npm run bench`.
 * Runs the seed evaluation set against the default roster and exits
 * non-zero when any routing expectation regressed.
 */

function main(): void {
  const report = runBenchmark(SEED_CASES, createTieredModelRouter());
  console.log(formatReport(report));
  process.exitCode = report.failed > 0 ? 1 : 0;
}

main();
