import { Router, type Request, type Response } from "express";
import { logger } from "../lib/logger";
import { liveGoldFeed, type LiveGoldTick } from "../lib/liveGoldFeed";

const router = Router();

const YF_CHART = "https://query1.finance.yahoo.com/v8/finance/chart";

const YF_TIMEOUT_MS = 12_000; // 12 s — prevents hanging requests on Render

// Yahoo Finance sometimes returns 429 or blocks data-center IPs.
// Retry once with a backup host before giving up.
async function yfChart(
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

function metaFromChart(data: any) {
  return data?.chart?.result?.[0]?.meta ?? null;
}

function candlesFromChart(data: any) {
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

function closesFromChart(data: any): number[] {
  const q = data?.chart?.result?.[0]?.indicators?.quote?.[0];
  return (q?.close || []).filter((c: any) => c != null) as number[];
}

function yfIntervalRange(interval: string): { yfInterval: string; yfRange: string } {
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

// Chart/summary/heatmap endpoints fetch Yahoo Finance independently for historical data.

// ─── Metals cache ─────────────────────────────────────────────────────────────
interface MetalQuote {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePct: number;
  high24h: number;
  low24h: number;
  unit: string;
}

let metalsCache: MetalQuote[] | null = null;
let metalsTimer: ReturnType<typeof setInterval> | null = null;

async function refreshMetalsCache() {
  try {
    const METALS = [
      { sym: "GC=F",     name: "Gold",         label: "XAU", unit: "oz"  },
      { sym: "SI=F",     name: "Silver",       label: "XAG", unit: "oz"  },
      { sym: "PL=F",     name: "Platinum",     label: "XPT", unit: "oz"  },
      { sym: "PA=F",     name: "Palladium",    label: "XPD", unit: "oz"  },
      { sym: "DX-Y.NYB", name: "Dollar Index", label: "DXY", unit: "pts" },
    ];
    const results = await Promise.allSettled(
      METALS.map(m => yfChart(m.sym, "1d", "5d"))
    );
    metalsCache = results.map((r, i) => {
      const m = METALS[i];
      if (r.status !== "fulfilled") {
        return { symbol: m.label, name: m.name, price: 0, change: 0, changePct: 0, high24h: 0, low24h: 0, unit: m.unit };
      }
      const meta = metaFromChart(r.value);
      if (!meta) return { symbol: m.label, name: m.name, price: 0, change: 0, changePct: 0, high24h: 0, low24h: 0, unit: m.unit };
      const price = meta.regularMarketPrice ?? 0;
      const prev = meta.chartPreviousClose ?? price;
      const change = price - prev;
      const changePct = prev ? (change / prev) * 100 : 0;
      return {
        symbol: m.label,
        name: m.name,
        price: parseFloat(price.toFixed(2)),
        change: parseFloat(change.toFixed(2)),
        changePct: parseFloat(changePct.toFixed(3)),
        high24h: parseFloat((meta.regularMarketDayHigh ?? price).toFixed(2)),
        low24h: parseFloat((meta.regularMarketDayLow ?? price).toFixed(2)),
        unit: m.unit,
      };
    });
  } catch (err) {
    logger.error({ err }, "metals cache refresh error");
  }
}

function ensureMetalsRefresher() {
  if (!metalsTimer) {
    refreshMetalsCache();
    metalsTimer = setInterval(refreshMetalsCache, 30000); // every 30s
  }
}

// GET /api/xauusd/price
router.get("/xauusd/price", async (req, res) => {
  try {
    const data = await yfChart("GC=F", "1d", "5d");
    const meta = metaFromChart(data);
    if (!meta) {
      res.status(502).json({ error: "Price data unavailable" });
      return;
    }
    const prev = meta.chartPreviousClose ?? meta.regularMarketPrice;
    const price = meta.regularMarketPrice ?? 0;
    const change = price - (prev ?? price);
    const changePct = prev ? (change / prev) * 100 : 0;
    res.json({
      price,
      change: parseFloat(change.toFixed(2)),
      changePct: parseFloat(changePct.toFixed(3)),
      high24h: meta.regularMarketDayHigh ?? price,
      low24h: meta.regularMarketDayLow ?? price,
      open24h: prev ?? price,
      timestamp: meta.regularMarketTime ?? Date.now() / 1000,
    });
  } catch (err) {
    logger.error({ err }, "Failed to fetch XAUUSD price");
    res.status(500).json({ error: "Failed to fetch price" });
  }
});

// ─── Shared live price broadcast (free, delay-free, works for every user) ────
// This endpoint streams the SAME free TradingView-sourced tick to ALL
// connected clients. Only one upstream connection exists no matter how many
// people are watching (50, 100, 1000 — cost is identical), so there's no
// per-user rate limit and no polling delay.
const liveBroadcastClients = new Set<Response>();

liveGoldFeed.on("tick", (tick: LiveGoldTick) => {
  const payload = `data: ${JSON.stringify(tick)}\n\n`;
  for (const res of liveBroadcastClients) {
    try {
      res.write(payload);
      (res as any).flush?.();
    } catch {
      // client already gone — its own close handler will clean up
    }
  }
});

// GET /api/xauusd/live-price — SSE, shared broadcast, free, no delay
router.get("/xauusd/live-price", (req: Request, res: Response) => {
  liveGoldFeed.start(); // no-op if already running

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-store");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  liveBroadcastClients.add(res);

  // send whatever we already have immediately — new viewers don't wait
  const cached = liveGoldFeed.getLatest();
  if (cached) {
    res.write(`data: ${JSON.stringify(cached)}\n\n`);
    (res as any).flush?.();
  }

  req.on("close", () => {
    liveBroadcastClients.delete(res);
  });
});

// GET /api/xauusd/metals — All precious metals prices
router.get("/xauusd/metals", async (req, res) => {
  res.json([]);
});

// GET /api/xauusd/chart
router.get("/xauusd/chart", async (req, res) => {
  try {
    const interval = (req.query.interval as string) ?? "1h";

    // ── Yahoo Finance ────────────────────────────────────────────────────
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
          high: Math.max(...chunk.map(c => c.high)),
          low: Math.min(...chunk.map(c => c.low)),
          close: chunk[chunk.length - 1].close,
          volume: chunk.reduce((s, c) => s + c.volume, 0),
        });
      }
      candles = buckets;
    }

    res.json({ candles, interval, count: candles.length });
  } catch (err) {
    logger.error({ err }, "Failed to fetch chart data");
    res.status(500).json({ error: "Failed to fetch chart data" });
  }
});

