import WebSocket from "ws";
import { EventEmitter } from "events";
import { logger } from "./logger";

// ── Shared, free, delay-free XAUUSD price feed ──────────────────────────────
// One outbound connection to TradingView's public quote websocket, fanned out
// in-memory to every connected client via SSE (see routes/xauusd.ts
// GET /xauusd/live-price). This scales to hundreds of concurrent viewers
// without hitting any external rate limit, since only ONE upstream
// connection is ever made regardless of how many users are watching.
//
// NOTE: this is an unofficial/reverse-engineered endpoint (no official
// TradingView API key involved). It can break if TradingView changes their
// protocol — fallback symbols are tried in order, and the feed auto-reconnects
// with backoff. If it goes fully silent, swap SYMBOLS for a Twelve Data /
// Finnhub free-tier websocket instead.

const TV_WS_URL =
  "wss://data.tradingview.com/socket.io/websocket?from=chart%2F&date=1";

const SYMBOLS = ["OANDA:XAUUSD", "FX_IDC:XAUUSD", "FOREXCOM:XAUUSD"];

export interface LiveGoldTick {
  symbol: string;
  price: number;
  bid?: number;
  ask?: number;
  changePct?: number;
  timestamp: number;
  marketOpen?: boolean;
}

// XAU/USD (spot gold vs dollar) trades ~24/5 like forex: opens Sunday
// ~22:00 UTC (Sydney) and closes Friday ~21:00 UTC (NY close, 5pm ET).
// This is an approximation (ignores exact DST offset + holidays) but is
// good enough to freeze the UI instead of showing a fake-live price
// over the weekend.
export function isGoldMarketOpen(d: Date = new Date()): boolean {
  const day = d.getUTCDay(); // 0 = Sun, 6 = Sat
  const hour = d.getUTCHours();
  if (day === 6) return false;                 // all Saturday: closed
  if (day === 0 && hour < 22) return false;     // Sunday before ~22:00 UTC open
  if (day === 5 && hour >= 21) return false;    // Friday after ~21:00 UTC close
  return true;
}

class LiveGoldFeed extends EventEmitter {
  private ws: WebSocket | null = null;
  private sessionId = "cs_" + Math.random().toString(36).slice(2, 15);
  private latest: LiveGoldTick | null = null;
  private reconnectAttempts = 0;
  private heartbeat: NodeJS.Timeout | null = null;
  private started = false;

  start() {
    if (this.started) return; // idempotent — safe to call multiple times
    this.started = true;
    this.connect();
    this.startStatusBroadcast();
  }

  getLatest(): LiveGoldTick | null {
    return this.latest;
  }

  private statusTimer: NodeJS.Timeout | null = null;

  // Re-emits the last known price (unchanged) with a refreshed marketOpen
  // flag every 30s. Real ticks stop arriving over the weekend, so without
  // this, clients only learn the market re/closed on their next reconnect —
  // this keeps the "MARKET CLOSED" badge accurate in near real-time while
  // never mutating the frozen price itself.
  private startStatusBroadcast() {
    this.statusTimer = setInterval(() => {
      if (!this.latest) return;
      const nowOpen = isGoldMarketOpen();
      if (nowOpen === this.latest.marketOpen) return; // no state change, skip noise
      this.latest = { ...this.latest, marketOpen: nowOpen };
      this.emit("tick", this.latest);
    }, 30_000).unref();
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
    for (const symbol of SYMBOLS) {
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
        if (v?.lp !== undefined) {
          this.latest = {
            symbol: symbolData.n ?? SYMBOLS[0],
            price: v.lp,
            bid: v.bid,
            ask: v.ask,
            changePct: v.chp,
            timestamp: Date.now(),
            marketOpen: isGoldMarketOpen(),
          };
          this.emit("tick", this.latest);
        }
      }
    }
  }
}

export const liveGoldFeed = new LiveGoldFeed();
