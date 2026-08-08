import { logger } from "./logger";
import { liveGoldFeed } from "./liveGoldFeed";

/**
 * Shared XAUUSD market-data + indicator helpers.
 *
 * Extracted from routes/xauusd.ts so the same logic can be reused by both
 * the HTTP routes and the Junior agent's tool layer (src/lib/junior/) without
 * duplicating fetch/calculation code. Route behavior is unchanged — these
 * are the exact same functions, just moved + exported.
 */

export const YF_TIMEOUT_MS = 12_000; // 12 s — prevents hanging requests on Render

// Yahoo Finance sometimes returns 429 or blocks data-center IPs.
// Retry once with a backup host before giving up.
export async function yfChart(
  symbol: string,
  interval: string,
  range: string,
): Promise<any> {
  const hosts = [
    "https://query1.finance.yahoo.com/v8/finance/chart",
    "https://query2.finance.yahoo.com/v8/finance/chart",
  ];

  let lastErr: unknown;
  for (const host of hosts) {
    const url = `${host}/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), YF_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "application/json",
          "Accept-Language": "en-US,en;q=0.9",
        },
      });
      clearTimeout(timer);
      if (res.status === 429) {
        lastErr = new Error(`Price feed rate-limited (429) for ${symbol}`);
        continue; // try backup host
      }
      if (!res.ok) throw new Error(`Price feed error: ${res.status} for ${symbol}`);
      return await res.json();
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      // AbortError = timeout — don't bother retrying same host
    }
  }
  throw lastErr;
}

export function metaFromChart(data: any) {
  return data?.chart?.result?.[0]?.meta ?? null;
}

export function candlesFromChart(data: any) {
  const result = data?.chart?.result?.[0];
  if (!result) return [];
  const timestamps: number[] = result.timestamp || [];
  const q = result.indicators?.quote?.[0] || {};
  return timestamps
    .map((t: number, i: number) => ({
      time: t * 1000,
      open: (q.open?.[i] ?? q.close?.[i] ?? 0) as number,
      high: (q.high?.[i] ?? q.close?.[i] ?? 0) as number,
      low: (q.low?.[i] ?? q.close?.[i] ?? 0) as number,
      close: (q.close?.[i] ?? 0) as number,
      volume: (q.volume?.[i] ?? 0) as number,
    }))
    .filter((c) => c.close > 0);
}

export function closesFromChart(data: any): number[] {
  const q = data?.chart?.result?.[0]?.indicators?.quote?.[0];
  return (q?.close || []).filter((c: any) => c != null) as number[];
}

export function yfIntervalRange(interval: string): { yfInterval: string; yfRange: string } {
  switch (interval) {
    case "1m":  return { yfInterval: "1m",  yfRange: "1d"  };
    case "5m":  return { yfInterval: "5m",  yfRange: "5d"  };
    case "15m": return { yfInterval: "15m", yfRange: "5d"  };
    case "30m": return { yfInterval: "30m", yfRange: "1mo" };
    case "1h":  return { yfInterval: "1h",  yfRange: "5d"  };
    case "4h":  return { yfInterval: "1h",  yfRange: "5d"  };
    case "1d":  return { yfInterval: "1d",  yfRange: "1mo" };
    default:    return { yfInterval: "1h",  yfRange: "5d"  };
  }
}

export function computeRsi14(closes: number[]): number {
  if (closes.length < 15) return 50;
  const gains: number[] = [], losses: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gains.push(d > 0 ? d : 0);
    losses.push(d < 0 ? -d : 0);
  }
  const ag = gains.slice(-14).reduce((a, b) => a + b, 0) / 14;
  const al = losses.slice(-14).reduce((a, b) => a + b, 0) / 14;
  const rs = al === 0 ? 100 : ag / al;
  return 100 - 100 / (1 + rs);
}

export function computeEma(arr: number[], n: number): number {
  const k = 2 / (n + 1);
  return arr.reduce((prev, val) => prev + (val - prev) * k, arr[0]);
}

export function computeMacd(closes: number[]): number {
  if (closes.length < 26) return 0;
  return computeEma(closes.slice(-26), 12) - computeEma(closes.slice(-26), 26);
}

export function signalFrom(closes: number[]): "bullish" | "bearish" | "neutral" | "overbought" | "oversold" {
  if (closes.length < 26) return "neutral";
  const last = closes[closes.length - 1];
  const rsi  = computeRsi14(closes);
  const sma20 = closes.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, closes.length);
  const sma50 = closes.slice(-50).reduce((a, b) => a + b, 0) / Math.min(50, closes.length);
  if (rsi > 70) return "overbought";
  if (rsi < 30) return "oversold";
  if (last > sma20 && last > sma50) return "bullish";
  if (last < sma20 && last < sma50) return "bearish";
  return "neutral";
}

// Aggregate 1h candles into 4h buckets
export function aggregate4h(hourlyCloses: number[]): number[] {
  const out: number[] = [];
  for (let i = 3; i < hourlyCloses.length; i += 4) {
    out.push(hourlyCloses[i]); // close of the 4th candle = 4h close
  }
  return out;
}

// Combine 1h + 4h signals: higher TF dominates, same = confirmed
export function combineSignals(
  s1h: string, s4h: string,
): "bullish" | "bearish" | "neutral" | "overbought" | "oversold" {
  if (s4h === s1h) return s4h as any;
  // 4h is higher timeframe — gives it more weight
  if ((s4h === "bearish" || s4h === "overbought") && (s1h === "bearish" || s1h === "overbought")) return "bearish";
  if ((s4h === "bullish" || s4h === "oversold")   && (s1h === "bullish" || s1h === "oversold"))   return "bullish";
  if (s4h === "bearish" || s4h === "overbought") return "bearish";
  if (s4h === "bullish" || s4h === "oversold")   return "bullish";
  return "neutral";
}

/**
 * Current XAUUSD spot price + daily change. Same data as GET /api/xauusd/price.
 * Throws on upstream failure — callers decide how to surface that (HTTP 5xx,
 * or a "data unavailable" tool result for Junior; never fabricate a price).
 */
export async function getXauusdPrice() {
  const data = await yfChart("GC=F", "1d", "5d");
  const meta = metaFromChart(data);
  if (!meta) throw new Error("Price data unavailable");

  const prev = meta.chartPreviousClose ?? meta.regularMarketPrice;
  const price = meta.regularMarketPrice ?? 0;
  const change = price - (prev ?? price);
  const changePct = prev ? (change / prev) * 100 : 0;

  return {
    price,
    change: parseFloat(change.toFixed(2)),
    changePct: parseFloat(changePct.toFixed(3)),
    high24h: meta.regularMarketDayHigh ?? price,
    low24h: meta.regularMarketDayLow ?? price,
    open24h: prev ?? price,
    timestamp: meta.regularMarketTime ?? Date.now() / 1000,
    marketOpen: liveGoldFeed.isEffectivelyOpen(liveGoldFeed.getLatest()),
  };
}

/**
 * OHLC candles for a given interval. Same data as GET /api/xauusd/chart.
 */
export async function getXauusdCandles(interval: string = "1h") {
  const { yfInterval, yfRange } = yfIntervalRange(interval);
  const data = await yfChart("GC=F", yfInterval, yfRange);
  let candles = candlesFromChart(data);

  // Aggregate 1h → 4h for "4h" timeframe
  if (interval === "4h" && candles.length > 0) {
    const buckets: typeof candles = [];
    for (let i = 0; i < candles.length; i += 4) {
      const chunk = candles.slice(i, i + 4);
      if (!chunk.length) continue;
      buckets.push({
        time: chunk[0].time,
        open: chunk[0].open,
        high: Math.max(...chunk.map((c) => c.high)),
        low: Math.min(...chunk.map((c) => c.low)),
        close: chunk[chunk.length - 1].close,
        volume: chunk.reduce((s, c) => s + c.volume, 0),
      });
    }
    candles = buckets;
  }

  return { candles, interval, count: candles.length };
}

/**
 * Indicators + signal + pivots. Same data/shape as GET /api/xauusd/technicals.
 */
export async function getXauusdTechnicals() {
  const [hourlyData, yfDailyData] = await Promise.all([
    yfChart("GC=F", "1h", "5d"),
    yfChart("GC=F", "1d", "1mo"),
  ]);
  const closes1h = closesFromChart(hourlyData);
  const dailyData = yfDailyData;

  if (closes1h.length < 26) {
    throw new Error("Not enough data");
  }

  const closes4h = aggregate4h(closes1h);
  const last = closes1h[closes1h.length - 1];

  const rsi  = computeRsi14(closes1h);
  const macd = computeMacd(closes1h);
  const macdSignal = computeEma([macd], 9);
  const sma20 = closes1h.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, closes1h.length);
  const sma50 = closes1h.slice(-50).reduce((a, b) => a + b, 0) / Math.min(50, closes1h.length);

  const sig1h = signalFrom(closes1h);
  const sig4h = closes4h.length >= 26 ? signalFrom(closes4h) : sig1h;
  const signal_overall = combineSignals(sig1h, sig4h);

  const dailyCandles: { high: number; low: number; close: number }[] = [];
  const dq  = dailyData?.chart?.result?.[0]?.indicators?.quote?.[0];
  const dts: number[] = dailyData?.chart?.result?.[0]?.timestamp ?? [];
  if (dq && dts.length) {
    for (let i = 0; i < dts.length; i++) {
      const h = dq.high?.[i], l = dq.low?.[i], c = dq.close?.[i];
      if (h != null && l != null && c != null && c > 0) dailyCandles.push({ high: h, low: l, close: c });
    }
  }
  const prevDay = dailyCandles.length >= 2
    ? dailyCandles[dailyCandles.length - 2]
    : dailyCandles[dailyCandles.length - 1];

  const pH = prevDay?.high  ?? last;
  const pL = prevDay?.low   ?? last;
  const pC = prevDay?.close ?? last;
  const pp  = (pH + pL + pC) / 3;
  const r1  = 2 * pp - pL;
  const r2  = pp + (pH - pL);
  const s1  = 2 * pp - pH;
  const s2  = pp - (pH - pL);

  const fmt = (n: number) => parseFloat(n.toFixed(2));

  return {
    rsi:          parseFloat(rsi.toFixed(2)),
    sma20:        parseFloat(sma20.toFixed(2)),
    sma50:        parseFloat(sma50.toFixed(2)),
    macd:         parseFloat(macd.toFixed(4)),
    macdSignal:   parseFloat(macdSignal.toFixed(4)),
    currentPrice: parseFloat(last.toFixed(2)),
    signal:       signal_overall,
    signal_1h:    sig1h,
    signal_4h:    sig4h,
    pivot: fmt(pp),
    r1: fmt(r1), r2: fmt(r2),
    s1: fmt(s1), s2: fmt(s2),
  };
}