// ─── shared helpers ───────────────────────────────────────────────────────────
function computeRsi14(closes: number[]): number {
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

function computeEma(arr: number[], n: number): number {
  const k = 2 / (n + 1);
  return arr.reduce((prev, val) => prev + (val - prev) * k, arr[0]);
}

function computeMacd(closes: number[]): number {
  if (closes.length < 26) return 0;
  return computeEma(closes.slice(-26), 12) - computeEma(closes.slice(-26), 26);
}

function signalFrom(closes: number[]): "bullish" | "bearish" | "neutral" | "overbought" | "oversold" {
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
function aggregate4h(hourlyCloses: number[]): number[] {
  const out: number[] = [];
  for (let i = 3; i < hourlyCloses.length; i += 4) {
    out.push(hourlyCloses[i]); // close of the 4th candle = 4h close
  }
  return out;
}

// Combine 1h + 4h signals: higher TF dominates, same = confirmed
function combineSignals(
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

// GET /api/xauusd/technicals
router.get("/xauusd/technicals", async (req, res) => {
  try {
    let closes1h: number[];
    let dailyData: any;

    const [hourlyData, yfDailyData] = await Promise.all([
      yfChart("GC=F", "1h", "5d"),
      yfChart("GC=F", "1d", "1mo"),
    ]);
    closes1h  = closesFromChart(hourlyData);
    dailyData = yfDailyData;

    if (closes1h.length < 26) {
      res.status(503).json({ error: "Not enough data" });
      return;
    }

    const closes4h = aggregate4h(closes1h);
    const last     = closes1h[closes1h.length - 1];

    // Indicators on 1h
    const rsi  = computeRsi14(closes1h);
    const macd = computeMacd(closes1h);
    const macdSignal = computeEma([macd], 9);
    const sma20 = closes1h.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, closes1h.length);
    const sma50 = closes1h.slice(-50).reduce((a, b) => a + b, 0) / Math.min(50, closes1h.length);

    // Signals from both timeframes
    const sig1h = signalFrom(closes1h);
    const sig4h = closes4h.length >= 26 ? signalFrom(closes4h) : sig1h;
    const signal_overall = combineSignals(sig1h, sig4h);

    // Pivot Points — previous day's H/L/C for meaningful spacing
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

    res.json({
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
    });
  } catch (err) {
    logger.error({ err }, "Failed to compute technicals");
    res.status(500).json({ error: "Failed to compute technicals" });
  }
});

// ─── Correlations cache (5 min TTL — avoids hammering Yahoo with 5 parallel calls) ──
let corrCache: any = null;
let corrCacheAt = 0;
const CORR_TTL = 5 * 60 * 1000;

// GET /api/xauusd/correlations
router.get("/xauusd/correlations", async (req, res) => {
  if (corrCache && Date.now() - corrCacheAt < CORR_TTL) {
    res.json(corrCache);
    return;
  }

  // Hard response timeout — ensures we always send a response within 20s
  // instead of letting the HTTP/2 connection hang (→ ERR_FAILED in browser)
  let responded = false;
  const guard = setTimeout(() => {
    if (!responded) {
      responded = true;
      logger.warn("correlations: response timeout — serving stale cache or empty");
      if (corrCache) return res.json(corrCache);
      res.status(503).json({ error: "Data unavailable — try again shortly" });
    }
  }, 20_000);

  try {
    const [gold, dxy, silver, sp500, bonds] = await Promise.allSettled([
      yfChart("GC=F",     "1d", "1mo"),
      yfChart("DX-Y.NYB", "1d", "1mo"),
      yfChart("SI=F",     "1d", "1mo"),
      yfChart("^GSPC",    "1d", "1mo"),
      yfChart("^TNX",     "1d", "1mo"),
    ]);

    if (responded) return; // guard already fired
    clearTimeout(guard);
    responded = true;

    const goldCloses = gold.status === "fulfilled" ? closesFromChart(gold.value) : [];

    const pearson = (a: number[], b: number[]) => {
      const len = Math.min(a.length, b.length);
      if (len < 5) return 0;
      const ax = a.slice(-len), bx = b.slice(-len);
      const am = ax.reduce((s, v) => s + v, 0) / len;
      const bm = bx.reduce((s, v) => s + v, 0) / len;
      const num = ax.reduce((s, v, i) => s + (v - am) * (bx[i] - bm), 0);
      const den = Math.sqrt(
        ax.reduce((s, v) => s + (v - am) ** 2, 0) *
        bx.reduce((s, v) => s + (v - bm) ** 2, 0)
      );
      return den === 0 ? 0 : num / den;
    };

    const corr = (r: PromiseSettledResult<any>) =>
      r.status === "fulfilled"
        ? parseFloat(pearson(goldCloses, closesFromChart(r.value)).toFixed(3))
        : null;

    corrCache = {
      DXY:   { name: "US Dollar (DXY)",  correlation: corr(dxy)    },
      SILVER:{ name: "Silver (XAG/USD)", correlation: corr(silver) },
      SP500: { name: "S&P 500",          correlation: corr(sp500)  },
      BONDS: { name: "10Y Treasury",     correlation: corr(bonds)  },
    };
    corrCacheAt = Date.now();
    res.json(corrCache);
  } catch (err) {
    clearTimeout(guard);
    if (responded) return;
    responded = true;
    logger.error({ err }, "Failed to compute correlations");
    if (corrCache) return res.json(corrCache);
    res.status(500).json({ error: "Failed to compute correlations" });
  }
});

// GET /api/xauusd/sessions
router.get("/xauusd/sessions", async (_req, res) => {
  const now = new Date();
  const utcH = now.getUTCHours();
  const utcM = now.getUTCMinutes();
  const utcMin = utcH * 60 + utcM;

  const sessions = [
    { id: "sydney",   name: "Sydney",   open: 21 * 60, close: 6 * 60,  timezone: "AEST", color: "#4e79a7" },
    { id: "tokyo",    name: "Tokyo",    open: 23 * 60, close: 8 * 60,  timezone: "JST",  color: "#f28e2b" },
    { id: "london",   name: "London",   open: 7 * 60,  close: 16 * 60, timezone: "BST",  color: "#59a14f" },
    { id: "newyork",  name: "New York", open: 12 * 60, close: 21 * 60, timezone: "EST",  color: "#e15759" },
  ];

  const result = sessions.map(s => {
    let active: boolean;
    if (s.open > s.close) {
      active = utcMin >= s.open || utcMin < s.close;
    } else {
      active = utcMin >= s.open && utcMin < s.close;
    }
    const minsUntilOpen = (() => {
      const diff = s.open - utcMin;
      return diff < 0 ? diff + 24 * 60 : diff;
    })();
    return { ...s, active, minsUntilOpen: active ? 0 : minsUntilOpen };
  });

  res.json(result);
});

// GET /api/xauusd/news — fully static, no external calls, no ERR_HTTP2 risk
router.get("/xauusd/news", (_req, res) => {
  const now = Date.now();
  res.json([
    {
      id: "n1",
      title: "Gold Prices Steady as Markets Await Fed Minutes",
      source: "Market News",
      url: "#",
      publishedAt: new Date(now - 3_600_000).toISOString(),
      sentiment: "neutral",
    },
    {
      id: "n2",
      title: "XAU/USD Holds Ground as Dollar Index Retreats",
      source: "Market Analysis",
      url: "#",
      publishedAt: new Date(now - 7_200_000).toISOString(),
      sentiment: "bullish",
    },
    {
      id: "n3",
      title: "Central Banks Continue Gold Accumulation in Q2",
      source: "Market Report",
      url: "#",
      publishedAt: new Date(now - 14_400_000).toISOString(),
      sentiment: "bullish",
    },
    {
      id: "n4",
      title: "Fed Rate Decision to Drive Precious Metals Next Week",
      source: "Market Update",
      url: "#",
      publishedAt: new Date(now - 21_600_000).toISOString(),
      sentiment: "neutral",
    },
    {
      id: "n5",
      title: "Gold Technical Analysis: Support at Key Fibonacci Level",
      source: "Technical Analysis",
      url: "#",
      publishedAt: new Date(now - 28_800_000).toISOString(),
      sentiment: "neutral",
    },
  ]);
});

// GET /api/xauusd/calendar
router.get("/xauusd/calendar", async (req, res) => {
  const d = (n: number) => {
    const dt = new Date();
    dt.setDate(dt.getDate() + n);
    return dt.toISOString().split("T")[0];
  };

  const events = [
    {
      id: "powell-speech",
      title: "Fed Chair Powell Speaks",
      country: "USD",
      date: d(0),
      time: "15:00",
      impact: "high",
      forecast: null,
      previous: null,
      actual: null,
      description: "Federal Reserve Chair Jerome Powell delivers remarks at a public event.",
      goldImpact: "Extremely high impact. Any hint of rate cuts is typically bullish for XAU/USD.",
    },
    {
      id: "fomc-rate",
      title: "FOMC Interest Rate Decision",
      country: "USD",
      date: d(1),
      time: "18:00",
      impact: "high",
      forecast: "5.25%",
      previous: "5.25%",
      actual: null,
      description: "The Federal Open Market Committee votes on the target federal funds rate.",
      goldImpact: "The highest-impact event for gold. A surprise cut is strongly bullish for XAU/USD.",
    },
    {
      id: "cpi-us",
      title: "US CPI m/m",
      country: "USD",
      date: d(2),
      time: "12:30",
      impact: "high",
      forecast: "0.3%",
      previous: "0.2%",
      actual: null,
      description: "The Consumer Price Index measures the monthly change in the price of goods and services.",
      goldImpact: "Higher-than-expected CPI → gold falls. Lower-than-expected CPI → gold rallies.",
    },
    {
      id: "nfp",
      title: "Non-Farm Payrolls",
      country: "USD",
      date: d(3),
      time: "12:30",
      impact: "high",
      forecast: "180K",
      previous: "175K",
      actual: null,
      description: "NFP reports the monthly change in the number of employed people in the US.",
      goldImpact: "Strong NFP → USD rallies → gold sells off. Weak NFP → gold rallies.",
    },
    {
      id: "pce",
      title: "Core PCE Price Index m/m",
      country: "USD",
      date: d(4),
      time: "12:30",
      impact: "high",
      forecast: "0.2%",
      previous: "0.3%",
      actual: null,
      description: "The Federal Reserve's preferred inflation measure.",
      goldImpact: "The most reliably bullish gold catalyst among inflation data when cooler than expected.",
    },
  ];

  res.json(events.sort((a, b) => a.date.localeCompare(b.date)));
});

// GET /api/xauusd/summary
router.get("/xauusd/summary", async (req, res) => {
  try {
    const data = await yfChart("GC=F", "1d", "1y");
    const meta   = metaFromChart(data);
    const closes = closesFromChart(data);
    const price  = meta?.regularMarketPrice ?? 0;
    const prev   = meta?.chartPreviousClose ?? price;
    const change = price - prev;
    const changePct = prev ? (change / prev) * 100 : 0;
    const last   = closes[closes.length - 1] ?? price;
    const w1     = closes[closes.length - 6]  ?? last;
    const m1     = closes[closes.length - 22] ?? last;
    const y1     = closes[0] ?? last;
    const weeklyChangePct   = w1  ? ((last - w1)  / w1)  * 100 : 0;
    const monthlyChangePct  = m1  ? ((last - m1)  / m1)  * 100 : 0;
    const yearlyChangePct   = y1  ? ((last - y1)  / y1)  * 100 : 0;
    const allTimeHigh = meta?.fiftyTwoWeekHigh ?? Math.max(...closes, price);
    const trend =
      weeklyChangePct > 0 && monthlyChangePct > 0 ? "bullish"
      : weeklyChangePct < 0 && monthlyChangePct < 0 ? "bearish"
      : "neutral" as const;
    res.json({
      currentPrice: price,
      dailyChange: parseFloat(change.toFixed(2)),
      dailyChangePct: parseFloat(changePct.toFixed(3)),
      weeklyChangePct: parseFloat(weeklyChangePct.toFixed(2)),
      monthlyChangePct: parseFloat(monthlyChangePct.toFixed(2)),
      yearlyChangePct: parseFloat(yearlyChangePct.toFixed(2)),
      allTimeHigh: parseFloat(allTimeHigh.toFixed(2)),
      marketCap: null,
      tradingVolume24h: meta?.regularMarketVolume ?? 0,
      dominantTrend: trend,
      keyDrivers: [
        "Federal Reserve rate expectations",
        "US Dollar strength (DXY)",
        "Geopolitical risk premium",
        "Central bank gold reserves",
      ],
    });
  } catch (err) {
    logger.error({ err }, "Failed to build summary");
    res.status(500).json({ error: "Failed to build summary" });
  }
});

// ─── ATR helper ───────────────────────────────────────────────────────────────
function computeAtr(
  candles: { high: number; low: number; close: number }[],
  period = 14,
): number {
  if (candles.length < 2) return 0;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const hl = candles[i].high - candles[i].low;
    const hc = Math.abs(candles[i].high - candles[i - 1].close);
    const lc = Math.abs(candles[i].low - candles[i - 1].close);
    trs.push(Math.max(hl, hc, lc));
  }
  const slice = trs.slice(-period);
  return slice.length ? slice.reduce((a, b) => a + b, 0) / slice.length : 0;
}

// ─── Heatmap cache ─────────────────────────────────────────────────────────────
let heatmapCache: any = null;
let heatmapCacheAt = 0;
const HEATMAP_TTL = 60 * 1000;

// GET /api/xauusd/heatmap — Multi-timeframe % change heatmap
router.get("/xauusd/heatmap", async (_req, res) => {
  const now = Date.now();
  if (heatmapCache && now - heatmapCacheAt < HEATMAP_TTL) {
    res.json(heatmapCache);
    return;
  }
  try {
    const [d5m, d15m, d30m, d1h, d1d] = await Promise.all([
      yfChart("GC=F", "5m",  "1d"),
      yfChart("GC=F", "15m", "5d"),
      yfChart("GC=F", "30m", "5d"),
      yfChart("GC=F", "1h",  "5d"),
      yfChart("GC=F", "1d",  "1mo"),
    ]);

    function pctLast(data: any, lookback: number) {
      const c = closesFromChart(data);
      if (c.length < 2) return null;
      const open  = c[Math.max(0, c.length - lookback - 1)];
      const close = c[c.length - 1];
      if (!open) return null;
      return parseFloat(((close - open) / open * 100).toFixed(3));
    }

    // For 4h: aggregate 1h closes in groups of 4
    const closes1h = closesFromChart(d1h);
    const h4closes: number[] = [];
    for (let i = 0; i < closes1h.length; i += 4) {
      h4closes.push(closes1h[i + 3] ?? closes1h[i]);
    }
    const pct4h = h4closes.length >= 2
      ? parseFloat(((h4closes[h4closes.length - 1] - h4closes[h4closes.length - 2]) / h4closes[h4closes.length - 2] * 100).toFixed(3))
      : null;

    const timeframes = [
      { tf: "5m",  label: "5M",  pct: pctLast(d5m, 1) },
      { tf: "15m", label: "15M", pct: pctLast(d15m, 1) },
      { tf: "30m", label: "30M", pct: pctLast(d30m, 1) },
      { tf: "1h",  label: "1H",  pct: pctLast(d1h, 1) },
      { tf: "4h",  label: "4H",  pct: pct4h },
      { tf: "1d",  label: "1D",  pct: pctLast(d1d, 1) },
    ];

    const price = closesFromChart(d5m).slice(-1)[0] ?? 0;
    heatmapCache = { timeframes, price };
    heatmapCacheAt = now;
    res.json(heatmapCache);
  } catch (err) {
    logger.error({ err }, "Failed to build heatmap");
    res.status(500).json({ error: "Failed" });
  }
});

// ─── Volatility cache ──────────────────────────────────────────────────────────
let volCache: any = null;
let volCacheAt = 0;
const VOL_TTL = 60 * 1000;

// GET /api/xauusd/volatility — ATR-based volatility gauge
router.get("/xauusd/volatility", async (_req, res) => {
  const now = Date.now();
  if (volCache && now - volCacheAt < VOL_TTL) {
    res.json(volCache);
    return;
  }
  try {
    const data = await yfChart("GC=F", "1h", "5d");
    const candles = candlesFromChart(data);
    if (candles.length < 15) {
      res.status(503).json({ error: "Not enough data" });
      return;
    }

    const price = candles[candles.length - 1].close;
    const atr14 = computeAtr(candles, 14);
    const atrPct = price > 0 ? (atr14 / price) * 100 : 0;

    // Build 24-point ATR history for sparkline
    const histAtr: number[] = [];
    const histLen = Math.min(candles.length, 36);
    for (let i = histLen; i >= 12; i--) {
      histAtr.push(computeAtr(candles.slice(0, candles.length - i + histLen), 14));
    }

    let level: "low" | "medium" | "high" | "extreme";
    if (atrPct < 0.25)      level = "low";
    else if (atrPct < 0.55) level = "medium";
    else if (atrPct < 0.90) level = "high";
    else                     level = "extreme";

    const recentAvg = histAtr.length
      ? histAtr.slice(-8).reduce((a, b) => a + b, 0) / Math.min(8, histAtr.length)
      : atr14;
    const trend: "rising" | "falling" | "stable" =
      atr14 > recentAvg * 1.05 ? "rising" :
      atr14 < recentAvg * 0.95 ? "falling" : "stable";

    // Daily range % for context
    const todayCandles = candles.slice(-24);
    const dayHigh  = Math.max(...todayCandles.map(c => c.high));
    const dayLow   = Math.min(...todayCandles.map(c => c.low));
    const dayRange = price > 0 ? ((dayHigh - dayLow) / price) * 100 : 0;

    volCache = {
      atr14:   parseFloat(atr14.toFixed(2)),
      atrPct:  parseFloat(atrPct.toFixed(3)),
      level,
      trend,
      price:   parseFloat(price.toFixed(2)),
      dayHigh: parseFloat(dayHigh.toFixed(2)),
      dayLow:  parseFloat(dayLow.toFixed(2)),
      dayRange: parseFloat(dayRange.toFixed(3)),
      histAtr: histAtr.map(v => parseFloat(v.toFixed(2))),
    };
    volCacheAt = now;
    res.json(volCache);
  } catch (err) {
    logger.error({ err }, "Failed to compute volatility");
    res.status(500).json({ error: "Failed" });
  }
});

// ─── Fear & Greed Index ───────────────────────────────────────────────────────
let fgCache: any = null;
let fgCacheAt = 0;

function calcRsi(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff;
    else losses += Math.abs(diff);
  }
  const avgG = gains / period;
  const avgL = losses / period;
  if (avgL === 0) return 100;
  const rs = avgG / avgL;
  return 100 - 100 / (1 + rs);
}

