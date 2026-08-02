import { Router, type Request, type Response } from "express";
import { logger } from "../lib/logger";
import { liveGoldFeed, isGoldMarketOpen, type LiveGoldTick } from "../lib/liveGoldFeed";

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
      marketOpen: isGoldMarketOpen(),
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
    res.write(`data: ${JSON.stringify({ ...cached, marketOpen: isGoldMarketOpen() })}\n\n`);
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

// ─── News cache (5 min TTL — avoids hammering NewsAPI + free-tier rate limits) ──
let newsCache: any = null;
let newsCacheAt = 0;
const NEWS_TTL = 5 * 60 * 1000;

// NewsAPI.org "everything" endpoint — free/dev tier is enough for a 5-min-cached feed.
const NEWS_API_URL = "https://newsapi.org/v2/everything";
const NEWS_QUERY =
  '(gold OR XAU/USD OR XAUUSD OR "precious metals") AND (Fed OR "Federal Reserve" OR dollar OR USD)';

// The API query above matches if ANY of the OR'd terms appear anywhere in an
// article's title/description/body, which lets clearly off-topic pieces
// through (e.g. an earnings-call recap that just happens to mention "gains",
// or a general markets roundup that says "dollar"). Require the headline
// itself to actually reference gold/XAU as a second, stricter check.
const GOLD_TITLE_RE = /\b(gold|xau\/?usd|bullion|precious\s*metals?)\b/i;

