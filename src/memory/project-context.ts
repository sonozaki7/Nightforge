import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import pino from "pino";

const logger = pino({ name: "nightforge-context" });

export interface ProjectContext {
  architecture: string[];
  patterns: string[];
  pastFailures: string[];
  deploymentQuirks: string[];
  testCoverageGaps: string[];
  knownGotchas: string[];
}

export interface ContextManager {
  load(projectPath: string): Promise<ProjectContext>;
  save(projectPath: string, context: ProjectContext): Promise<void>;
  appendLearning(
    projectPath: string,
    category: keyof ProjectContext,
    learning: string
  ): Promise<void>;
  toPromptContext(context: ProjectContext): string;
}

const CONTEXT_FILE = ".nightforge/context.md";

const EMPTY_CONTEXT: ProjectContext = {
  architecture: [],
  patterns: [],
  pastFailures: [],
  deploymentQuirks: [],
  testCoverageGaps: [],
  knownGotchas: [],
};

export function createContextManager(): ContextManager {
  const parseContextFile = (content: string): ProjectContext => {
    const context: ProjectContext = { ...EMPTY_CONTEXT };
    const sections = content.split(/^## /m);

    for (const section of sections) {
      const lines = section.trim().split("\n");
      const header = lines[0]?.toLowerCase() ?? "";
      const items = lines
        .slice(1)
        .filter((l) => l.startsWith("- "))
        .map((l) => l.slice(2));

      if (header.includes("architecture")) {
        context.architecture = items;
      } else if (header.includes("pattern")) {
        context.patterns = items;
      } else if (header.includes("failure")) {
        context.pastFailures = items;
      } else if (header.includes("deployment") || header.includes("quirk")) {
        context.deploymentQuirks = items;
      } else if (header.includes("coverage") || header.includes("gap")) {
        context.testCoverageGaps = items;
      } else if (header.includes("gotcha")) {
        context.knownGotchas = items;
      }
    }

    return context;
  };

  const serializeContext = (context: ProjectContext): string => {
    const sections: string[] = ["# Project Context\n"];

    const addSection = (title: string, items: string[]): void => {
      if (items.length > 0) {
        sections.push(`## ${title}\n${items.map((i) => `- ${i}`).join("\n")}\n`);
      }
    };

    addSection("Architecture", context.architecture);
    addSection("Patterns", context.patterns);
    addSection("Past Failures", context.pastFailures);
    addSection("Deployment Quirks", context.deploymentQuirks);
    addSection("Test Coverage Gaps", context.testCoverageGaps);
    addSection("Known Gotchas", context.knownGotchas);

    return sections.join("\n");
  };

  return {
    async load(projectPath: string): Promise<ProjectContext> {
      const contextPath = path.join(projectPath, CONTEXT_FILE);

      try {
        const content = await readFile(contextPath, "utf-8");
        logger.info({ projectPath }, "Project context loaded");
        return parseContextFile(content);
      } catch {
        logger.info({ projectPath }, "No context file found, using empty context");
        return { ...EMPTY_CONTEXT };
      }
    },

    async save(projectPath: string, context: ProjectContext): Promise<void> {
      const contextPath = path.join(projectPath, CONTEXT_FILE);
      const contextDir = path.dirname(contextPath);

      await mkdir(contextDir, { recursive: true });
      await writeFile(contextPath, serializeContext(context), "utf-8");

      logger.info({ projectPath }, "Project context saved");
    },

    async appendLearning(
      projectPath: string,
      category: keyof ProjectContext,
      learning: string
    ): Promise<void> {
      const context = await this.load(projectPath);
      const items = context[category];

      if (!items.includes(learning)) {
        items.push(learning);
        await this.save(projectPath, context);
        logger.info({ projectPath, category }, "Learning appended");
      }
    },

    toPromptContext(context: ProjectContext): string {
      const parts: string[] = [];

      if (context.architecture.length > 0) {
        parts.push(`Architecture:\n${context.architecture.join("\n")}`);
      }
      if (context.patterns.length > 0) {
        parts.push(`Patterns:\n${context.patterns.join("\n")}`);
      }
      if (context.pastFailures.length > 0) {
        parts.push(`Past Failures (avoid repeating):\n${context.pastFailures.join("\n")}`);
      }
      if (context.knownGotchas.length > 0) {
        parts.push(`Known Gotchas:\n${context.knownGotchas.join("\n")}`);
      }

      return parts.length > 0
        ? `## Project Context\n\n${parts.join("\n\n")}`
        : "";
    },
  };
}
