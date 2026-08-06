import pino from "pino";

const logger = pino({ name: "nightforge-reviewer" });

/**
 * Independent reviewer (Roadmap Phase 3, PHILOSOPHY.md override).
 *
 * Review applies to high-risk classes only: reversible work is gated by
 * automated verification + instant rollback instead. Deterministic rules
 * run first; a model-backed reviewer can extend the verdict behind the
 * same interface with a family different from the author's.
 */

export type ReviewSeverity = "blocker" | "warning";

export interface ReviewFinding {
  rule: string;
  severity: ReviewSeverity;
  detail: string;
}

export interface ReviewInput {
  filesChanged: string[];
  /** Ownership scope from the capsule; empty means unrestricted. */
  allowedPaths: string[];
  /** Paths the capsule forbids touching outright. */
  prohibitedPaths: string[];
  testResults: string;
}

export interface ReviewVerdict {
  approved: boolean;
  findings: ReviewFinding[];
}

export interface Reviewer {
  review(input: ReviewInput): Promise<ReviewVerdict>;
}

function inScope(file: string, allowedPaths: string[]): boolean {
  return allowedPaths.some((prefix) => file.startsWith(prefix));
}

export function createReviewer(): Reviewer {
  return {
    review(input): Promise<ReviewVerdict> {
      const findings: ReviewFinding[] = [];

      if (/fail/i.test(input.testResults)) {
        findings.push({
          rule: "tests-failing",
          severity: "blocker",
          detail: "Validation suite reports failures",
        });
      }

      const prohibited = input.filesChanged.filter((file) =>
        input.prohibitedPaths.some((prefix) => file.startsWith(prefix))
      );
      for (const file of prohibited) {
        findings.push({
          rule: "prohibited-path",
          severity: "blocker",
          detail: `Change touches prohibited path: ${file}`,
        });
      }

      if (input.allowedPaths.length > 0) {
        const outside = input.filesChanged.filter(
          (file) => !inScope(file, input.allowedPaths)
        );
        for (const file of outside) {
          findings.push({
            rule: "out-of-scope",
            severity: "warning",
            detail: `Change outside declared ownership: ${file}`,
          });
        }
      }

      if (input.filesChanged.length === 0) {
        findings.push({
          rule: "no-changes",
          severity: "warning",
          detail: "Worker reported success without any changed files",
        });
      }

      const approved = findings.every((f) => f.severity !== "blocker");
      logger.info(
        { approved, findings: findings.length },
        "Review verdict reached"
      );
      return Promise.resolve({ approved, findings });
    },
  };
}
