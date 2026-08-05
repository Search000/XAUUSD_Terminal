import WebSocket from "ws";
import { EventEmitter } from "events";
import { logger } from "./logger";

// ── Shared, free, delay-free live price feed ────────────────────────────────
// One outbound connection to TradingView's public quote websocket, fanned out
// in-memory to every connected client via SSE (see routes/xauusd.ts
// GET /xauusd/live-price and GET /xauusd/live-metals). This scales to
// hundreds of concurrent viewers without hitting any external rate limit,
// since only ONE upstream connection is ever made no matter how many people
// are watching, and it now carries GOLD + SILVER + PLATINUM + PALLADIUM + DXY
// simultaneously instead of a separate 30s-polled Yahoo fetch per metal.
//
// NOTE: this is an unofficial/reverse-engineered endpoint (no official
// TradingView API key involved). It can break if TradingView changes their
// protocol — fallback symbols are tried per instrument, and the feed
// auto-reconnects with backoff. If a given instrument's symbols never
// resolve (feed silent for it), callers should keep falling back to the
// Yahoo-backed /xauusd/metals polling endpoint for that one.

const TV_WS_URL =
  "wss://data.tradingview.com/socket.io/websocket?from=chart%2F&date=1";

export type MetalSymbol = "XAU" | "XAG" | "XPT" | "XPD" | "DXY";

// Canonical instrument -> ordered list of TradingView tickers to try. All
// candidates for an instrument are subscribed at once; whichever responds
// first becomes that instrument's live source (same fallback pattern the
// gold-only feed already used).
const CANDIDATES: Record<MetalSymbol, string[]> = {
  XAU: ["OANDA:XAUUSD", "FX_IDC:XAUUSD", "FOREXCOM:XAUUSD"],
  XAG: ["OANDA:XAGUSD", "FX_IDC:XAGUSD", "FOREXCOM:XAGUSD"],
  XPT: ["OANDA:XPTUSD", "FOREXCOM:XPTUSD"],
  XPD: ["OANDA:XPDUSD", "FOREXCOM:XPDUSD"],
  DXY: ["TVC:DXY", "ICEUS:DX1!"],
};

// Reverse lookup: raw TradingView ticker string -> canonical instrument.
const SYMBOL_TO_CANONICAL: Record<string, MetalSymbol> = {};
for (const [canonical, tickers] of Object.entries(CANDIDATES) as [MetalSymbol, string[]][]) {
  for (const t of tickers) SYMBOL_TO_CANONICAL[t] = canonical;
}

const ALL_WS_SYMBOLS = Object.values(CANDIDATES).flat();

export interface LiveGoldTick {
  symbol: string;
  price: number;
  bid?: number;
  ask?: number;
  changePct?: number;
  timestamp: number;
  marketOpen?: boolean;
}

export interface LiveMetalTick extends LiveGoldTick {
  sym: MetalSymbol;
}

// XAU/USD (spot gold vs dollar) trades ~24/5 like forex: opens Sunday
// ~22:00 UTC (Sydney) and closes Friday ~21:00 UTC (NY close, 5pm ET).
// This is an approximation (ignores exact DST offset + holidays) but is
// good enough to freeze the UI instead of showing a fake-live price
// over the weekend. Silver/platinum/palladium/DXY follow essentially the
// same forex-style session, so the same window is reused for all of them.
export function isGoldMarketOpen(d: Date = new Date()): boolean {
  const day = d.getUTCDay(); // 0 = Sun, 6 = Sat
  const hour = d.getUTCHours();
  if (day === 6) return false;                 // all Saturday: closed
  if (day === 0 && hour < 22) return false;     // Sunday before ~22:00 UTC open
  if (day === 5 && hour >= 21) return false;    // Friday after ~21:00 UTC close
  return true;
}

export class LiveGoldFeed extends EventEmitter {
  private ws: WebSocket | null = null;
  private sessionId = "cs_" + Math.random().toString(36).slice(2, 15);
  private latest: Partial<Record<MetalSymbol, LiveMetalTick>> = {};
  // When each symbol's traded PRICE last actually changed value (not just
  // when a quote packet arrived — TradingView can keep sending bid/ask/spread
  // refreshes with the same last-traded price for a while, which would
  // otherwise keep resetting the staleness clock and never flip to closed).
  private lastPriceChangeAt: Partial<Record<MetalSymbol, number>> = {};
  private reconnectAttempts = 0;
  private heartbeat: NodeJS.Timeout | null = null;
  private started = false;

  start() {
    if (this.started) return; // idempotent — safe to call multiple times
    this.started = true;
    this.connect();
    this.startStatusBroadcast();
  }

  // Back-compat: gold's tick in the old single-instrument shape.
  getLatest(): LiveGoldTick | null {
    return this.latest.XAU ?? null;
  }

  getLatestFor(sym: MetalSymbol): LiveMetalTick | null {
    return this.latest[sym] ?? null;
  }

  getAllLatest(): Partial<Record<MetalSymbol, LiveMetalTick>> {
    return this.latest;
  }

  private statusTimer: NodeJS.Timeout | null = null;

  // COMEX gold pauses for a daily ~1h maintenance window (roughly
  // 21:00-22:00 UTC, Sun-Thu) on top of the full weekend close, and the
  // feed itself can occasionally hiccup — isGoldMarketOpen() alone only
  // knows about the weekly close, so during a daily halt it would keep
  // claiming "open" (and the UI would keep showing "LIVE") even though no
  // tick has arrived in minutes. 3 minutes of silence is long enough to
  // never false-flag a normal quiet stretch between real ticks, but far
  // shorter than an actual ~1h halt, so the badge flips to "MARKET CLOSED"
  // quickly and flips back the moment a fresh tick resumes.
  private static readonly STALE_MS = 2 * 60_000;

