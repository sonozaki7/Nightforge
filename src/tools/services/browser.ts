import pino from "pino";
import type { Tool, ToolResult } from "../types.js";

const logger = pino({ name: "nightforge-tool-browser" });

export interface BrowserToolConfig {
  /** Playwright browser-ws endpoint or local launch */
  wsEndpoint?: string;
  /** Default timeout for page actions in ms */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT = 30_000;

/**
 * Browser automation tool via Playwright.
 * For tasks requiring login sessions, complex interactions, or visual browsing.
 * Uses Playwright's CDP connection for persistent browser sessions.
 */
export function createBrowserTool(config: BrowserToolConfig): Tool {
  const timeout = config.timeoutMs ?? DEFAULT_TIMEOUT;

  return {
    definition: {
      name: "browser_action",
      description:
        "Perform browser automation actions using Playwright. " +
        "Use for: logging into sites, filling forms, clicking buttons, taking screenshots, " +
        "navigating multi-step flows, interacting with SPAs. " +
        "Actions: navigate, click, type, screenshot, extract, scroll, wait.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            description: "Browser action to perform",
            enum: ["navigate", "click", "type", "screenshot", "extract", "scroll", "wait", "evaluate"],
          },
          url: {
            type: "string",
            description: "URL to navigate to (for navigate action)",
          },
          selector: {
            type: "string",
            description: "CSS selector for the target element (for click/type/extract)",
          },
          value: {
            type: "string",
            description: "Text to type (for type action) or script to evaluate (for evaluate)",
          },
          extractFormat: {
            type: "string",
            description: "What to extract: text, html, attribute, links (default: text)",
            enum: ["text", "html", "links", "emails"],
          },
        },
        required: ["action"],
      },
      permission: "approve",
      service: "browser",
    },

    async execute(args: Record<string, unknown>): Promise<ToolResult> {
      const start = Date.now();
      const action = args["action"] as string;

      try {
        // Dynamic import — playwright is an optional peer dependency.
        // Variable prevents TypeScript from statically resolving the module.
        const moduleName = "playwright";
        const playwright = (await import(moduleName).catch(() => {
          throw new Error("playwright is not installed. Run: npm install playwright");
        })) as PlaywrightModule;

        const browser = config.wsEndpoint
          ? await playwright.chromium.connectOverCDP(config.wsEndpoint)
          : await playwright.chromium.launch({ headless: true });

        const context = await browser.newContext({
          userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        });
        const page = await context.newPage();
        page.setDefaultTimeout(timeout);

        try {
          const result = await executeBrowserAction(page, action, args);
          return { success: true, data: result, durationMs: Date.now() - start };
        } finally {
          await context.close();
          if (!config.wsEndpoint) {
            await browser.close();
          }
        }
      } catch (err) {
        const error = err as Error;
        logger.error({ action, error: error.message }, "Browser action failed");
        return {
          success: false,
          data: null,
          error: `Browser action failed: ${error.message}`,
          durationMs: Date.now() - start,
        };
      }
    },
  };
}

interface PlaywrightModule {
  chromium: {
    connectOverCDP(endpoint: string): Promise<PlaywrightBrowser>;
    launch(options?: { headless?: boolean }): Promise<PlaywrightBrowser>;
  };
}

interface PlaywrightBrowser {
  newContext(options?: Record<string, unknown>): Promise<PlaywrightContext>;
  close(): Promise<void>;
}

interface PlaywrightContext {
  newPage(): Promise<PlaywrightPage>;
  close(): Promise<void>;
}

interface PlaywrightPage {
  setDefaultTimeout(ms: number): void;
  goto(url: string): Promise<unknown>;
  click(selector: string): Promise<void>;
  fill(selector: string, value: string): Promise<void>;
  screenshot(options?: { fullPage?: boolean }): Promise<Buffer>;
  textContent(selector: string): Promise<string | null>;
  innerHTML(selector: string): Promise<string>;
  content(): Promise<string>;
  evaluate(script: string): Promise<unknown>;
  mouse: { wheel(x: number, y: number): Promise<void> };
  waitForTimeout(ms: number): Promise<void>;
  waitForSelector(selector: string): Promise<unknown>;
  $$eval(selector: string, fn: (els: PlaywrightElement[]) => unknown): Promise<unknown>;
}

interface PlaywrightElement {
  textContent: string | null;
  getAttribute(name: string): string | null;
}

async function executeBrowserAction(
  page: PlaywrightPage,
  action: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const url = args["url"] as string | undefined;
  const selector = args["selector"] as string | undefined;
  const value = args["value"] as string | undefined;
  const extractFormat = (args["extractFormat"] as string | undefined) ?? "text";

  switch (action) {
    case "navigate": {
      if (!url) throw new Error("navigate requires 'url' parameter");
      await page.goto(url);
      const title = await page.evaluate("document.title");
      return { navigated: url, title };
    }

    case "click": {
      if (!selector) throw new Error("click requires 'selector' parameter");
      await page.click(selector);
      return { clicked: selector };
    }

    case "type": {
      if (!selector || value === undefined) throw new Error("type requires 'selector' and 'value'");
      await page.fill(selector, value);
      return { typed: value, into: selector };
    }

    case "screenshot": {
      const buffer = await page.screenshot({ fullPage: true });
      return { screenshot: `data:image/png;base64,${buffer.toString("base64")}`, size: buffer.length };
    }

    case "extract": {
      if (extractFormat === "links") {
        return await page.$$eval("a[href]", (els: PlaywrightElement[]) =>
          els.map((el) => ({ text: el.textContent?.trim() ?? "", href: el.getAttribute("href") ?? "" }))
        );
      }
      if (extractFormat === "emails") {
        const html = await page.content();
        const emails = html.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) ?? [];
        return { emails: [...new Set(emails)] };
      }
      if (!selector) {
        const html = await page.content();
        return { content: html.slice(0, 50_000) };
      }
      if (extractFormat === "html") {
        return { html: await page.innerHTML(selector) };
      }
      return { text: await page.textContent(selector) };
    }

    case "scroll": {
      await page.mouse.wheel(0, 500);
      return { scrolled: true };
    }

    case "wait": {
      const ms = (args["ms"] as number | undefined) ?? 2000;
      if (selector) {
        await page.waitForSelector(selector);
        return { waitedFor: selector };
      }
      await page.waitForTimeout(ms);
      return { waitedMs: ms };
    }

    case "evaluate": {
      if (!value) throw new Error("evaluate requires 'value' (script) parameter");
      // SECURITY: page.evaluate runs JS in the sandboxed browser page context (not Node).
      // This is Playwright's standard API for DOM interaction. Gated behind "approve"
      // permission tier — every call requires human approval via Telegram before execution.
      return await page.evaluate(value);
    }

    default:
      throw new Error(`Unknown browser action: ${action}`);
  }
}