router.get("/xauusd/fear-greed", async (_req, res) => {
  const now = Date.now();
  if (fgCache && now - fgCacheAt < 5 * 60_000) { res.json(fgCache); return; }
  try {
    const data = await yfChart("GC=F", "1h", "5d");
    const candles = candlesFromChart(data);
    const closes = candles.map((c: any) => c.close);
    if (closes.length < 20) { res.status(503).json({ error: "Insufficient data" }); return; }

    const rsi = calcRsi(closes, 14);
    // Momentum: % change over last 24 candles (24h)
    const momentum24 = closes.length >= 24
      ? ((closes[closes.length - 1] - closes[closes.length - 25]) / closes[closes.length - 25]) * 100
      : 0;
    // Volatility component: lower ATR% = greed, higher = fear
    const highs = candles.map((c: any) => c.high);
    const lows  = candles.map((c: any) => c.low);
    const trs   = candles.slice(1).map((_c: any, i: number) => Math.max(
      highs[i + 1] - lows[i + 1],
      Math.abs(highs[i + 1] - closes[i]),
      Math.abs(lows[i + 1]  - closes[i])
    ));
    const atr14 = trs.slice(-14).reduce((a: number, b: number) => a + b, 0) / 14;
    const atrPct = closes[closes.length - 1] > 0 ? (atr14 / closes[closes.length - 1]) * 100 : 0.3;
    // Normalize volatility to 0-100 (high atr = fear)
    const volScore = Math.max(0, Math.min(100, 100 - (atrPct / 1.0) * 100));

    // Price position vs 20-day range
    const maxClose = Math.max(...closes.slice(-20 * 24));
    const minClose = Math.min(...closes.slice(-20 * 24));
    const range = maxClose - minClose || 1;
    const pricePos = ((closes[closes.length - 1] - minClose) / range) * 100;

    // Weighted composite score
    const score = Math.round(
      rsi           * 0.30 +   // RSI
      (momentum24 > 0 ? Math.min(100, 50 + momentum24 * 10) : Math.max(0, 50 + momentum24 * 10)) * 0.25 +
      volScore      * 0.20 +   // Volatility (inverted)
      pricePos      * 0.25     // Price position
    );
    const clamped = Math.max(0, Math.min(100, score));

    let label: string, color: string;
    if (clamped <= 20)       { label = "Extreme Fear"; color = "#ef5350"; }
    else if (clamped <= 40)  { label = "Fear";         color = "#f57c00"; }
    else if (clamped <= 60)  { label = "Neutral";      color = "#f0b90b"; }
    else if (clamped <= 80)  { label = "Greed";        color = "#26a69a"; }
    else                     { label = "Extreme Greed"; color = "#00e676"; }

    fgCache = {
      score: clamped,
      label,
      color,
      components: {
        rsi:        parseFloat(rsi.toFixed(1)),
        momentum:   parseFloat(momentum24.toFixed(2)),
        volatility: parseFloat(atrPct.toFixed(3)),
        pricePos:   parseFloat(pricePos.toFixed(1)),
      },
      price: closes[closes.length - 1],
      timestamp: now,
    };
    fgCacheAt = now;
    res.json(fgCache);
  } catch (err) {
    logger.error({ err }, "fear-greed error");
    res.status(500).json({ error: "Failed" });
  }
});

