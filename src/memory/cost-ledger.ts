import type { Redis } from "ioredis";
import pino from "pino";

const logger = pino({ name: "nightforge-cost-ledger" });

const LEDGER_KEY = "nightforge:ledger:";
const PROVIDER_KEY = "nightforge:ledger-provider:";

/**
 * Pricing model for a provider:
 * - "token-plan": Prepaid plan. Cost = planPriceUsd / planTokens × tokensUsed.
 *   (Alibaba Model Studio token plan works this way)
 * - "pay-per-use": Per-million-token pricing. Cost = input×rate + output×rate.
 *   (Anthropic, OpenRouter, standard DashScope work this way)
 */
export type PricingModel = "token-plan" | "pay-per-use";

export interface TokenPlanPricing {
  model: PricingModel & "token-plan";
  /** Monthly plan cost in USD (base price, before tax) */
  planPriceUsd: number;
  /** Total tokens included in the plan per month */
  planTotalTokens: number;
  /** Tokens already consumed before Nightforge started tracking (from dashboard) */
  baselineUsedTokens?: number;
  /**
   * Cached input tokens cost this fraction of uncached tokens in the quota.
   * Alibaba token plans heavily discount cached reads.
   * Default 0.1 = cached tokens count as 10% toward quota.
   * Set to 1.0 if cached and uncached cost the same.
   */
  cachedTokenWeight?: number;
  /**
   * Typical cache hit ratio (from dashboard) used to convert raw baseline tokens
   * to weighted tokens. Default 0.93.
   */
  cacheHitRatio?: number;
}

export interface PayPerUsePricing {
  model: PricingModel & "pay-per-use";
  costPerMillionInput: number;
  costPerMillionOutput: number;
  /** Cached input discount (e.g. 0.1 = 90% cheaper) */
  cachedInputMultiplier?: number;
}

export type ProviderPricing = TokenPlanPricing | PayPerUsePricing;

/** A single API call's token usage (returned by every provider) */
export interface TokenUsage {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
}

/** Cost breakdown for a single API call */
export interface CostEntry {
  provider: string;
  model: string;
  ticketId: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  costUsd: number;
  timestamp: number;
}

/** Per-provider summary for dashboard display */
export interface ProviderCostSummary {
  provider: string;
  pricingModel: PricingModel;
  totalTokensUsed: number;
  totalCostUsd: number;
  callCount: number;
  /** For token-plan: percentage of plan consumed */
  planPercentUsed?: number;
  /** For token-plan: estimated remaining tokens */
  planTokensRemaining?: number;
}

/** Full cost breakdown for a ticket */
export interface TicketCostBreakdown {
  ticketId: string;
  totalCostUsd: number;
  totalTokens: number;
  byProvider: Array<{
    provider: string;
    model: string;
    tokens: number;
    costUsd: number;
    calls: number;
  }>;
}

export interface CostLedger {
  /** Record an API call's usage and compute cost based on provider pricing */
  record(usage: TokenUsage, ticketId: string): Promise<CostEntry>;
  /** Get full cost breakdown for a ticket */
  getTicketBreakdown(ticketId: string): Promise<TicketCostBreakdown>;
  /** Get per-provider summary for today */
  getProviderSummaries(): Promise<ProviderCostSummary[]>;
  /** Get today's total spend across all providers */
  getDailyTotal(date?: Date): Promise<number>;
  /** Get token-plan usage status (for Alibaba-style prepaid plans) */
  getPlanStatus(provider: string): Promise<{
    weightedTokensUsed: number;
    tokensRemaining: number;
    percentUsed: number;
    effectiveRatePerMillion: number;
    cachedTokenWeight: number;
  } | null>;
}

function getDateKey(date: Date): string {
  return date.toISOString().split("T")[0] ?? "";
}

/**
 * Create the unified cost ledger.
 *
 * Pricing config example:
 * ```
 * {
 *   qwen: { model: "token-plan", planPriceUsd: 20, planTotalTokens: 50_000_000 },
 *   claude: { model: "pay-per-use", costPerMillionInput: 5, costPerMillionOutput: 25 },
 *   openrouter: { model: "pay-per-use", costPerMillionInput: 0.13, costPerMillionOutput: 0.4 },
 * }
 * ```
 */
