import { logger } from "../logger";
import { getXauusdPrice, getXauusdCandles } from "../marketData";
import type { JuniorTool, JuniorToolContext, JuniorToolResult } from "./types";

/**
 * Junior tool registry.
 *
 * Phase 1: market-data tools only. Every tool here calls the SAME shared
 * functions the existing /api/xauusd/* routes use (src/lib/marketData.ts) —
 * no duplicated fetch/calculation logic, no invented numbers.
 *
 * Not wired to an orchestrator/LLM yet — that's a later phase. This module
 * is safe to import and call directly (e.g. from tests) today.
 */

async function safe<T>(label: string, fn: () => Promise<T>): Promise<JuniorToolResult<T>> {
  try {
    const data = await fn();
    return { ok: true, data };
  } catch (err) {
    logger.error({ err }, `[junior] tool failed: ${label}`);
    return { ok: false, error: `${label} is currently unavailable` };
  }
}

export const get_xauusd_price: JuniorTool<void, Awaited<ReturnType<typeof getXauusdPrice>>> = {
  name: "get_xauusd_price",
  description:
    "Current XAUUSD spot price, 24h change, and whether the market is currently open. " +
    "Same live data as the app's price ticker.",
  requiresAuth: false,
  run: async (_args, _ctx: JuniorToolContext) => safe("get_xauusd_price", () => getXauusdPrice()),
};

export interface GetMarketDataArgs {
  /** One of: 1m, 5m, 15m, 30m, 1h, 4h, 1d. Defaults to 1h. */
  interval?: string;
}

export const get_market_data: JuniorTool<GetMarketDataArgs, Awaited<ReturnType<typeof getXauusdCandles>>> = {
  name: "get_market_data",
  description:
    "OHLC candles for XAUUSD at a given timeframe (1m/5m/15m/30m/1h/4h/1d). " +
    "Same data as the app's chart.",
  requiresAuth: false,
  run: async (args, _ctx: JuniorToolContext) =>
    safe("get_market_data", () => getXauusdCandles(args?.interval ?? "1h")),
};

/** Registry, keyed by tool name — how a future orchestrator will look tools up. */
export const juniorTools = {
  get_xauusd_price,
  get_market_data,
} as const;

export type JuniorToolName = keyof typeof juniorTools;