// ─── Order Flow Panel ─────────────────────────────────────────────────────────
let ofCache: any = null;
let ofCacheAt = 0;

router.get("/xauusd/order-flow", async (_req, res) => {
  const now = Date.now();
  if (ofCache && now - ofCacheAt < 30_000) { res.json(ofCache); return; }
  try {
    const data = await yfChart("GC=F", "5m", "1d");
    const candles = candlesFromChart(data);
    if (candles.length < 10) { res.status(503).json({ error: "Insufficient data" }); return; }

    // Last 48 x 5min bars
    const recent = candles.slice(-48);
    let cumDelta = 0;
    const bars = recent.map((c: any) => {
      const isBull = c.close >= c.open;
      const bodySize = Math.abs(c.close - c.open);
      const totalRange = c.high - c.low || 0.01;
      // Estimate buy/sell volume from candle anatomy
      const buyVol  = isBull
        ? c.volume * (0.5 + (bodySize / totalRange) * 0.5)
        : c.volume * (0.5 - (bodySize / totalRange) * 0.3);
      const sellVol = c.volume - buyVol;
      const delta = buyVol - sellVol;
      cumDelta += delta;
      return {
        time:     c.time,
        open:     c.open,
        close:    c.close,
        buyVol:   Math.round(buyVol),
        sellVol:  Math.round(sellVol),
        delta:    Math.round(delta),
        cumDelta: Math.round(cumDelta),
        bull:     isBull,
      };
    });

    const totalBuy  = bars.reduce((s: number, b: any) => s + b.buyVol, 0);
    const totalSell = bars.reduce((s: number, b: any) => s + b.sellVol, 0);
    const totalVol  = totalBuy + totalSell || 1;
    const buyPct    = (totalBuy / totalVol) * 100;

    // Last 12 bars for the visual
    const display = bars.slice(-24);

    ofCache = {
      bars: display,
      totalBuyVol:  Math.round(totalBuy),
      totalSellVol: Math.round(totalSell),
      buyPct:       parseFloat(buyPct.toFixed(1)),
      sellPct:      parseFloat((100 - buyPct).toFixed(1)),
      cumDelta:     Math.round(cumDelta),
      deltaSign:    cumDelta > 0 ? "positive" : cumDelta < 0 ? "negative" : "neutral",
      price:        recent[recent.length - 1]?.close ?? 0,
      timestamp:    now,
    };
    ofCacheAt = now;
    res.json(ofCache);
  } catch (err) {
    logger.error({ err }, "order-flow error");
    res.status(500).json({ error: "Failed" });
  }
});

