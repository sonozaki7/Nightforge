import pino from "pino";
import type { Tool, ToolResult } from "../types.js";

const logger = pino({ name: "nightforge-tool-crawler" });

export interface CrawlerToolConfig {
  /** Crawl4AI server URL (self-hosted) */
  crawl4aiUrl: string;
  /** SearXNG instance URL (self-hosted) */
  searxngUrl: string;
}

/**
 * Web search tool via self-hosted SearXNG.
 * Unlimited searches, zero cost, no API key needed.
 */
export function createSearchTool(config: CrawlerToolConfig): Tool {
  return {
    definition: {
      name: "web_search",
      description:
        "Search the web using SearXNG. Returns URLs, titles, and snippets. " +
        "Use for finding websites, people, companies, documentation, etc. " +
        "Supports search categories: general, news, images, it, science, files.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query",
          },
          categories: {
            type: "string",
            description: "Search category (default: general)",
            enum: ["general", "news", "images", "it", "science", "files"],
          },
          maxResults: {
            type: "number",
            description: "Maximum results to return (default: 10)",
          },
        },
        required: ["query"],
      },
      permission: "auto",
      service: "search",
    },

    async execute(args: Record<string, unknown>): Promise<ToolResult> {
      const start = Date.now();
      const query = args["query"] as string;
      const categories = (args["categories"] as string | undefined) ?? "general";
      const maxResults = (args["maxResults"] as number | undefined) ?? 10;

      try {
        const params = new URLSearchParams({
          q: query,
          format: "json",
          categories,
        });

        const response = await fetch(`${config.searxngUrl}/search?${params.toString()}`);

        if (!response.ok) {
          return {
            success: false,
            data: null,
            error: `SearXNG returned ${String(response.status)}`,
            durationMs: Date.now() - start,
          };
        }

        const data = (await response.json()) as {
          results?: Array<{ url: string; title: string; content: string }>;
        };

        const results = (data.results ?? []).slice(0, maxResults).map((r) => ({
          url: r.url,
          title: r.title,
          snippet: r.content,
        }));

        return { success: true, data: { results, total: results.length }, durationMs: Date.now() - start };
      } catch (err) {
        const error = err as Error;
        logger.error({ query, error: error.message }, "Search failed");
        return { success: false, data: null, error: `Search failed: ${error.message}`, durationMs: Date.now() - start };
      }
    },
  };
}

/**
 * Web crawling tool via self-hosted Crawl4AI.
 * Unlimited pages, LLM-friendly markdown output, email/link extraction.
 */
export function createCrawlTool(config: CrawlerToolConfig): Tool {
  return {
    definition: {
      name: "crawl_page",
      description:
        "Crawl a URL and get clean markdown content. Handles JavaScript rendering. " +
        "Returns page content as markdown plus extracted links and emails. " +
        "Use for scraping websites, reading documentation, extracting contact info.",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "URL to crawl",
          },
          extractEmails: {
            type: "boolean",
            description: "Extract email addresses from the page (default: true)",
          },
          extractLinks: {
            type: "boolean",
            description: "Extract all links from the page (default: false)",
          },
        },
        required: ["url"],
      },
      permission: "auto",
      service: "crawl",
    },

    async execute(args: Record<string, unknown>): Promise<ToolResult> {
      const start = Date.now();
      const url = args["url"] as string;
      const extractEmails = (args["extractEmails"] as boolean | undefined) ?? true;
      const extractLinks = (args["extractLinks"] as boolean | undefined) ?? false;

      try {
        const response = await fetch(`${config.crawl4aiUrl}/crawl`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            urls: url,
            word_count_threshold: 10,
            extract_blocks: false,
            bypass_cache: false,
          }),
        });

        if (!response.ok) {
          return {
            success: false,
            data: null,
            error: `Crawl4AI returned ${String(response.status)}`,
            durationMs: Date.now() - start,
          };
        }

        const data = (await response.json()) as {
          results?: Array<{
            markdown?: string;
            links?: Array<{ href: string; text: string }>;
            metadata?: Record<string, unknown>;
          }>;
        };

        const page = data.results?.[0];
        if (!page) {
          return { success: false, data: null, error: "No content returned from crawl", durationMs: Date.now() - start };
        }

        const markdown = page.markdown ?? "";
        const result: Record<string, unknown> = {
          url,
          content: markdown.slice(0, 50_000), // Cap at 50k chars for context
          title: page.metadata?.["title"] ?? "",
        };

        if (extractEmails) {
          result["emails"] = extractEmailAddresses(markdown);
        }

        if (extractLinks && page.links) {
          result["links"] = page.links.slice(0, 100);
        }

        return { success: true, data: result, durationMs: Date.now() - start };
      } catch (err) {
        const error = err as Error;
        logger.error({ url, error: error.message }, "Crawl failed");
        return { success: false, data: null, error: `Crawl failed: ${error.message}`, durationMs: Date.now() - start };
      }
    },
  };
}

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

function extractEmailAddresses(text: string): string[] {
  const matches = text.match(EMAIL_REGEX) ?? [];
  // Deduplicate and filter common false positives
  const filtered = matches.filter(
    (e) => !e.endsWith(".png") && !e.endsWith(".jpg") && !e.endsWith(".css") && !e.includes("@2x")
  );
  return [...new Set(filtered)];
}