  // Same "calendar open AND price hasn't been frozen too long" check used by
  // the periodic broadcast below, exposed so a freshly-connecting SSE client
  // (which sends the cached tick immediately, before the next broadcast tick)
  // reports the same accurate open/closed state instead of falling back to
  // the raw weekly calendar.
  //
  // Freshness is measured from when the PRICE last actually moved, not from
  // when the last quote packet arrived — a quiet/frozen price for 2+ minutes
  // means closed even if the feed keeps sending unchanged-price packets.
  isEffectivelyOpen(tick: (Pick<LiveGoldTick, "timestamp"> & { sym?: MetalSymbol }) | null | undefined): boolean {
    if (!tick) return isGoldMarketOpen();
    const sym = tick.sym ?? "XAU";
    const since = this.lastPriceChangeAt[sym] ?? tick.timestamp;
    return isGoldMarketOpen() && Date.now() - since <= LiveGoldFeed.STALE_MS;
  }

  // Re-emits every instrument's last known price (unchanged) with a
  // refreshed marketOpen flag every 30s. Real ticks stop arriving over the
  // weekend, so without this, clients only learn the market re/closed on
  // their next reconnect — this keeps the "MARKET CLOSED" badge accurate in
  // near real-time while never mutating the frozen price itself.
  private startStatusBroadcast() {
    this.statusTimer = setInterval(() => {
      for (const sym of Object.keys(this.latest) as MetalSymbol[]) {
        const cur = this.latest[sym];
        if (!cur) continue;
        const effectiveOpen = this.isEffectivelyOpen(cur);
        if (cur.marketOpen === effectiveOpen) continue; // no state change, skip noise
        this.latest[sym] = { ...cur, marketOpen: effectiveOpen };
        this.emit("tick", this.latest[sym]);
      }
    }, 15_000).unref();
  }

  private connect() {
    try {
      this.ws = new WebSocket(TV_WS_URL, {
        headers: { Origin: "https://www.tradingview.com" },
      });
    } catch (err) {
      logger.error({ err }, "[liveGoldFeed] failed to open socket");
      this.scheduleReconnect();
      return;
    }

    this.ws.on("open", () => {
      logger.info("[liveGoldFeed] connected");
      this.reconnectAttempts = 0;
      this.initSession();
      this.startHeartbeat();
    });

    this.ws.on("message", (data) => this.handleMessage(data.toString()));

    this.ws.on("close", () => {
      logger.warn("[liveGoldFeed] disconnected — reconnecting");
      this.stopHeartbeat();
      this.scheduleReconnect();
    });

    this.ws.on("error", (err) => {
      logger.error({ err: (err as Error).message }, "[liveGoldFeed] socket error");
    });
  }

  private scheduleReconnect() {
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 30_000);
    this.reconnectAttempts++;
    setTimeout(() => this.connect(), delay).unref();
  }

  private frame(msgObj: object): string {
    const str = JSON.stringify(msgObj);
    return `~m~${str.length}~m~${str}`;
  }

  private send(msgObj: object) {
    this.ws?.send(this.frame(msgObj));
  }

  private initSession() {
    this.send({ m: "quote_create_session", p: [this.sessionId] });
    this.send({
      m: "quote_set_fields",
      p: [this.sessionId, "lp", "bid", "ask", "ch", "chp"],
    });
    for (const symbol of ALL_WS_SYMBOLS) {
      this.send({ m: "quote_add_symbols", p: [this.sessionId, symbol] });
    }
  }

  private startHeartbeat() {
    this.heartbeat = setInterval(() => {
      try {
        this.ws?.send("~h~0");
      } catch {
        /* connection likely already closing — close handler will reconnect */
      }
    }, 20_000).unref();
  }

  private stopHeartbeat() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  private handleMessage(raw: string) {
    const frames = raw.split(/~m~\d+~m~/).filter(Boolean);

    for (const frame of frames) {
      if (frame.startsWith("~h~")) continue; // heartbeat echo

      let msg: any;
      try {
        msg = JSON.parse(frame);
      } catch {
        continue; // non-JSON control frame
      }

      if (msg.m === "qsd" && msg.p?.[1]) {
        const symbolData = msg.p[1];
        const v = symbolData.v;
        const rawSymbol: string | undefined = symbolData.n;
        const canonical = rawSymbol ? SYMBOL_TO_CANONICAL[rawSymbol] : undefined;
        if (v?.lp !== undefined && canonical) {
          // Once an instrument's canonical price is resolved to one candidate
          // ticker, stick with that ticker for the rest of the connection
          // (don't flip-flop between e.g. OANDA:XAUUSD and FX_IDC:XAUUSD tick
          // to tick, which would show tiny spurious jumps from broker spread
          // differences).
          const existing = this.latest[canonical];
          if (existing && existing.symbol !== rawSymbol) continue;

          const priceChanged = !existing || existing.price !== v.lp;
          if (priceChanged) this.lastPriceChangeAt[canonical] = Date.now();

          const tick: LiveMetalTick = {
            sym: canonical,
            symbol: rawSymbol!,
            price: v.lp,
            bid: v.bid,
            ask: v.ask,
            changePct: v.chp,
            timestamp: Date.now(),
            marketOpen: isGoldMarketOpen(),
          };
          this.latest[canonical] = tick;
          this.emit("tick", tick);
        }
      }
    }
  }
}

export const liveGoldFeed = new LiveGoldFeed();