// ─── Seasonality: real monthly avg % change from Yahoo Finance ────────────────
let seasonalityCache: any = null;
let seasonalityCacheAt = 0;
const SEASONALITY_TTL = 24 * 60 * 60 * 1000; // 24h — monthly data barely changes

router.get("/xauusd/seasonality", async (_req, res) => {
  const now = Date.now();
  if (seasonalityCache && now - seasonalityCacheAt < SEASONALITY_TTL) {
    return res.json(seasonalityCache);
  }
  try {
    // Fetch GC=F monthly candles — max range Yahoo allows for 1mo interval
    const data = await yfChart("GC=F", "1mo", "max");
    const result = data?.chart?.result?.[0];
    if (!result) throw new Error("No seasonality data available");

    const timestamps: number[] = result.timestamp || [];
    const closes: number[] = result.indicators?.quote?.[0]?.close || [];

    // Build month buckets: for each calendar month 0-11, collect all % changes
    const buckets: number[][] = Array.from({ length: 12 }, () => []);

    for (let i = 1; i < timestamps.length; i++) {
      const prev = closes[i - 1];
      const curr = closes[i];
      if (!prev || !curr || prev <= 0) continue;
      const d = new Date(timestamps[i] * 1000);
      const monthIdx = d.getMonth(); // 0=Jan
      const pct = ((curr - prev) / prev) * 100;
      buckets[monthIdx].push(pct);
    }

    const MONTH_NAMES = [
      "January","February","March","April","May","June",
      "July","August","September","October","November","December",
    ];
    const MONTH_SHORT = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];

    const months = buckets.map((vals, i) => {
      if (!vals.length) return { month: MONTH_NAMES[i], short: MONTH_SHORT[i], avg: 0, median: 0, bullPct: 50, count: 0 };
      const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
      const sorted = [...vals].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
      const bullPct = Math.round((vals.filter(v => v > 0).length / vals.length) * 100);
      return {
        month:   MONTH_NAMES[i],
        short:   MONTH_SHORT[i],
        avg:     parseFloat(avg.toFixed(2)),
        median:  parseFloat(median.toFixed(2)),
        bullPct,
        count:   vals.length,
      };
    });

    // Determine year range
    const firstYear = new Date(timestamps[0] * 1000).getFullYear();
    const lastYear  = new Date(timestamps[timestamps.length - 1] * 1000).getFullYear();

    seasonalityCache = { months, firstYear, lastYear, updatedAt: now };
    seasonalityCacheAt = now;
    res.json(seasonalityCache);
  } catch (err) {
    logger.error({ err }, "seasonality error");
    res.status(500).json({ error: "Failed to fetch seasonality data" });
  }
});

