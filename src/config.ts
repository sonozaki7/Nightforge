import { z } from "zod";

const configSchema = z.object({
  redis: z.object({
    url: z.string().url().default("redis://localhost:6379"),
  }),
  linear: z.object({
    apiKey: z.string().min(1, "LINEAR_API_KEY is required"),
    webhookSecret: z.string().min(1, "LINEAR_WEBHOOK_SECRET is required"),
  }),
  providers: z.object({
    dashscope: z.object({
      apiKey: z.string().default(""),
      baseUrl: z
        .string()
        .url()
        .default("https://dashscope.aliyuncs.com/compatible-mode/v1"),
      model: z.string().default("qwen3-235b-a22b"),
    }),
    anthropic: z.object({
      apiKey: z.string().default(""),
    }),
    openrouter: z.object({
      apiKey: z.string().default(""),
      baseUrl: z
        .string()
        .url()
        .default("https://openrouter.ai/api/v1"),
    }),
  }),
  services: z.object({
    stripe: z.object({
      apiKey: z.string().default(""),
    }),
    cloudflare: z.object({
      apiToken: z.string().default(""),
      accountId: z.string().default(""),
    }),
    google: z.object({
      accessToken: z.string().default(""),
    }),
    crawl4ai: z.object({
      url: z.string().url().default("http://localhost:11235"),
    }),
    searxng: z.object({
      url: z.string().url().default("http://localhost:8080"),
    }),
  }),
  paths: z.object({
    projectsDir: z.string().default("/srv/apps"),
    worktreesDir: z.string().default("/srv/nightforge/worktrees"),
  }),
  acp: z.object({
    /** Enable ACP adapter support (requires CLI binaries installed) */
    enabled: z.coerce.boolean().default(false),
    /** Default adapter when ticket has generic "acp" label */
    defaultAdapter: z.enum(["claude", "codex"]).default("claude"),
    /** Auto-approve all permission requests */
    autoApprove: z.coerce.boolean().default(false),
    /** Session timeout in minutes */
    sessionTimeoutMinutes: z.coerce.number().int().positive().default(30),
  }),
  limits: z.object({
    maxConcurrentWorkers: z.coerce.number().int().positive().default(6),
    maxDailyBudgetUsd: z.coerce.number().positive().default(50),
    maxAgenticIterations: z.coerce.number().int().positive().default(30),
  }),
  sandbox: z.object({
    /** auto | docker | seatbelt | unsafe */
    mode: z.enum(["auto", "docker", "seatbelt", "unsafe"]).default("auto"),
    dockerImage: z.string().default("node:22-alpine"),
    memoryMb: z.coerce.number().int().positive().default(1024),
    cpus: z.coerce.number().positive().default(1),
    networkEnabled: z.coerce.boolean().default(false),
    timeoutMs: z.coerce.number().int().positive().default(300000),
  }),
  executionMode: z.object({
    /** Route tickets by complexity automatically (no label required). */
    autoRoute: z.coerce.boolean().default(true),
    /** Minimum complexity score before the agentic path is used. */
    agenticThreshold: z.coerce.number().int().min(0).default(3),
  }),
  costLedger: z.object({
    /** Alibaba token plan: total tokens in plan per month */
    alibabaPlanTokens: z.coerce.number().positive().default(5_860_000_000),
    /** Alibaba token plan: monthly base price USD (before tax) */
    alibabaPlanPriceUsd: z.coerce.number().positive().default(68),
    /** Tokens already used before Nightforge (from Alibaba dashboard, post-reset days only) */
    alibabaBaselineUsed: z.coerce.number().default(222_300_000),
    /** Cached token weight in quota (1.0 = Alibaba counts all tokens equally) */
    alibabaCachedWeight: z.coerce.number().min(0).max(1).default(1.0),
    /** Typical cache hit ratio from dashboard (for display/reference) */
    alibabaCacheHitRatio: z.coerce.number().min(0).max(1).default(0.93),
  }),
  timezone: z.string().default("Asia/Bangkok"),
  /** Project id tickets are routed to (matches a dir under PROJECTS_DIR). */
  projectId: z.string().default("nightforge"),
  github: z.object({
    /**
     * Fine-grained PAT used to push merged code to origin and to query the
     * commit status API (the CI gate). Empty = gate skipped (local dev).
     */
    token: z.string().default(""),
  }),
  server: z.object({
    port: z.coerce.number().int().positive().default(3000),
    host: z.string().default("0.0.0.0"),
  }),
});