export function createCostLedger(
  redis: Redis,
  pricingConfig: Record<string, ProviderPricing>
): CostLedger {
  const pricing = new Map(Object.entries(pricingConfig));

  function computeCost(usage: TokenUsage): number {
    const providerPricing = pricing.get(usage.provider);
    if (!providerPricing) {
      logger.warn({ provider: usage.provider }, "No pricing configured, cost = 0");
      return 0;
    }

    if (providerPricing.model === "token-plan") {
      // Prepaid plan with cached token discount
      const cachedWeight = providerPricing.cachedTokenWeight ?? 0.1;
      const cached = usage.cachedInputTokens ?? 0;
      const uncachedInput = usage.inputTokens - cached;
      const output = usage.outputTokens;

      // Weighted tokens: cached costs less in the quota
      const weightedTokens = (uncachedInput + output) + (cached * cachedWeight);
      const effectiveRate = providerPricing.planPriceUsd / providerPricing.planTotalTokens;
      return weightedTokens * effectiveRate;
    }

    // Pay-per-use
    const cached = usage.cachedInputTokens ?? 0;
    const freshInput = usage.inputTokens - cached;
    const multiplier = providerPricing.cachedInputMultiplier ?? 1;

    const inputCost =
      (freshInput / 1_000_000) * providerPricing.costPerMillionInput +
      (cached / 1_000_000) * providerPricing.costPerMillionInput * multiplier;
    const outputCost = (usage.outputTokens / 1_000_000) * providerPricing.costPerMillionOutput;

    return inputCost + outputCost;
  }

  return {
    async record(usage: TokenUsage, ticketId: string): Promise<CostEntry> {
      const costUsd = computeCost(usage);
      const now = Date.now();
      const dateKey = getDateKey(new Date(now));

      const entry: CostEntry = {
        provider: usage.provider,
        model: usage.model,
        ticketId,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cachedInputTokens: usage.cachedInputTokens ?? 0,
        costUsd,
        timestamp: now,
      };

      const serialized = JSON.stringify(entry);

      // Store in daily ledger
      await redis.zadd(`${LEDGER_KEY}${dateKey}`, now, serialized);
      await redis.expire(`${LEDGER_KEY}${dateKey}`, 30 * 24 * 3600);

      // Store per-ticket
      await redis.zadd(`${LEDGER_KEY}ticket:${ticketId}`, now, serialized);
      await redis.expire(`${LEDGER_KEY}ticket:${ticketId}`, 90 * 24 * 3600);

      // Accumulate per-provider totals (for plan tracking)
      // For token-plan: track weighted tokens (matches quota meter)
      // For pay-per-use: track raw tokens
      const providerPricing = pricing.get(usage.provider);
      let trackedTokens: number;
      if (providerPricing?.model === "token-plan") {
        const cachedWeight = providerPricing.cachedTokenWeight ?? 0.1;
        const cached = usage.cachedInputTokens ?? 0;
        const uncachedInput = usage.inputTokens - cached;
        trackedTokens = (uncachedInput + usage.outputTokens) + (cached * cachedWeight);
      } else {
        trackedTokens = usage.inputTokens + usage.outputTokens;
      }
      await redis.incrbyfloat(`${PROVIDER_KEY}${usage.provider}:tokens`, trackedTokens);
      await redis.incrbyfloat(`${PROVIDER_KEY}${usage.provider}:cost`, costUsd);
      await redis.incr(`${PROVIDER_KEY}${usage.provider}:calls`);

      logger.info(
        { provider: usage.provider, model: usage.model, ticketId, costUsd, trackedTokens },
        "Cost recorded"
      );

      return entry;
    },

    async getTicketBreakdown(ticketId: string): Promise<TicketCostBreakdown> {
      const entries = await redis.zrange(`${LEDGER_KEY}ticket:${ticketId}`, 0, -1);
      const parsed = entries.map((e) => JSON.parse(e) as CostEntry);

      const byProviderMap = new Map<string, { model: string; tokens: number; costUsd: number; calls: number }>();

      for (const entry of parsed) {
        const key = `${entry.provider}:${entry.model}`;
        const existing = byProviderMap.get(key) ?? { model: entry.model, tokens: 0, costUsd: 0, calls: 0 };
        existing.tokens += entry.inputTokens + entry.outputTokens;
        existing.costUsd += entry.costUsd;
        existing.calls += 1;
        byProviderMap.set(key, existing);
      }

      return {
        ticketId,
        totalCostUsd: parsed.reduce((sum, e) => sum + e.costUsd, 0),
        totalTokens: parsed.reduce((sum, e) => sum + e.inputTokens + e.outputTokens, 0),
        byProvider: [...byProviderMap.entries()].map(([key, val]) => ({
          provider: key.split(":")[0] ?? "",
          ...val,
        })),
      };
    },

    async getProviderSummaries(): Promise<ProviderCostSummary[]> {
      const summaries: ProviderCostSummary[] = [];

      for (const [provider, providerPricing] of pricing.entries()) {
        const tokensStr = await redis.get(`${PROVIDER_KEY}${provider}:tokens`);
        const costStr = await redis.get(`${PROVIDER_KEY}${provider}:cost`);
        const callsStr = await redis.get(`${PROVIDER_KEY}${provider}:calls`);

        const totalTokens = parseFloat(tokensStr ?? "0");
        const totalCost = parseFloat(costStr ?? "0");
        const callCount = parseInt(callsStr ?? "0", 10);

        const summary: ProviderCostSummary = {
          provider,
          pricingModel: providerPricing.model,
          totalTokensUsed: totalTokens,
          totalCostUsd: totalCost,
          callCount,
        };

        if (providerPricing.model === "token-plan") {
          const rawBaseline = providerPricing.baselineUsedTokens ?? 0;
          const hitRatio = providerPricing.cacheHitRatio ?? 0.93;
          const cachedWeight = providerPricing.cachedTokenWeight ?? 0.1;
          const baselineWeighted = rawBaseline * ((1 - hitRatio) + hitRatio * cachedWeight);
          const totalUsed = baselineWeighted + totalTokens;
          summary.planPercentUsed = (totalUsed / providerPricing.planTotalTokens) * 100;
          summary.planTokensRemaining = Math.max(0, providerPricing.planTotalTokens - totalUsed);
        }

        summaries.push(summary);
      }

      return summaries;
    },

    async getDailyTotal(date?: Date): Promise<number> {
      const dateKey = getDateKey(date ?? new Date());
      const entries = await redis.zrange(`${LEDGER_KEY}${dateKey}`, 0, -1);
      const parsed = entries.map((e) => JSON.parse(e) as CostEntry);
      return parsed.reduce((sum, e) => sum + e.costUsd, 0);
    },

    async getPlanStatus(provider: string): Promise<{
      weightedTokensUsed: number;
      tokensRemaining: number;
      percentUsed: number;
      effectiveRatePerMillion: number;
      cachedTokenWeight: number;
    } | null> {
      const providerPricing = pricing.get(provider);
      if (!providerPricing || providerPricing.model !== "token-plan") return null;

      const tokensStr = await redis.get(`${PROVIDER_KEY}${provider}:tokens`);
      const nfWeightedTokens = parseFloat(tokensStr ?? "0");

      // Convert raw baseline to weighted using cache hit ratio
      const rawBaseline = providerPricing.baselineUsedTokens ?? 0;
      const hitRatio = providerPricing.cacheHitRatio ?? 0.93;
      const cachedWeight = providerPricing.cachedTokenWeight ?? 0.1;
      // baseline_weighted = raw * ((1 - hitRatio) + hitRatio * cachedWeight)
      const baselineWeighted = rawBaseline * ((1 - hitRatio) + hitRatio * cachedWeight);

      const totalUsed = baselineWeighted + nfWeightedTokens;
      const remaining = Math.max(0, providerPricing.planTotalTokens - totalUsed);
      const effectiveRate = (providerPricing.planPriceUsd / providerPricing.planTotalTokens) * 1_000_000;

      return {
        weightedTokensUsed: totalUsed,
        tokensRemaining: remaining,
        percentUsed: (totalUsed / providerPricing.planTotalTokens) * 100,
        effectiveRatePerMillion: effectiveRate,
        cachedTokenWeight: cachedWeight,
      };
    },
  };
}