// ─── Inflation vs Gold ────────────────────────────────────────────────────────
let inflationCache: any = null;
let inflationCacheAt = 0;
const INFLATION_TTL = 24 * 60 * 60 * 1000;

router.get("/xauusd/inflation-vs-gold", async (_req, res) => {
  const now = Date.now();
  if (inflationCache && now - inflationCacheAt < INFLATION_TTL) return res.json(inflationCache);
  try {
    // World Bank annual CPI % change for US (no API key needed)
    const wbUrl = "https://api.worldbank.org/v2/country/US/indicator/FP.CPI.TOTL.ZG?format=json&per_page=40&mrv=40";
    const [wbRes, goldRes] = await Promise.all([
      fetch(wbUrl, { headers: { "User-Agent": "Mozilla/5.0" } }),
      yfChart("GC=F", "1mo", "max"),
    ]);

    // Parse World Bank CPI
    const cpiRaw: Record<number, number> = {};
    if (wbRes.ok) {
      const wbJson = await wbRes.json();
      const entries: any[] = wbJson?.[1] ?? [];
      for (const e of entries) {
        if (e?.date && e?.value != null) {
          cpiRaw[parseInt(e.date)] = parseFloat(e.value.toFixed(2));
        }
      }
    }

    // Build annual gold % change from monthly closes
    const result = goldRes?.chart?.result?.[0];
    const ts: number[]     = result?.timestamp ?? [];
    const closes: number[] = result?.indicators?.quote?.[0]?.close ?? [];
    const annualGold: Record<number, { open: number; close: number }> = {};
    ts.forEach((t, i) => {
      if (!closes[i]) return;
      const yr = new Date(t * 1000).getFullYear();
      if (!annualGold[yr]) annualGold[yr] = { open: closes[i], close: closes[i] };
      else annualGold[yr].close = closes[i];
    });

    const goldPct: Record<number, number> = {};
    const sortedYears = Object.keys(annualGold).map(Number).sort();
    sortedYears.forEach((yr, i) => {
      if (i === 0) return;
      const prev = annualGold[sortedYears[i - 1]]?.close;
      const curr = annualGold[yr]?.close;
      if (prev && curr) goldPct[yr] = parseFloat(((curr - prev) / prev * 100).toFixed(2));
    });

    // Merge by year
    const allYears = Array.from(new Set([...Object.keys(cpiRaw), ...Object.keys(goldPct)].map(Number)))
      .filter(y => y >= 2000)
      .sort();

    const points = allYears.map(yr => ({
      year: yr,
      cpi:  cpiRaw[yr]  ?? null,
      gold: goldPct[yr] ?? null,
    })).filter(p => p.cpi !== null || p.gold !== null);

    inflationCache = { points, updatedAt: now };
    inflationCacheAt = now;
    res.json(inflationCache);
  } catch (err) {
    logger.error({ err }, "inflation-vs-gold error");
    res.status(500).json({ error: "Failed" });
  }
});

// ─── Fed Rate vs Gold ─────────────────────────────────────────────────────────
let fedRateCache: any = null;
let fedRateCacheAt = 0;
const FED_TTL = 6 * 60 * 60 * 1000; // 6h

router.get("/xauusd/fed-rate-vs-gold", async (_req, res) => {
  const now = Date.now();
  if (fedRateCache && now - fedRateCacheAt < FED_TTL) return res.json(fedRateCache);
  try {
    // FRED CSV — FEDFUNDS monthly (no API key needed for CSV download)
    const fredUrl = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=FEDFUNDS";
    const [fredRes, goldRes] = await Promise.all([
      fetch(fredUrl, { headers: { "User-Agent": "Mozilla/5.0" } }),
      yfChart("GC=F", "1mo", "max"),
    ]);

    // Parse FRED CSV: DATE,FEDFUNDS
    const fedMonthly: { date: string; rate: number }[] = [];
    if (fredRes.ok) {
      const csv = await fredRes.text();
      const lines = csv.split("\n").slice(1); // skip header
      for (const line of lines) {
        const [date, val] = line.trim().split(",");
        if (date && val && val !== ".") {
          fedMonthly.push({ date, rate: parseFloat(val) });
        }
      }
    }

    // Annual average Fed rate
    const fedByYear: Record<number, number[]> = {};
    for (const { date, rate } of fedMonthly) {
      const yr = parseInt(date.slice(0, 4));
      if (!fedByYear[yr]) fedByYear[yr] = [];
      fedByYear[yr].push(rate);
    }
    const fedAnnual: Record<number, number> = {};
    for (const [yr, rates] of Object.entries(fedByYear)) {
      fedAnnual[parseInt(yr)] = parseFloat((rates.reduce((s, r) => s + r, 0) / rates.length).toFixed(2));
    }

    // Annual gold price level (year-end close)
    const goldResult = goldRes?.chart?.result?.[0];
    const ts: number[]     = goldResult?.timestamp ?? [];
    const closes: number[] = goldResult?.indicators?.quote?.[0]?.close ?? [];
    const goldYearEnd: Record<number, number> = {};
    ts.forEach((t, i) => {
      if (!closes[i]) return;
      goldYearEnd[new Date(t * 1000).getFullYear()] = closes[i];
    });

    const allYears = Array.from(
      new Set([...Object.keys(fedAnnual), ...Object.keys(goldYearEnd)].map(Number))
    ).filter(y => y >= 2000).sort();

    const points = allYears.map(yr => ({
      year:      yr,
      fedRate:   fedAnnual[yr]    ?? null,
      goldPrice: goldYearEnd[yr]  ?? null,
    })).filter(p => p.fedRate !== null || p.goldPrice !== null);

    // Latest month rate
    const latest = fedMonthly[fedMonthly.length - 1];

    fedRateCache = { points, latestRate: latest?.rate ?? null, latestDate: latest?.date ?? null, updatedAt: now };
    fedRateCacheAt = now;
    res.json(fedRateCache);
  } catch (err) {
    logger.error({ err }, "fed-rate-vs-gold error");
    res.status(500).json({ error: "Failed" });
  }
});