export interface Config {
  redis: {
    url: string;
  };
  linear: {
    apiKey: string;
    webhookSecret: string;
  };
  providers: {
    dashscope: {
      apiKey: string;
      baseUrl: string;
      model: string;
    };
    anthropic: {
      apiKey: string;
    };
    openrouter: {
      apiKey: string;
      baseUrl: string;
    };
  };
  services: {
    stripe: {
      apiKey: string;
    };
    cloudflare: {
      apiToken: string;
      accountId: string;
    };
    google: {
      accessToken: string;
    };
    crawl4ai: {
      url: string;
    };
    searxng: {
      url: string;
    };
  };
  paths: {
    projectsDir: string;
    worktreesDir: string;
  };
  acp: {
    enabled: boolean;
    defaultAdapter: "claude" | "codex";
    autoApprove: boolean;
    sessionTimeoutMinutes: number;
  };
  limits: {
    maxConcurrentWorkers: number;
    maxDailyBudgetUsd: number;
    maxAgenticIterations: number;
  };
  sandbox: {
    mode: "auto" | "docker" | "seatbelt" | "unsafe";
    dockerImage: string;
    memoryMb: number;
    cpus: number;
    networkEnabled: boolean;
    timeoutMs: number;
  };
  executionMode: {
    autoRoute: boolean;
    agenticThreshold: number;
  };
  costLedger: {
    alibabaPlanTokens: number;
    alibabaPlanPriceUsd: number;
    alibabaBaselineUsed: number;
    alibabaCachedWeight: number;
    alibabaCacheHitRatio: number;
  };
  timezone: string;
  projectId: string;
  github: {
    token: string;
  };
  server: {
    port: number;
    host: string;
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const raw = {
    redis: {
      url: env.REDIS_URL,
    },
    linear: {
      apiKey: env.LINEAR_API_KEY,
      webhookSecret: env.LINEAR_WEBHOOK_SECRET,
    },
    providers: {
      dashscope: {
        apiKey: env.DASHSCOPE_API_KEY,
        baseUrl: env.DASHSCOPE_BASE_URL,
        model: env.DASHSCOPE_MODEL,
      },
      anthropic: {
        apiKey: env.ANTHROPIC_API_KEY,
      },
      openrouter: {
        apiKey: env.OPENROUTER_API_KEY,
        baseUrl: env.OPENROUTER_BASE_URL,
      },
    },
    services: {
      stripe: {
        apiKey: env.STRIPE_API_KEY,
      },
      cloudflare: {
        apiToken: env.CLOUDFLARE_API_TOKEN,
        accountId: env.CLOUDFLARE_ACCOUNT_ID,
      },
      google: {
        accessToken: env.GOOGLE_ACCESS_TOKEN,
      },
      crawl4ai: {
        url: env.CRAWL4AI_URL,
      },
      searxng: {
        url: env.SEARXNG_URL,
      },
    },
    paths: {
      projectsDir: env.PROJECTS_DIR,
      worktreesDir: env.WORKTREES_DIR,
    },
    acp: {
      enabled: env.ACP_ENABLED,
      defaultAdapter: env.ACP_DEFAULT_ADAPTER,
      autoApprove: env.ACP_AUTO_APPROVE,
      sessionTimeoutMinutes: env.ACP_SESSION_TIMEOUT_MINUTES,
    },
    limits: {
      maxConcurrentWorkers: env.MAX_CONCURRENT_WORKERS,
      maxDailyBudgetUsd: env.MAX_DAILY_BUDGET_USD,
      maxAgenticIterations: env.MAX_AGENTIC_ITERATIONS,
    },
    sandbox: {
      mode: env.SANDBOX_MODE as "auto" | "docker" | "seatbelt" | "unsafe" | undefined,
      dockerImage: env.SANDBOX_DOCKER_IMAGE,
      memoryMb: env.SANDBOX_MEMORY_MB,
      cpus: env.SANDBOX_CPUS,
      networkEnabled: env.SANDBOX_NETWORK_ENABLED,
      timeoutMs: env.SANDBOX_TIMEOUT_MS,
    },
    executionMode: {
      autoRoute: env.AUTO_ROUTE_EXECUTION_MODE,
      agenticThreshold: env.AGENTIC_THRESHOLD,
    },
    costLedger: {
      alibabaPlanTokens: env.ALIBABA_PLAN_TOKENS,
      alibabaPlanPriceUsd: env.ALIBABA_PLAN_PRICE_USD,
      alibabaBaselineUsed: env.ALIBABA_BASELINE_USED_TOKENS,
      alibabaCachedWeight: env.ALIBABA_CACHED_TOKEN_WEIGHT,
      alibabaCacheHitRatio: env.ALIBABA_CACHE_HIT_RATIO,
    },
    timezone: env.TIMEZONE,
    projectId: env.PROJECT_ID,
    github: {
      token: env.GITHUB_TOKEN,
    },
    server: {
      port: env.PORT,
      host: env.HOST,
    },
  };

  const result = configSchema.safeParse(raw);

  if (!result.success) {
    const errors = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Configuration validation failed:\n${errors}`);
  }

  return result.data;
}
