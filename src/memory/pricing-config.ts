import type { Config } from "../config.js";
import type { ProviderPricing } from "./cost-ledger.js";

/**
 * Unified cost ledger pricing (per provider). Qwen runs on the Alibaba
 * token plan (subscription shadow cost); Claude and Hermes are pay-per-use.
 */
export function buildProviderPricing(config: Config): Record<string, ProviderPricing> {
  return {
    qwen: {
      model: "token-plan",
      planPriceUsd: config.costLedger.alibabaPlanPriceUsd,
      planTotalTokens: config.costLedger.alibabaPlanTokens,
      baselineUsedTokens: config.costLedger.alibabaBaselineUsed,
      cachedTokenWeight: config.costLedger.alibabaCachedWeight,
      cacheHitRatio: config.costLedger.alibabaCacheHitRatio,
    },
    claude: {
      model: "pay-per-use",
      costPerMillionInput: 5.0,
      costPerMillionOutput: 25.0,
      cachedInputMultiplier: 0.1,
    },
    hermes: {
      model: "pay-per-use",
      costPerMillionInput: 0.13,
      costPerMillionOutput: 0.4,
    },
  };
}