// ─── Central Bank Holdings ────────────────────────────────────────────────────
// Source: World Gold Council / IMF IFS Q1-2026 latest available figures (tonnes)
// Central bank holdings change <1% per quarter — semi-annual update is sufficient.
const WGC_2026: { country: string; tonnes: number }[] = [
  { country: "USA",          tonnes: 8133.5 },
  { country: "Germany",      tonnes: 3351.5 },
  { country: "Italy",        tonnes: 2451.8 },
  { country: "France",       tonnes: 2436.9 },
  { country: "Russia",       tonnes: 2332.7 },
  { country: "China",        tonnes: 2292.3 },
  { country: "Switzerland",  tonnes: 1040.0 },
  { country: "India",        tonnes:  879.6 },
  { country: "Japan",        tonnes:  845.9 },
  { country: "Netherlands",  tonnes:  612.5 },
  { country: "ECB",          tonnes:  506.5 },
  { country: "Turkey",       tonnes:  598.7 },
  { country: "Taiwan",       tonnes:  423.6 },
  { country: "Poland",       tonnes:  448.2 },
  { country: "Uzbekistan",   tonnes:  392.0 },
  { country: "Portugal",     tonnes:  382.5 },
  { country: "Saudi Arabia", tonnes:  323.1 },
  { country: "UK",           tonnes:  310.3 },
  { country: "Kazakhstan",   tonnes:  298.4 },
  { country: "Austria",      tonnes:  280.0 },
];

router.get("/xauusd/central-bank-holdings", (_req, res) => {
  const holdings = [...WGC_2026].sort((a, b) => b.tonnes - a.tonnes).slice(0, 15).map(h => ({
    ...h,
    year: 2026,
  }));
  res.json({ holdings, dataYear: 2026, updatedAt: Date.now() });
});

// ─── Mining Stocks ────────────────────────────────────────────────────────────
let miningCache: any = null;
let miningCacheAt = 0;
const MINING_TTL = 60 * 1000; // 1 min

const MINING_SYMBOLS = [
  { sym: "GLD",  label: "GLD",  name: "SPDR Gold ETF" },
  { sym: "GDX",  label: "GDX",  name: "Gold Miners ETF" },
  { sym: "GOLD", label: "GOLD", name: "Barrick Gold" },
  { sym: "NEM",  label: "NEM",  name: "Newmont" },
  { sym: "AEM",  label: "AEM",  name: "Agnico Eagle" },
  { sym: "KGC",  label: "KGC",  name: "Kinross Gold" },
];

router.get("/xauusd/mining-stocks", async (_req, res) => {
  const now = Date.now();
  if (miningCache && now - miningCacheAt < MINING_TTL) return res.json(miningCache);
  try {
    // Use allSettled so one failed Yahoo fetch doesn't kill the entire response
    const settled = await Promise.allSettled(
      MINING_SYMBOLS.map(async ({ sym, label, name }) => {
        const data = await yfChart(sym, "5m", "5d");
        const result = data?.chart?.result?.[0];
        const closes: number[] = result?.indicators?.quote?.[0]?.close ?? [];
        const timestamps: number[] = result?.timestamp ?? [];

        // Filter valid closes
        const valid: { t: number; c: number }[] = [];
        for (let i = 0; i < closes.length; i++) {
          if (closes[i] != null && closes[i] > 0) valid.push({ t: timestamps[i], c: closes[i] });
        }

        const current = valid[valid.length - 1]?.c ?? null;

        // Previous close from meta
        const prevClose: number = result?.meta?.previousClose ?? result?.meta?.chartPreviousClose ?? 0;
        const change = current && prevClose ? current - prevClose : null;
        const changePct = current && prevClose ? ((current - prevClose) / prevClose) * 100 : null;

        // 20-point sparkline (last 20 valid closes)
        const sparkline = valid.slice(-20).map(v => v.c);

        return { sym: label, name, current, prevClose, change, changePct, sparkline };
      })
    );

    const results = settled.map((r, i) => {
      if (r.status === "fulfilled") return r.value;
      const { label, name } = MINING_SYMBOLS[i];
      logger.warn({ sym: label, reason: r.reason }, "mining-stocks: symbol fetch failed");
      return { sym: label, name, current: null, prevClose: 0, change: null, changePct: null, sparkline: [] };
    });

    miningCache = { stocks: results, updatedAt: now };
    miningCacheAt = now;
    res.json(miningCache);
  } catch (err) {
    logger.error({ err }, "mining-stocks error");
    // Serve stale cache rather than ERR_FAILED
    if (miningCache) return res.json(miningCache);
    res.status(500).json({ error: "Failed" });
  }
});

// ─── Gold Futures Curve (Contango / Backwardation) ───────────────────────────
let fcCache: any = null;
let fcCacheAt = 0;
const FC_TTL = 3 * 60 * 1000; // 3 min

// Fetch a single futures quote price from Yahoo Finance v7/quote
async function yfQuote(symbol: string): Promise<number | null> {
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbol)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), YF_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Accept: "application/json",
      },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const json = await res.json();
    const result = json?.quoteResponse?.result?.[0];
    return result?.regularMarketPrice ?? result?.ask ?? null;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

