import type { SystemPromptBlock } from "./providers/base.js";
import type { ProjectContext } from "../memory/project-context.js";
import type { ProjectConfig } from "../projects/registry.js";
import type { TicketJob } from "../queue/scheduler.js";

/**
 * Prompt Builder — Cache-Optimized Layered Architecture
 *
 * Prompts are structured in layers from MOST STABLE to LEAST STABLE
 * to maximize provider-side prefix caching (KV cache reuse).
 *
 * Layer 1 (STATIC):     System identity + coding standards — never changes
 * Layer 2 (SEMI-STATIC): Project context (architecture, patterns) — changes rarely
 * Layer 3 (SEMI-STATIC): Project config (commands, constraints) — changes rarely
 * Layer 4 (DYNAMIC):    Ticket content — changes every request
 *
 * Providers cache the prefix, so identical Layer 1+2+3 across requests
 * means only Layer 4 needs fresh computation.
 */

const SYSTEM_IDENTITY = `You are Nightforge, an autonomous AI software engineer.
You implement tickets end-to-end: read requirements, write code, run tests, and produce deployable changes.

## Core Rules
- Strict TypeScript. No \`any\` type. Explicit return types on all functions.
- Follow existing project patterns. Do not introduce new architectures.
- One logical change per ticket. No drive-by refactors.
- Never swallow errors. Always log, always propagate.
- Use structured logging with correlation IDs.
- Prefer Node.js built-ins over new dependencies.
- Never hardcode secrets. All secrets from environment variables.
- Max file size: 300 lines. Split if larger.
- File names: kebab-case. Classes: PascalCase. Functions: camelCase.

## Output Format
Express every file change as a fenced block. There are exactly two block types:

1. MODIFY an existing file — use an edit block:

\`\`\`edit:path/relative/to/repo
<<<<<<< SEARCH
<exact existing lines that must change>
=======
<the new version of exactly those lines>
>>>>>>> REPLACE
\`\`\`

- Copy the SEARCH lines VERBATIM from the Current File Contents shown in the ticket (same indentation, same wording).
- Keep SEARCH minimal: only the lines that change, plus at most 1-2 context lines so the block is unique.
- REPLACE holds only the new version of those same lines. Everything outside the block stays untouched.
- One SEARCH/REPLACE hunk per edit block; multiple edit blocks per file are allowed.
- NEVER output the full content of an existing file.

2. CREATE a new file — use a file block with its full content:

\`\`\`file:path/relative/to/repo
<full content of the new file>
\`\`\`

3. DELETE a file — use a delete block:

\`\`\`delete:path/relative/to/repo
\`\`\`

- Also remove every reference to a deleted file from the files that import or mention it (via edit blocks).

- One block per new file; include only files that actually change.
- Use paths relative to the repository root; never absolute paths.
- After the blocks, add a one-paragraph summary and verification checklist.`;

export interface PromptLayers {
  /** Cacheable system prompt blocks (Layers 1-3) */
  systemBlocks: SystemPromptBlock[];
  /** Dynamic user message (Layer 4) */
  userPrompt: string;
}

export interface PromptBuilder {
  build(
    job: TicketJob,
    config: ProjectConfig,
    context: ProjectContext,
    repoContext?: string
  ): PromptLayers;
}

export function createPromptBuilder(): PromptBuilder {
  return {
    build(
      job: TicketJob,
      config: ProjectConfig,
      context: ProjectContext,
      repoContext?: string
    ): PromptLayers {
      const systemBlocks: SystemPromptBlock[] = [];

      // Layer 1: Static identity (NEVER changes across any request)
      systemBlocks.push({
        text: SYSTEM_IDENTITY,
        cacheable: true,
      });

      // Layer 2: Project context (changes rarely — only when learnings are added)
      const contextText = buildContextLayer(context);
      if (contextText) {
        systemBlocks.push({
          text: contextText,
          cacheable: true,
        });
      }

      // Layer 3: Project configuration (changes rarely — only on config edits)
      systemBlocks.push({
        text: buildConfigLayer(config),
        cacheable: true,
      });

      // Layer 4: Dynamic ticket content (unique per request)
      const userPrompt = buildTicketLayer(job, repoContext);

      return { systemBlocks, userPrompt };
    },
  };
}

function buildContextLayer(context: ProjectContext): string {
  const parts: string[] = ["## Project Knowledge\n"];

  if (context.architecture.length > 0) {
    parts.push(
      `### Architecture\n${context.architecture.map((a) => `- ${a}`).join("\n")}`
    );
  }
  if (context.patterns.length > 0) {
    parts.push(
      `### Patterns\n${context.patterns.map((p) => `- ${p}`).join("\n")}`
    );
  }
  if (context.pastFailures.length > 0) {
    parts.push(
      `### Past Failures (avoid repeating)\n${context.pastFailures.map((f) => `- ${f}`).join("\n")}`
    );
  }
  if (context.knownGotchas.length > 0) {
    parts.push(
      `### Known Gotchas\n${context.knownGotchas.map((g) => `- ${g}`).join("\n")}`
    );
  }
  if (context.deploymentQuirks.length > 0) {
    parts.push(
      `### Deployment Quirks\n${context.deploymentQuirks.map((d) => `- ${d}`).join("\n")}`
    );
  }
  if (context.testCoverageGaps.length > 0) {
    parts.push(
      `### Test Coverage Gaps\n${context.testCoverageGaps.map((t) => `- ${t}`).join("\n")}`
    );
  }

  // Only return if there's actual content beyond the header
  return parts.length > 1 ? parts.join("\n\n") : "";
}

function buildConfigLayer(config: ProjectConfig): string {
  return `## Project: ${config.name}

### Commands
- Test: ${config.deployment.testCommand}
- Lint: ${config.deployment.lintCommand}
- Typecheck: ${config.deployment.typecheckCommand}
- Build: ${config.deployment.buildCommand}
- Deploy: ${config.deployment.deployCommand}

### Constraints
- Max attempts: ${String(config.agent.maxAttempts)}
- Max runtime: ${String(config.agent.maxRuntimeMinutes)} minutes
- Max ticket cost: $${config.agent.maxTicketCostUsd.toFixed(2)}
- Deployment policy: ${config.deployment.policy}`;
}

function buildTicketLayer(job: TicketJob, repoContext?: string): string {
  const parts: string[] = [
    `## Ticket: ${job.title}`,
    "",
    `**ID:** ${job.ticketId}`,
    `**Labels:** ${job.labels.join(", ") || "none"}`,
    "",
    "### Description",
    job.description,
    "",
  ];

  if (repoContext !== undefined && repoContext.length > 0) {
    parts.push("### Repository", repoContext, "");
  }

  parts.push(
    "### Instructions",
    "Implement the required changes following the project standards above.",
    "Ensure all validation commands pass before considering the work complete.",
  );

  return parts.join("\n");
}