async function fetchLiveGoldNews(): Promise<any[]> {
  const apiKey = process.env["NEWS_API_KEY"];
  if (!apiKey) {
    throw new Error("NEWS_API_KEY not set");
  }

  const url =
    `${NEWS_API_URL}?q=${encodeURIComponent(NEWS_QUERY)}` +
    `&language=en&sortBy=publishedAt&pageSize=30&apiKey=${apiKey}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  let data: any;
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`NewsAPI error: ${res.status}`);
    data = await res.json();
  } finally {
    clearTimeout(timer);
  }

  const articles: any[] = Array.isArray(data?.articles) ? data.articles : [];

  const seen = new Set<string>();
  const items: any[] = [];
  const itemsUnfiltered: any[] = [];
  for (const a of articles) {
    const title: string = a?.title ?? "";
    const url_: string = a?.url ?? "";
    if (!title || !url_) continue;

    const dedupeKey = (title || url_).trim().toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const item = {
      id: url_ || `${title}-${a?.publishedAt ?? ""}`,
      title,
      source: a?.source?.name ?? "News",
      url: url_,
      publishedAt: a?.publishedAt
        ? new Date(a.publishedAt).toISOString()
        : new Date().toISOString(),
    };
    itemsUnfiltered.push(item);
    if (GOLD_TITLE_RE.test(title)) items.push(item);
  }

  // If the stricter headline filter leaves too few articles (e.g. a quiet
  // news day), fall back to the unfiltered set rather than showing an
  // almost-empty feed.
  const result = items.length >= 3 ? items : itemsUnfiltered;

  result.sort(
    (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
  );

  return result.slice(0, 10);
}

// GET /api/xauusd/news
router.get("/xauusd/news", async (_req, res) => {
  const now = Date.now();
  if (newsCache && now - newsCacheAt < NEWS_TTL) {
    res.json(newsCache);
    return;
  }

  try {
    const items = await fetchLiveGoldNews();
    if (items.length === 0) throw new Error("Live news feed returned 0 items");
    newsCache = items;
    newsCacheAt = now;
    res.json(newsCache);
  } catch (err) {
    logger.warn({ err }, "xauusd/news: live feed unavailable, no cached data to serve");
    if (newsCache) {
      res.json(newsCache);
      return;
    }
    // No live data and nothing cached — return empty rather than fabricated headlines.
    res.json([]);
  }
});


// ─── Calendar cache (1 hr TTL — calendar data doesn't change often intraday) ──
let calendarCache: any = null;
let calendarCacheAt = 0;
const CALENDAR_TTL = 60 * 60 * 1000;

// Only these USD event types matter for a gold terminal — everything else
// (regional PMIs, other-currency prints, low-impact housing data, etc.)
// gets filtered out even if the upstream feed marks it medium/high.
const GOLD_RELEVANT_KEYWORDS = [
  "fed", "fomc", "powell", "rate decision", "interest rate",
  "cpi", "inflation", "pce", "ppi",
  "non-farm", "nonfarm", "payroll", "unemployment", "jobless", "employment",
  "gdp", "retail sales", "consumer confidence", "ism manufacturing", "ism services",
];

// The upstream feed doesn't provide a gold-specific explanation, so we keep
// a manual lookup by event type — same list of event families as before,
// just applied to whatever the live feed's title matches.
function goldImpactFor(title: string): string {
  const t = title.toLowerCase();
  if (t.includes("powell") || t.includes("fed chair") || t.includes("fed speak"))
    return "Extremely high impact. Any hint of rate cuts is typically bullish for XAU/USD.";
  if (t.includes("fomc") || t.includes("interest rate") || t.includes("rate decision"))
    return "The highest-impact event for gold. A surprise cut is strongly bullish for XAU/USD.";
  if (t.includes("core pce") || t.includes("pce price"))
    return "The most reliably bullish gold catalyst among inflation data when cooler than expected.";
  if (t.includes("cpi"))
    return "Higher-than-expected CPI → gold falls. Lower-than-expected CPI → gold rallies.";
  if (t.includes("ppi"))
    return "Producer-side inflation gauge — feeds into Fed inflation expectations; hotter prints pressure gold.";
  if (t.includes("non-farm") || t.includes("nonfarm") || t.includes("payroll"))
    return "Strong NFP → USD rallies → gold sells off. Weak NFP → gold rallies.";
  if (t.includes("unemployment") || t.includes("jobless"))
    return "Rising unemployment raises Fed-cut odds, typically bullish for gold; a tight labor market is bearish.";
  if (t.includes("gdp"))
    return "Strong growth supports a hawkish Fed (bearish gold); weak growth raises cut odds (bullish gold).";
  if (t.includes("retail sales"))
    return "Strong consumer spending supports a hawkish Fed stance, a headwind for non-yielding gold.";
  if (t.includes("consumer confidence") || t.includes("consumer sentiment"))
    return "Weak sentiment raises recession/cut odds — usually modestly bullish for gold.";
  if (t.includes("ism") || t.includes("pmi"))
    return "Weak manufacturing/services data raises Fed-cut odds, generally supportive for gold.";
  return "USD-denominated macro release — surprises versus forecast move the dollar and, inversely, gold.";
}

// Convert a US-Eastern wall-clock date+time ("2026-07-30", "08:30") into a
// correct UTC ISO string, accounting for EST/EDT (DST) automatically. Uses
// only built-in Intl — no extra deps, no network call.
function etWallTimeToUtcIso(dateStr: string, timeStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const [hh, mm] = timeStr.split(":").map(Number);
  const guessUtc = Date.UTC(y, m - 1, d, hh, mm);

  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(new Date(guessUtc)).map((p) => [p.type, p.value]),
  );
  const readAsEt = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    parts.hour === "24" ? 0 : Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  const offset = guessUtc - readAsEt;
  return new Date(guessUtc + offset).toISOString();
}

// FRED (Federal Reserve Economic Data, St. Louis Fed) — 100% free, no paid
// tier, unlimited requests. https://fred.stlouisfed.org/docs/api/api_key.html
// (Switched back from FMP: FMP's economic-calendar endpoint returns 402
// Payment Required on the free plan — premium-only, not usable here.)
// FRED doesn't publish consensus "forecast" figures, so forecast is left
// null rather than fabricated (real data-source limitation, not a bug).
// "actual"/"previous" ARE available from FRED's vintage (realtime)
// observation history and are populated below instead of always blank.
//
// releaseTimeEt = official U.S. Eastern-time release hour for that report
// (FOMC statement/rate decision drops at 14:00 ET, not 08:30 ET).
const FRED_RELEASES: Array<{
  id: number;
  title: string;
  series: string;
  impact: "low" | "medium" | "high";
  releaseTimeEt: string;
  /** FRED "units" transform — turns raw levels into the %/change figures
   * traders actually expect (ForexFactory-style), instead of a raw index
   * or dollar level that's meaningless at a glance. */
  units: "lin" | "chg" | "pch" | "pc1";
  /** How to format the transformed value for display, e.g. "1.5%" or "197K". */
  format: "percent" | "thousands" | "rate";
}> = [
  { id: 10, title: "Consumer Price Index (CPI) m/m", series: "CPIAUCSL", impact: "high", releaseTimeEt: "08:30", units: "pch", format: "percent" },
  { id: 50, title: "Non-Farm Payrolls (change)", series: "PAYEMS", impact: "high", releaseTimeEt: "08:30", units: "chg", format: "thousands" },
  { id: 53, title: "GDP (annualized q/q)", series: "A191RL1Q225SBEA", impact: "high", releaseTimeEt: "08:30", units: "lin", format: "percent" },
  { id: 101, title: "FOMC Press Release / Rate Decision", series: "FEDFUNDS", impact: "high", releaseTimeEt: "14:00", units: "lin", format: "rate" },
  { id: 46, title: "Producer Price Index (PPI) m/m", series: "PPIACO", impact: "medium", releaseTimeEt: "08:30", units: "pch", format: "percent" },
  { id: 9, title: "Retail Sales m/m", series: "RSAFS", impact: "medium", releaseTimeEt: "08:30", units: "pch", format: "percent" },
];

/** Format a raw FRED numeric string per the release's display convention. */
function formatFredValue(raw: string, format: "percent" | "thousands" | "rate"): string {
  const n = parseFloat(raw);
  if (isNaN(n)) return raw;
  if (format === "percent" || format === "rate") return `${n.toFixed(1)}%`;
  if (format === "thousands") return `${Math.round(n)}K`;
  return raw;
}

// FRED's release_id 101 ("FOMC Press Release") is NOT limited to the 8
// actual rate-decision days a year — it fires for minutes, speeches, and
// other FOMC-tagged communications almost daily, which was causing the
// same "FOMC Press Release / Rate Decision" event (with an identical,
// unchanged FEDFUNDS rate) to show up on nearly every calendar day.
// The real decision dates are published by the Fed well in advance, so
// they're hardcoded here instead (statement day = 2nd day of each
// two-day meeting, 2:00pm ET). Source: federalreserve.gov press releases
// announcing the 2025/2026/2027 tentative meeting schedules.
const FOMC_STATEMENT_DATES = [
  // 2025
  "2025-01-29", "2025-03-19", "2025-05-07", "2025-06-18",
  "2025-07-30", "2025-09-17", "2025-10-29", "2025-12-10",
  // 2026
  "2026-01-28", "2026-03-18", "2026-04-29", "2026-06-17",
  "2026-07-29", "2026-09-16", "2026-10-28", "2026-12-09",
  // 2027 (tentative)
  "2027-01-27", "2027-03-17", "2027-04-28", "2027-06-09",
  "2027-07-28", "2027-09-15", "2027-10-27", "2027-12-08",
];

async function fredGet(apiKey: string, path: string, params: Record<string, string | number>): Promise<any> {
  const url = new URL(`https://api.stlouisfed.org/fred/${path}`);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("file_type", "json");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url.toString(), { signal: controller.signal });
    if (!res.ok) throw new Error(`FRED error: ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchFredCalendar(): Promise<any[]> {
  const apiKey = process.env["FRED_API_KEY"];
  if (!apiKey) {
    throw new Error("FRED_API_KEY not set");
  }

  const today = new Date();
  const from = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];
  const until = new Date(today.getTime() + 14 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];

  const events: any[] = [];
  const todayStr = today.toISOString().split("T")[0];

  for (const rel of FRED_RELEASES) {
    try {
      // FOMC: use the hardcoded real decision-day list instead of FRED's
      // noisy release/dates feed (see FOMC_STATEMENT_DATES comment above).
      const dates: Array<{ date: string }> =
        rel.id === 101
          ? FOMC_STATEMENT_DATES.filter((d) => d >= from && d <= until).map((d) => ({ date: d }))
          : ((await fredGet(apiKey, "release/dates", {
              release_id: rel.id,
              realtime_start: from,
              realtime_end: until,
              include_release_dates_with_no_data: "false",
            }))?.release_dates ?? [])
              .filter((d: any) => d?.date >= from && d?.date <= until)
              .sort((a: any, b: any) => a.date.localeCompare(b.date));
      if (dates.length === 0) continue;

      // For each release date that's already happened, ask FRED what the
      // series looked like "as known on that date" (a vintage/realtime
      // lookup), pulling the 2 most recent observations at once: [0] is
      // the actual just-released print, [1] is the prior period's value
      // (i.e. "previous"). Pulling both directly — instead of chaining
      // actuals across release dates within the narrow ±30/14-day window —
      // means "previous" is correct even when only one release date for
      // a monthly/quarterly series falls inside that window.
      for (const d of dates) {
        let actual: string | null = null;
        let previous: string | null = null;
        if (d.date <= todayStr) {
          try {
            const obs = await fredGet(apiKey, "series/observations", {
              series_id: rel.series,
              units: rel.units,
              realtime_start: d.date,
              realtime_end: d.date,
              sort_order: "desc",
              limit: 2,
            });
            const observations = obs?.observations ?? [];
            const actualVal = observations[0]?.value;
            const prevVal = observations[1]?.value;
            if (actualVal && actualVal !== ".") actual = formatFredValue(actualVal, rel.format);
            if (prevVal && prevVal !== ".") previous = formatFredValue(prevVal, rel.format);
          } catch {
            // vintage lookup is best-effort; leave actual/previous null on failure
          }
        }

        events.push({
          id: `fred-${rel.id}-${d.date}`,
          title: rel.title,
          country: "USD",
          date: d.date,
          time: rel.releaseTimeEt,
          datetimeUtc: etWallTimeToUtcIso(d.date, rel.releaseTimeEt),
          impact: rel.impact,
          forecast: null,
          previous,
          actual,
          description: `${rel.title} release, scheduled via the FRED (St. Louis Fed) release calendar.`,
          goldImpact: goldImpactFor(rel.title),
        });
      }
    } catch (err) {
      logger.warn({ err, release: rel.id }, "FRED release/dates fetch failed for one release");
    }
  }

  events.sort((a, b) => a.datetimeUtc.localeCompare(b.datetimeUtc));
  return events;
}

// GET /api/xauusd/calendar
router.get("/xauusd/calendar", async (_req, res) => {
  const now = Date.now();
  if (calendarCache && now - calendarCacheAt < CALENDAR_TTL) {
    res.json(calendarCache);
    return;
  }

  try {
    const events = await fetchFredCalendar();
    if (events.length === 0) throw new Error("FRED calendar returned 0 relevant events");
    calendarCache = events;
    calendarCacheAt = now;
    res.json(calendarCache);
  } catch (err) {
    logger.warn({ err }, "xauusd/calendar: FRED feed unavailable, no cached data to serve");
    if (calendarCache) {
      res.json(calendarCache);
      return;
    }
    // No live data and nothing cached — return empty rather than fabricated events.
    res.json([]);
  }
});

// ─── Dynamic Key Drivers ──────────────────────────────────────────────────────
// Ranks the standard driver list by which factor moved the most over the last
// month, so the strongest current driver surfaces first instead of a fixed order.
let keyDriversCache: string[] | null = null;
let keyDriversCacheAt = 0;
const KEY_DRIVERS_TTL = 15 * 60 * 1000; // 15 min

const STATIC_KEY_DRIVERS = [
  "Federal Reserve rate expectations",
  "US Dollar strength (DXY)",
  "Geopolitical risk premium",
  "Central bank gold reserves",
];

async function computeKeyDrivers(): Promise<string[]> {
  const now = Date.now();
  if (keyDriversCache && now - keyDriversCacheAt < KEY_DRIVERS_TTL) return keyDriversCache;

  const proxies: { label: string; symbol: string }[] = [
    { label: "Federal Reserve rate expectations", symbol: "^IRX" },     // 13-wk T-bill, proxy for rate path
    { label: "US Dollar strength (DXY)",           symbol: "DX-Y.NYB" },
    { label: "Geopolitical risk premium",           symbol: "^VIX" },
  ];

  const settled = await Promise.allSettled(proxies.map(p => yfChart(p.symbol, "1d", "1mo")));
  const scored = proxies.map((p, i) => {
    const r = settled[i];
    if (r.status !== "fulfilled") return { label: p.label, score: 0 };
    const closes = closesFromChart(r.value).filter((c: number) => c != null);
    if (closes.length < 2) return { label: p.label, score: 0 };
    const first = closes[0];
    const last  = closes[closes.length - 1];
    const pctMove = first ? Math.abs((last - first) / first) * 100 : 0;
    return { label: p.label, score: pctMove };
  });

  scored.sort((a, b) => b.score - a.score);
  const ranked = [...scored.map(s => s.label), "Central bank gold reserves"];

  // Only trust the dynamic order if we actually got at least one live signal
  const gotLiveData = scored.some(s => s.score > 0);
  keyDriversCache = gotLiveData ? ranked : STATIC_KEY_DRIVERS;
  keyDriversCacheAt = now;
  return keyDriversCache;
}

// GET /api/xauusd/summary
router.get("/xauusd/summary", async (req, res) => {
  try {
    const data = await yfChart("GC=F", "1d", "1y");
    const meta   = metaFromChart(data);
    const closes = closesFromChart(data);
    const price  = meta?.regularMarketPrice ?? 0;
    const last   = closes[closes.length - 1] ?? price;
    // meta.chartPreviousClose from this endpoint has been observed to reflect
    // a stale/start-of-range close rather than yesterday's close (it tracked
    // almost exactly with the 1Y change instead of a real 1-day move).
    // Derive "previous close" from the actual daily closes series instead —
    // same approach already used for 1W/1M/1Y below — so it's self-consistent.
    const prevFromCloses = closes.length >= 2 ? closes[closes.length - 2] : undefined;
    const prev   = prevFromCloses ?? meta?.chartPreviousClose ?? price;
    const change = price - prev;
    const changePct = prev ? (change / prev) * 100 : 0;
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
    let keyDrivers: string[];
    try {
      keyDrivers = await computeKeyDrivers();
    } catch {
      keyDrivers = STATIC_KEY_DRIVERS;
    }
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
      keyDrivers,
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

async function computeFearGreed(): Promise<{
  score: number; label: string; color: string;
  components: { rsi: number; momentum: number; volatility: number; pricePos: number };
  price: number;
} | null> {
  const data = await yfChart("GC=F", "1h", "5d");
  const candles = candlesFromChart(data);
  const closes = candles.map((c: any) => c.close);
  if (closes.length < 20) return null;

  const rsi = calcRsi(closes, 14);
  const momentum24 = closes.length >= 24
    ? ((closes[closes.length - 1] - closes[closes.length - 25]) / closes[closes.length - 25]) * 100
    : 0;
  const highs = candles.map((c: any) => c.high);
  const lows  = candles.map((c: any) => c.low);
  const trs   = candles.slice(1).map((_c: any, i: number) => Math.max(
    highs[i + 1] - lows[i + 1],
    Math.abs(highs[i + 1] - closes[i]),
    Math.abs(lows[i + 1]  - closes[i])
  ));
  const atr14 = trs.slice(-14).reduce((a: number, b: number) => a + b, 0) / 14;
  const atrPct = closes[closes.length - 1] > 0 ? (atr14 / closes[closes.length - 1]) * 100 : 0.3;
  const volScore = Math.max(0, Math.min(100, 100 - (atrPct / 1.0) * 100));

  const maxClose = Math.max(...closes.slice(-20 * 24));
  const minClose = Math.min(...closes.slice(-20 * 24));
  const range = maxClose - minClose || 1;
  const pricePos = ((closes[closes.length - 1] - minClose) / range) * 100;

  const score = Math.round(
    rsi           * 0.30 +
    (momentum24 > 0 ? Math.min(100, 50 + momentum24 * 10) : Math.max(0, 50 + momentum24 * 10)) * 0.25 +
    volScore      * 0.20 +
    pricePos      * 0.25
  );
  const clamped = Math.max(0, Math.min(100, score));

  let label: string, color: string;
  if (clamped <= 20)       { label = "Extreme Fear"; color = "#ef5350"; }
  else if (clamped <= 40)  { label = "Fear";         color = "#f57c00"; }
  else if (clamped <= 60)  { label = "Neutral";      color = "#f0b90b"; }
  else if (clamped <= 80)  { label = "Greed";        color = "#26a69a"; }
  else                     { label = "Extreme Greed"; color = "#00e676"; }

  return {
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
  };
}

router.get("/xauusd/fear-greed", async (_req, res) => {
  const now = Date.now();
  if (fgCache && now - fgCacheAt < 5 * 60_000) { res.json(fgCache); return; }
  try {
    const result = await computeFearGreed();
    if (!result) { res.status(503).json({ error: "Insufficient data" }); return; }
    fgCache = { ...result, timestamp: now };
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

// Free, no-key IMF SDMX API (International Financial Statistics dataset).
// Indicator RAFAGOLDV_OZT = "Reserve Assets, Gold, National Valuation, Troy Ounces".
// We only fetch for countries with an unambiguous ISO2 code; entities like the
// ECB / Euro Area aggregate stay on the hardcoded WGC figures below.
const IMF_COUNTRY_CODE: Record<string, string> = {
  USA: "US", Germany: "DE", Italy: "IT", France: "FR", Russia: "RU",
  China: "CN", Switzerland: "CH", India: "IN", Japan: "JP", Netherlands: "NL",
  Turkey: "TR", Taiwan: "TW", Poland: "PL", Uzbekistan: "UZ", Portugal: "PT",
  "Saudi Arabia": "SA", UK: "GB", Kazakhstan: "KZ", Austria: "AT",
};
const IMF_SDMX_BASE = "http://dataservices.imf.org/REST/SDMX_JSON.svc/CompactData/IFS";
const IMF_TIMEOUT_MS = 8_000;
const OZ_TO_TONNES = 31.1034768 / 1_000_000; // troy oz -> metric tonnes

async function fetchImfGoldTonnes(isoCode: string): Promise<number | null> {
  const url = `${IMF_SDMX_BASE}/A.${isoCode}.RAFAGOLDV_OZT`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IMF_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
    clearTimeout(timer);
    if (!res.ok) return null;
    const json: any = await res.json();
    const series = json?.CompactData?.DataSet?.Series;
    if (!series) return null;
    const obs = Array.isArray(series.Obs) ? series.Obs : series.Obs ? [series.Obs] : [];
    if (!obs.length) return null;
    const lastObs = obs[obs.length - 1];
    const ozValue = parseFloat(lastObs?.["@OBS_VALUE"]);
    if (!ozValue || ozValue <= 0) return null;
    return ozValue * OZ_TO_TONNES;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

let cbhCache: any = null;
let cbhCacheAt = 0;
const CBH_TTL = 12 * 60 * 60 * 1000; // 12h — reserve data moves quarterly at most

router.get("/xauusd/central-bank-holdings", async (_req, res) => {
  const now = Date.now();
  if (cbhCache && now - cbhCacheAt < CBH_TTL) { res.json(cbhCache); return; }

  try {
    const entries = Object.entries(IMF_COUNTRY_CODE);
    const settled = await Promise.allSettled(entries.map(([, code]) => fetchImfGoldTonnes(code)));
    const liveByCountry = new Map<string, number>();
    entries.forEach(([country], i) => {
      const r = settled[i];
      if (r.status !== "fulfilled" || r.value == null) return;
      const fallback = WGC_2026.find(w => w.country === country)?.tonnes;
      // Sanity guard: IMF unit/parsing issues would produce wildly wrong tonnage.
      // Only trust live value if within 2.5x of the known fallback figure.
      if (fallback && (r.value < fallback / 2.5 || r.value > fallback * 2.5)) return;
      liveByCountry.set(country, r.value);
    });

    const holdings = [...WGC_2026]
      .map(h => ({
        country: h.country,
        tonnes: parseFloat((liveByCountry.get(h.country) ?? h.tonnes).toFixed(1)),
        year: 2026,
        source: liveByCountry.has(h.country) ? "imf-live" : "wgc-fallback",
      }))
      .sort((a, b) => b.tonnes - a.tonnes)
      .slice(0, 15);

    cbhCache = { holdings, dataYear: 2026, updatedAt: now };
    cbhCacheAt = now;
    res.json(cbhCache);
  } catch (err) {
    logger.error({ err }, "central-bank-holdings error");
    // Serve stale cache or pure hardcoded fallback rather than fail the widget
    if (cbhCache) { res.json(cbhCache); return; }
    const holdings = [...WGC_2026].sort((a, b) => b.tonnes - a.tonnes).slice(0, 15).map(h => ({
      ...h, year: 2026, source: "wgc-fallback",
    }));
    res.json({ holdings, dataYear: 2026, updatedAt: now });
  }
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
    const nearbySymbols = ["GCZ26.CMX", "GCM27.CMX", "GCZ27.CMX"];
    const nearbyPrices  = await Promise.allSettled(nearbySymbols.map(s => yfQuote(s)));
    const actualMap = new Map<string, number>();
    nearbySymbols.forEach((s, i) => {
      const r = nearbyPrices[i];
      if (r.status === "fulfilled" && r.value && r.value > 0) actualMap.set(s, r.value);
    });

    // Futures month codes: F=Jan G=Feb H=Mar J=Apr K=May M=Jun N=Jul Q=Aug U=Sep V=Oct X=Nov Z=Dec
    const MONTH_CODE: Record<string, number> = {
      F: 0, G: 1, H: 2, J: 3, K: 4, M: 5, N: 6, Q: 7, U: 8, V: 9, X: 10, Z: 11,
    };
    // Parse "GCZ26.CMX" -> code Z, year 26 -> Dec 2026 -> months-out from today
    function monthsOutFromSymbol(sym: string): number | null {
      const m = sym.match(/^GC([FGHJKMNQUVXZ])(\d{2})\./);
      if (!m) return null;
      const monthIdx = MONTH_CODE[m[1]];
      const year = 2000 + parseInt(m[2], 10);
      const expiry = new Date(year, monthIdx, 1);
      return (expiry.getFullYear() - today.getFullYear()) * 12 + (expiry.getMonth() - today.getMonth());
    }
    // Map each actual quote to the closest theoretical contract bucket (within 2 months)
    const actualBySlot = new Map<number, number>(); // expiryMonths (of `contracts`) -> actual price
    nearbySymbols.forEach(sym => {
      const price = actualMap.get(sym);
      if (!price) return;
      const monthsOut = monthsOutFromSymbol(sym);
      if (monthsOut == null) return;
      let best: { expiryMonths: number; diff: number } | null = null;
      for (const c of contracts) {
        if (c.expiryMonths === 0) continue; // spot handled separately
        const diff = Math.abs(c.expiryMonths - monthsOut);
        if (!best || diff < best.diff) best = { expiryMonths: c.expiryMonths, diff };
      }
      if (best && best.diff <= 2 && !actualBySlot.has(best.expiryMonths)) {
        actualBySlot.set(best.expiryMonths, price);
      }
    });

    // Build rows using cost-of-carry model (F = S * e^(r*T))
    // Blend with actual live contract prices where available (avg of theoretical + actual)
    const rows = contracts.map(c => {
      const T       = c.expiryMonths / 12;
      const theoFwd = spotPrice * Math.exp(carryRate * T);
      const actual  = actualBySlot.get(c.expiryMonths);
      const blended = actual != null;
      const fwd     = parseFloat((blended ? (theoFwd + actual!) / 2 : theoFwd).toFixed(2));
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
        theoretical: !blended,
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

// ─── Market Tape (top scrolling ticker) ───────────────────────────────────────
// Aggregates several real data sources into one payload for the Bloomberg-
// style tape at the top of the terminal: DXY, 10Y Treasury yield, CFTC COT
// net-long positioning, the gold-specific Fear/Greed score, the currently
// active trading session, the effective Fed Funds rate, and ATR(14).
let tapeCache: any = null;
let tapeCacheAt = 0;
const TAPE_TTL = 5 * 60 * 1000; // 5 min — COT/Fed data barely move intraday

// CFTC Socrata Open Data API — Legacy Futures Only Combined Report.
// No API key required. Updated weekly (Fridays, for the prior Tuesday).
const CFTC_COT_URL =
  "https://publicreporting.cftc.gov/resource/6dca-aqww.json" +
  "?$where=" + encodeURIComponent("market_and_exchange_names='GOLD - COMMODITY EXCHANGE INC.'") +
  "&$order=report_date_as_yyyy_mm_dd DESC&$limit=1";

async function fetchCotNetLongs(): Promise<{ netLongs: number; asOf: string } | null> {
  try {
    const res = await fetch(CFTC_COT_URL, { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const rows = await res.json();
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row) return null;
    const long  = parseFloat(row.noncomm_positions_long_all);
    const short = parseFloat(row.noncomm_positions_short_all);
    if (!Number.isFinite(long) || !Number.isFinite(short)) return null;
    return { netLongs: Math.round(long - short), asOf: row.report_date_as_yyyy_mm_dd };
  } catch (err) {
    logger.warn({ err }, "market-tape: CFTC COT fetch failed");
    return null;
  }
}

// ─── COT Positioning History (6 months, weekly) ───────────────────────────────
// Same CFTC Socrata source as the single-snapshot fetch above, but pulling the
// last ~26 weekly reports so the frontend can chart how large speculators'
// net-long positioning has trended, not just the latest number.
let cotHistoryCache: any = null;
let cotHistoryCacheAt = 0;
const COT_HISTORY_TTL = 6 * 60 * 60 * 1000; // 6h — CFTC only publishes weekly anyway

const CFTC_COT_HISTORY_URL =
  "https://publicreporting.cftc.gov/resource/6dca-aqww.json" +
  "?$where=" + encodeURIComponent("market_and_exchange_names='GOLD - COMMODITY EXCHANGE INC.'") +
  "&$order=report_date_as_yyyy_mm_dd DESC&$limit=26";

router.get("/xauusd/cot-history", async (_req, res) => {
  const now = Date.now();
  if (cotHistoryCache && now - cotHistoryCacheAt < COT_HISTORY_TTL) { res.json(cotHistoryCache); return; }
  try {
    const cftcRes = await fetch(CFTC_COT_HISTORY_URL, { headers: { Accept: "application/json" } });
    if (!cftcRes.ok) { res.status(502).json({ error: "CFTC data unavailable" }); return; }
    const rows: any[] = await cftcRes.json();

    const points = rows
      .map(row => {
        const long  = parseFloat(row.noncomm_positions_long_all);
        const short = parseFloat(row.noncomm_positions_short_all);
        if (!Number.isFinite(long) || !Number.isFinite(short)) return null;
        return {
          date: row.report_date_as_yyyy_mm_dd,
          netLongs: Math.round(long - short),
          longs: Math.round(long),
          shorts: Math.round(short),
        };
      })
      .filter((p): p is { date: string; netLongs: number; longs: number; shorts: number } => p !== null)
      .reverse(); // oldest → newest for charting left-to-right

    if (points.length === 0) { res.status(502).json({ error: "No COT data returned" }); return; }

    cotHistoryCache = { points, updatedAt: now };
    cotHistoryCacheAt = now;
    res.json(cotHistoryCache);
  } catch (err) {
    logger.error({ err }, "cot-history error");
    res.status(500).json({ error: "Failed to fetch COT history" });
  }
});

async function fetchFedFundsRate(): Promise<number | null> {
  try {
    const res = await fetch("https://fred.stlouisfed.org/graph/fredgraph.csv?id=FEDFUNDS", {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (!res.ok) return null;
    const csv = await res.text();
    const lines = csv.trim().split("\n").slice(1);
    for (let i = lines.length - 1; i >= 0; i--) {
      const [, val] = lines[i].trim().split(",");
      if (val && val !== ".") return parseFloat(val);
    }
    return null;
  } catch (err) {
    logger.warn({ err }, "market-tape: FRED Fed Funds fetch failed");
    return null;
  }
}

function activeSessionLabel(): string {
  const now = new Date();
  const utcMin = now.getUTCHours() * 60 + now.getUTCMinutes();
  const sessions = [
    { name: "Sydney",   open: 21 * 60, close: 6 * 60 },
    { name: "Tokyo",    open: 23 * 60, close: 8 * 60 },
    { name: "London",   open: 7 * 60,  close: 16 * 60 },
    { name: "New York", open: 12 * 60, close: 21 * 60 },
  ];
  const active = sessions.filter(s =>
    s.open > s.close ? (utcMin >= s.open || utcMin < s.close) : (utcMin >= s.open && utcMin < s.close)
  );
  if (active.length === 0) return "MARKET CLOSED";
  // If multiple sessions overlap, prefer the busier one (London > New York > Tokyo > Sydney)
  const priority = ["London", "New York", "Tokyo", "Sydney"];
  const chosen = active.sort((a, b) => priority.indexOf(a.name) - priority.indexOf(b.name))[0];
  return `${chosen.name.toUpperCase()} OPEN`;
}

router.get("/xauusd/market-tape", async (_req, res) => {
  const now = Date.now();
  if (tapeCache && now - tapeCacheAt < TAPE_TTL) { res.json(tapeCache); return; }

  const [dxyResult, yieldResult, cotResult, fedResult, volResult, fgResult] = await Promise.allSettled([
    yfChart("DX-Y.NYB", "1d", "5d"),
    yfChart("^TNX", "1d", "5d"),
    fetchCotNetLongs(),
    fetchFedFundsRate(),
    yfChart("GC=F", "1h", "5d"),
    computeFearGreed(),
  ]);

  const dxyMeta = dxyResult.status === "fulfilled" ? metaFromChart(dxyResult.value) : null;
  const dxyCloses = dxyResult.status === "fulfilled" ? closesFromChart(dxyResult.value) : [];
  const dxyPrice = dxyMeta?.regularMarketPrice ?? dxyCloses[dxyCloses.length - 1] ?? null;
  const dxyPrev  = dxyCloses.length >= 2 ? dxyCloses[dxyCloses.length - 2] : (dxyMeta?.chartPreviousClose ?? null);
  const dxyChangePct = dxyPrice != null && dxyPrev ? ((dxyPrice - dxyPrev) / dxyPrev) * 100 : null;

  const yMeta = yieldResult.status === "fulfilled" ? metaFromChart(yieldResult.value) : null;
  const yCloses = yieldResult.status === "fulfilled" ? closesFromChart(yieldResult.value) : [];
  const yPrice = yMeta?.regularMarketPrice ?? yCloses[yCloses.length - 1] ?? null;
  const yPrev  = yCloses.length >= 2 ? yCloses[yCloses.length - 2] : (yMeta?.chartPreviousClose ?? null);
  const yChange = yPrice != null && yPrev != null ? yPrice - yPrev : null;

  const cot = cotResult.status === "fulfilled" ? cotResult.value : null;
  const fedFunds = fedResult.status === "fulfilled" ? fedResult.value : null;
  const fearGreed = fgResult.status === "fulfilled" ? fgResult.value : null;

  // ATR(14) computed the same way as the Volatility panel, from 1h candles.
  let atr14: number | null = null;
  if (volResult.status === "fulfilled") {
    const candles = candlesFromChart(volResult.value);
    if (candles.length > 15) atr14 = computeAtr(candles, 14);
  }

  tapeCache = {
    dxy:      dxyPrice != null ? { price: parseFloat(dxyPrice.toFixed(2)), changePct: dxyChangePct != null ? parseFloat(dxyChangePct.toFixed(2)) : null } : null,
    yield10y: yPrice != null   ? { price: parseFloat(yPrice.toFixed(2)),  change: yChange != null ? parseFloat(yChange.toFixed(2)) : null } : null,
    cot,
    fedFunds: fedFunds != null ? parseFloat(fedFunds.toFixed(2)) : null,
    atr14:    atr14 != null ? parseFloat(atr14.toFixed(2)) : null,
    fearGreed: fearGreed ? { score: fearGreed.score, label: fearGreed.label } : null,
    session:  activeSessionLabel(),
    updatedAt: now,
  };
  tapeCacheAt = now;
  res.json(tapeCache);
});

export default router;