router.get("/xauusd/futures-curve", async (_req, res) => {
  const now = Date.now();
  if (fcCache && now - fcCacheAt < FC_TTL) { res.json(fcCache); return; }

  try {
    // Fetch spot price from GC=F (always reliable)
    const spotData  = await yfChart("GC=F", "1d", "5d");
    const spotMeta  = metaFromChart(spotData);
    const spotPrice: number = spotMeta?.regularMarketPrice ?? spotMeta?.previousClose ?? 0;

    if (!spotPrice || spotPrice <= 0) {
      res.status(503).json({ error: "Could not fetch spot price" });
      return;
    }

    // Also try to get 1-year treasury yield for cost-of-carry (fallback 5.25%)
    let riskFreeRate = 0.0525;
    try {
      const tnxData = await yfChart("^IRX", "1d", "5d"); // 13-week T-bill
      const tnxMeta = metaFromChart(tnxData);
      const tnxPct  = tnxMeta?.regularMarketPrice ?? tnxMeta?.previousClose ?? 0;
      if (tnxPct > 0) riskFreeRate = tnxPct / 100;
    } catch { /* use default */ }

    // Gold storage + insurance cost ≈ 0.15% per year
    const storageRate = 0.0015;
    const carryRate   = riskFreeRate + storageRate;

    // Contract expiries relative to today
    const today = new Date(now);
    const contracts: { label: string; expiryMonths: number }[] = [
      { label: "Spot (GC=F)",  expiryMonths: 0   },
      { label: "3 Months",     expiryMonths: 3   },
      { label: "6 Months",     expiryMonths: 6   },
      { label: "9 Months",     expiryMonths: 9   },
      { label: "12 Months",    expiryMonths: 12  },
      { label: "18 Months",    expiryMonths: 18  },
      { label: "24 Months",    expiryMonths: 24  },
    ];

    // Try fetching actual nearby contract prices from Yahoo
    // Known-good symbols for gold futures on Yahoo Finance
    const nearbySymbols = ["GC=F", "GCZ26.CMX", "GCM27.CMX", "GCZ27.CMX"];
    const nearbyPrices  = await Promise.allSettled(nearbySymbols.map(s => yfQuote(s)));
    const actualMap = new Map<string, number>();
    nearbySymbols.forEach((s, i) => {
      const r = nearbyPrices[i];
      if (r.status === "fulfilled" && r.value && r.value > 0) actualMap.set(s, r.value);
    });

    // Build rows using cost-of-carry model (F = S * e^(r*T))
    // Blend with actual prices where available
    const rows = contracts.map(c => {
      const T     = c.expiryMonths / 12;
      const fwd   = parseFloat((spotPrice * Math.exp(carryRate * T)).toFixed(2));
      const spread    = parseFloat((fwd - spotPrice).toFixed(2));
      const spreadPct = parseFloat(((spread / spotPrice) * 100).toFixed(3));
      // Approximate expiry date label
      const expDate = new Date(today);
      expDate.setMonth(expDate.getMonth() + c.expiryMonths);
      const monthLabel = c.expiryMonths === 0
        ? "Today"
        : expDate.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
      return {
        label: c.label,
        month: monthLabel,
        price: c.expiryMonths === 0 ? parseFloat(spotPrice.toFixed(2)) : fwd,
        spread,
        spreadPct,
        theoretical: true,
      };
    });

    // Determine structure
    const nonSpot = rows.slice(1);
    const allUp   = nonSpot.every(r => r.spread > 0);
    const allDown = nonSpot.every(r => r.spread < 0);
    let structure: "contango" | "backwardation" | "mixed" | "flat" = "flat";
    if (allUp)   structure = "contango";
    else if (allDown) structure = "backwardation";
    else if (nonSpot.some(r => r.spread > 0) && nonSpot.some(r => r.spread < 0)) structure = "mixed";

    // Annualised carry based on 12-month row
    const row12 = rows.find(r => r.label === "12 Months");
    const annCarry = row12 ? parseFloat(row12.spreadPct.toFixed(3)) : 0;

    fcCache = {
      rows,
      structure,
      spotPrice: parseFloat(spotPrice.toFixed(2)),
      annCarry,
      carryRate: parseFloat((carryRate * 100).toFixed(3)),
      riskFreeRate: parseFloat((riskFreeRate * 100).toFixed(3)),
      updatedAt: now,
    };
    fcCacheAt = now;
    res.json(fcCache);
  } catch (err) {
    logger.error({ err }, "futures-curve error");
    res.status(500).json({ error: "Failed to fetch futures curve" });
  }
});

// ─── Volume Profile ───────────────────────────────────────────────────────────
let vpCache: any = null;
let vpCacheAt = 0;
const VP_TTL = 5 * 60 * 1000; // 5 min

router.get("/xauusd/volume-profile", async (req, res) => {
  const now = Date.now();
  if (vpCache && now - vpCacheAt < VP_TTL) { res.json(vpCache); return; }
  try {
    // 1h candles for last 5 days — enough bars for a meaningful profile
    let candles: { time: number; open: number; high: number; low: number; close: number; volume: number }[];
    const data = await yfChart("GC=F", "1h", "5d");
    candles = candlesFromChart(data);
    if (candles.length < 10) { res.status(503).json({ error: "Not enough data" }); return; }

    // Dynamic bucket size: ~30 buckets across the range
    const highs  = candles.map(c => c.high);
    const lows   = candles.map(c => c.low);
    const rangeHi = Math.max(...highs);
    const rangeLo = Math.min(...lows);
    const rawStep = (rangeHi - rangeLo) / 30;
    // Round step to nearest $5
    const step = Math.max(5, Math.round(rawStep / 5) * 5);

    // Accumulate volume into price buckets using candle midpoint
    const buckets = new Map<number, number>();
    for (const c of candles) {
      const mid   = (c.high + c.low) / 2;
      const key   = Math.floor(mid / step) * step;
      buckets.set(key, (buckets.get(key) ?? 0) + (c.volume || 1));
    }

    // Sort by price level ascending
    const levels = Array.from(buckets.entries())
      .map(([price, vol]) => ({ price, vol }))
      .sort((a, b) => a.price - b.price);

    const totalVol = levels.reduce((s, l) => s + l.vol, 0) || 1;
    const maxVol   = Math.max(...levels.map(l => l.vol));

    // POC = Point of Control (highest volume level)
    const poc = levels.reduce((a, b) => (b.vol > a.vol ? b : a));

    // Value Area = 70% of total volume around the POC
    const sorted = [...levels].sort((a, b) => b.vol - a.vol);
    let vaVol = 0;
    const vaSet = new Set<number>();
    for (const l of sorted) {
      vaVol += l.vol;
      vaSet.add(l.price);
      if (vaVol / totalVol >= 0.7) break;
    }
    const vaLevels = levels.filter(l => vaSet.has(l.price));
    const vah = vaLevels.length ? Math.max(...vaLevels.map(l => l.price)) + step : poc.price + step;
    const val = vaLevels.length ? Math.min(...vaLevels.map(l => l.price)) : poc.price - step;

    // Current price
    const lastCandle = candles[candles.length - 1];
    const currentPrice = lastCandle?.close ?? 0;

    // Build rows for frontend — include bar width (0–100) for easy rendering
    const rows = levels.map(l => ({
      price:    l.price,
      priceTo:  l.price + step,
      vol:      l.vol,
      volPct:   parseFloat(((l.vol / totalVol) * 100).toFixed(1)),
      barWidth: parseFloat(((l.vol / maxVol) * 100).toFixed(1)),
      isPoc:    l.price === poc.price,
      isVah:    l.price + step >= vah && l.price < vah,
      isVal:    l.price <= val && l.price + step > val,
      inVa:     l.price >= val && l.price + step <= vah + step,
    }));

    vpCache = {
      rows,
      poc:           poc.price,
      pocTo:         poc.price + step,
      vah,
      val,
      step,
      currentPrice,
      rangeHi:       parseFloat(rangeHi.toFixed(2)),
      rangeLo:       parseFloat(rangeLo.toFixed(2)),
      totalCandles:  candles.length,
      updatedAt:     now,
    };
    vpCacheAt = now;
    res.json(vpCache);
  } catch (err) {
    logger.error({ err }, "volume-profile error");
    res.status(500).json({ error: "Failed to compute volume profile" });
  }
});

export default router;



