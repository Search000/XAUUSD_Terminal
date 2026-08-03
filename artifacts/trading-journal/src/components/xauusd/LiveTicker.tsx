import React, { useState, useEffect, useRef } from 'react';
import { API_BASE } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Activity, WifiOff, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@clerk/react';
import { useSystemTimezone, minsUtcToZonedTime } from '@/lib/timezone';
import { useLivePrice } from '@/hooks/use-live-price';

interface TickData {
  price: number;
  change: number;
  changePct: number;
  high24h: number;
  low24h: number;
  open24h: number;
  timestamp: number;
  direction?: 'up' | 'down' | 'flat';
  tickCount?: number;
  spread?: number;
  source?: string;
  marketOpen?: boolean;
}

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

interface MarketTapeData {
  dxy: { price: number; changePct: number | null } | null;
  yield10y: { price: number; change: number | null } | null;
  cot: { netLongs: number; asOf: string } | null;
  fedFunds: number | null;
  atr14: number | null;
  fearGreed: { score: number; label: string } | null;
  session: string;
  updatedAt: number;
}

function fmt(n: number, digits = 2) {
  return n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function fmtCompact(n: number, symbol: string) {
  // DXY shows 3 decimal places; metals show 2
  const d = symbol === 'DXY' ? 3 : 2;
  return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

// ─── Bloomberg-style Ticker Tape ──────────────────────────────────────────────
function BloombergTape({ metals, goldTick, tape }: { metals: MetalQuote[]; goldTick: TickData | null; tape?: MarketTapeData }) {
  const LABEL_MAP: Record<string, string> = {
    XAU: 'GOLD',
    XAG: 'SILVER',
    XPT: 'PLATINUM',
    XPD: 'PALLADIUM',
    DXY: 'DXY',
  };

  // Build ordered items: Gold first (live SSE price), then XAG, XPT, XPD, DXY
  type TapeItem = { sym: string; label: string; price: number; change: number; changePct: number };
  const items: TapeItem[] = [];

  if (goldTick) {
    items.push({
      sym: 'XAU/USD',
      label: 'GOLD',
      price: goldTick.price,
      change: goldTick.change,
      changePct: goldTick.changePct,
    });
  }

  const ORDER = ['XAG', 'XPT', 'XPD', 'DXY'];
  for (const sym of ORDER) {
    const m = metals.find(x => x.symbol === sym);
    if (m && m.price > 0) {
      items.push({
        sym: sym === 'DXY' ? 'DXY' : `${sym}/USD`,
        label: LABEL_MAP[sym] ?? sym,
        price: m.price,
        change: m.change,
        changePct: m.changePct,
      });
    }
  }

  // Extra macro/market stat items — real data from /api/xauusd/market-tape
  // (10Y yield, CFTC COT positioning, gold-specific Fear/Greed score, the
  // currently active trading session, effective Fed Funds rate, ATR(14)).
  type StatItem = { label: string; value: string; color: string; arrow?: string };
  const stats: StatItem[] = [];

  if (tape?.yield10y) {
    const up = (tape.yield10y.change ?? 0) >= 0;
    stats.push({
      label: '10Y YIELD',
      value: `${tape.yield10y.price.toFixed(2)}%`,
      color: up ? '#26a69a' : '#ef5350',
      arrow: up ? '▲' : '▼',
    });
  }
  if (tape?.cot) {
    const k = tape.cot.netLongs / 1000;
    stats.push({
      label: 'COT NET LONGS',
      value: `${k >= 0 ? '+' : ''}${k.toFixed(0)}K`,
      color: k >= 0 ? '#26a69a' : '#ef5350',
    });
  }
  if (tape?.fearGreed) {
    const fg = tape.fearGreed;
    const color = fg.score <= 40 ? '#ef5350' : fg.score >= 60 ? '#26a69a' : '#f0b90b';
    stats.push({ label: 'FEAR/GREED', value: `${fg.score} ${fg.label.toUpperCase()}`, color });
  }
  if (tape?.session) {
    stats.push({ label: 'SESSION', value: tape.session, color: '#e0e3eb' });
  }
  if (tape?.fedFunds != null) {
    stats.push({ label: 'FED FUNDS', value: `${tape.fedFunds.toFixed(2)}%`, color: '#e0e3eb' });
  }
  if (tape?.atr14 != null) {
    stats.push({ label: 'ATR(14)', value: tape.atr14.toFixed(1), color: '#e0e3eb' });
  }

  if (items.length === 0 && stats.length === 0) return null;

  type Combined =
    | { kind: 'price'; sym: string; label: string; price: number; change: number; changePct: number }
    | { kind: 'stat'; label: string; value: string; color: string; arrow?: string };

  const combined: Combined[] = [
    ...items.map(i => ({ kind: 'price' as const, ...i })),
    ...stats.map(s => ({ kind: 'stat' as const, ...s })),
  ];

  // Triple-duplicate the SAME combined block for seamless infinite scroll.
  const allCombined = [...combined, ...combined, ...combined];

  const trackRef = useRef<HTMLDivElement>(null);
  const posRef = useRef(0);

  // Manually driven scroll instead of a CSS % keyframe. A CSS
  // translateX(-33.333%) keyframe re-measures against the track's CURRENT
  // width every frame — if the content width shifts even slightly between
  // renders (a price gains a digit, DXY/metals data arrives, %-change text
  // changes length), the animation's effective distance shifts too and it
  // visibly snaps/jumps instead of scrolling smoothly. Driving position in
  // real pixels via rAF and wrapping by the measured one-copy width avoids
  // that entirely — it always scrolls one direction and wraps seamlessly,
  // never jumping back to the start.
  useEffect(() => {
    const PX_PER_SEC = 55;
    let raf = 0;
    let lastTs: number | null = null;

    function step(ts: number) {
      if (lastTs === null) lastTs = ts;
      const dt = (ts - lastTs) / 1000;
      lastTs = ts;
      const track = trackRef.current;
      if (track) {
        const oneCopyWidth = track.scrollWidth / 3;
        posRef.current -= PX_PER_SEC * dt;
        if (oneCopyWidth > 0 && posRef.current <= -oneCopyWidth) {
          posRef.current += oneCopyWidth;
        }
        track.style.transform = `translateX(${posRef.current}px)`;
      }
      raf = requestAnimationFrame(step);
    }

    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div
      className="overflow-hidden relative select-none"
      style={{ background: '#05050e', height: 30, borderBottom: '1px solid #1a1a2e' }}
    >
      {/* Left fade */}
      <div
        className="absolute left-0 top-0 bottom-0 w-16 z-10 pointer-events-none"
        style={{ background: 'linear-gradient(to right, #05050e 60%, transparent)' }}
      />
      {/* Right fade */}
      <div
        className="absolute right-0 top-0 bottom-0 w-16 z-10 pointer-events-none"
        style={{ background: 'linear-gradient(to left, #05050e 60%, transparent)' }}
      />

      <div
        ref={trackRef}
        className="flex items-center h-full whitespace-nowrap"
        style={{ willChange: 'transform' }}
      >
        {allCombined.map((item, i) => {
          if (item.kind === 'price') {
            const up = item.change >= 0;
            const color = up ? '#26a69a' : '#ef5350';
            const arrow = up ? '▲' : '▼';
            return (
              <React.Fragment key={i}>
                <span className="flex items-center gap-[7px] px-5 text-[11px] font-mono leading-none">
                  <span style={{ color: '#f0b90b', fontWeight: 700, letterSpacing: '0.06em' }}>
                    {item.label}
                  </span>
                  <span style={{ color, fontWeight: 600 }}>
                    {fmtCompact(item.price, item.label)}
                  </span>
                  <span style={{ color }} className="flex items-center gap-[3px]">
                    <span style={{ fontSize: 9 }}>{arrow}</span>
                    <span>{Math.abs(item.changePct).toFixed(2)}%</span>
                  </span>
                </span>
                <span style={{ color: '#2a2a3e', fontSize: 16, lineHeight: 1 }}>◆</span>
              </React.Fragment>
            );
          }
          return (
            <React.Fragment key={i}>
              <span className="flex items-center gap-[7px] px-5 text-[11px] font-mono leading-none">
                <span style={{ color: '#f0b90b', fontWeight: 700, letterSpacing: '0.06em' }}>
                  {item.label}
                </span>
                <span style={{ color: item.color, fontWeight: 600 }}>
                  {item.arrow ? `${item.arrow} ` : ''}{item.value}
                </span>
              </span>
              <span style={{ color: '#2a2a3e', fontSize: 16, lineHeight: 1 }}>◆</span>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main LiveTicker ───────────────────────────────────────────────────────────
function useUtcClock() {
  const [time, setTime] = useState(() =>
    new Date().toLocaleTimeString('en-US', { hour12: false, timeZone: 'UTC' })
  );
  useEffect(() => {
    const id = setInterval(() => {
      setTime(new Date().toLocaleTimeString('en-US', { hour12: false, timeZone: 'UTC' }));
    }, 1000);
    return () => clearInterval(id);
  }, []);
  return time;
}

function useZonedClock(offsetMinutes: number) {
  const compute = () => {
    const totalMins = Math.floor(Date.now() / 60000) + offsetMinutes;
    const mins = ((totalMins % 1440) + 1440) % 1440;
    const h = String(Math.floor(mins / 60)).padStart(2, '0');
    const m = String(mins % 60).padStart(2, '0');
    const now = new Date();
    const s = String(now.getUTCSeconds()).padStart(2, '0');
    return `${h}:${m}:${s}`;
  };
  const [time, setTime] = useState(compute);
  useEffect(() => {
    const id = setInterval(() => setTime(compute()), 1000);
    return () => clearInterval(id);
  }, [offsetMinutes]);
  return time;
}

export function LiveTicker() {
  const { price: spotPrice, changePct: spotChangePct, timestamp: spotTimestamp, connected: liveConnected, marketOpen: liveMarketOpen } = useLivePrice();
  const [flash, setFlash] = useState<'up' | 'down' | null>(null);
  const [flashSeq, setFlashSeq] = useState(0);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevPriceRef = useRef<number | null>(null);
  const utcTime = useUtcClock();
  const { offsetMinutes, labelWithCity: localTzLabel } = useSystemTimezone();
  const localTime = useZonedClock(offsetMinutes);
  const { getToken } = useAuth();

  // Nothing that only changes while the market trades should keep polling
  // once it's closed — Yahoo's own snapshot is frozen over the weekend too,
  // so this just avoids pointless requests rather than changing behavior.
  const marketClosed = liveMarketOpen === false;

  // Baseline 24h stats (Yahoo-sourced) used to fill high/low/open/change
  // for the free shared live-price feed. `price` here is the raw GC=F
  // futures quote — a different absolute scale than the live spot feed —
  // so it's used only to compute a rebase offset, never shown directly.
  const { data: snapshot } = useQuery<{ price: number; open24h: number; high24h: number; low24h: number } | null>({
    queryKey: ['xauusd/price-snapshot'],
    queryFn: async () => {
      const r = await fetch(`${API_BASE}/api/xauusd/price`, { credentials: 'include' });
      if (!r.ok) return null;
      return r.json();
    },
    refetchInterval: marketClosed ? false : 60000,
    staleTime: 55000,
    retry: 2,
  });

  const { data: metals = [] } = useQuery<MetalQuote[]>({
    queryKey: ['xauusd/metals'],
    queryFn: async () => {
      const token = await getToken();
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const r = await fetch(`${API_BASE}/api/xauusd/metals`, {
        credentials: 'include',
        headers,
      });
      if (!r.ok) return [];
      const d = await r.json();
      return Array.isArray(d) ? d : [];
    },
    refetchInterval: marketClosed ? false : 30000,
    staleTime: 25000,
    retry: 2,
  });

  const { data: tape } = useQuery<MarketTapeData>({
    queryKey: ['xauusd/market-tape'],
    queryFn: async () => {
      const r = await fetch(`${API_BASE}/api/xauusd/market-tape`, { credentials: 'include' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    refetchInterval: 5 * 60 * 1000,
    staleTime: 4 * 60 * 1000,
    retry: 1,
  });

  // ── Live tick from the shared useLivePrice hook (baseline 24h stats
  // filled in from the snapshot) ──────────────────────────────────────────
  // snapshot.{open,high,low}24h come from Yahoo's GC=F futures quote, which
  // trades at a different absolute price than the live spot feed above —
  // same mismatch the panels had. Rebase them by the live-vs-futures offset
  // (same pattern as FibonacciPanel/TechnicalsPanel/etc.) so 24H HIGH/LOW/
  // OPEN always sit on the same scale as the big live price next to them.
  const tick: TickData | null = React.useMemo(() => {
    if (typeof spotPrice === 'number') {
      const offset = snapshot ? spotPrice - snapshot.price : 0;
      const open = snapshot ? snapshot.open24h + offset : spotPrice;
      const change = spotPrice - open;
      const changePct = spotChangePct ?? (open ? (change / open) * 100 : 0);
      return {
        price: spotPrice,
        change,
        changePct,
        high24h: snapshot ? snapshot.high24h + offset : Math.max(spotPrice, open),
        low24h: snapshot ? snapshot.low24h + offset : Math.min(spotPrice, open),
        open24h: open,
        timestamp: spotTimestamp ?? Date.now(),
        source: 'live',
        marketOpen: liveMarketOpen ?? undefined,
      };
    }
    return null;
  }, [spotPrice, spotChangePct, spotTimestamp, liveMarketOpen, snapshot]);

  const connected = liveConnected;

  // Flash on price change, driven off the merged tick — skipped while the
  // market is closed so a frozen price never "flashes" from a stale re-send.
  useEffect(() => {
    if (!tick || marketClosed) return;
    const prev = prevPriceRef.current;
    const dir = prev !== null
      ? tick.price > prev ? 'up' : tick.price < prev ? 'down' : null
      : null;
    if (dir) {
      if (flashTimer.current) clearTimeout(flashTimer.current);
      setFlash(dir);
      setFlashSeq((s: number) => s + 1);
      flashTimer.current = setTimeout(() => setFlash(null), 600);
    }
    prevPriceRef.current = tick.price;
  }, [tick, marketClosed]);

  const isUp = tick ? tick.change >= 0 : true;
  const priceColor =
    marketClosed     ? '#758696' :
    flash === 'up'   ? '#26a69a' :
    flash === 'down' ? '#ef5350' :
    isUp             ? '#26a69a' : '#ef5350';

  // DXY from metals list
  const dxy = (metals as MetalQuote[]).find(m => m.symbol === 'DXY');
  // Other precious metals (excluding Gold)
  const metalsList = (metals as MetalQuote[]).filter(m => m.symbol !== 'XAU' && m.symbol !== 'DXY' && m.price > 0);

  return (
    <div className="flex flex-col rounded-lg overflow-hidden border border-[#1a1a2e]" style={{ background: '#0d0d14' }}>
      {/* Bloomberg-style scrolling tape */}
      <BloombergTape metals={metals as MetalQuote[]} goldTick={tick} tape={tape} />

      {/* Main XAU/USD row */}
      <div
        className={cn(
          'relative overflow-hidden transition-colors duration-300',
          flash === 'up'   ? 'border-l-2 border-[#26a69a]' :
          flash === 'down' ? 'border-l-2 border-[#ef5350]' :
          'border-l-2 border-[#f0b90b]'
        )}
      >
        {/* Flash overlay */}
        {flash && (
          <div
            className={cn(
              'absolute inset-0 pointer-events-none transition-opacity duration-300',
              flash === 'up' ? 'bg-[#26a69a]' : 'bg-[#ef5350]'
            )}
            style={{ opacity: 0.04 }}
          />
        )}

        <div className="px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-0">
          {/* Symbol + price */}
          <div className="flex items-center gap-5 flex-shrink-0">
            <div>
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-[11px] font-bold text-[#f0b90b] font-mono tracking-[0.2em] uppercase">
                  Gold / US Dollar
                </span>
                <span className={cn(
                  'flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded font-mono border',
                  marketClosed
                    ? 'bg-[#758696]/10 text-[#758696] border-[#758696]/20'
                    : connected
                    ? 'bg-[#26a69a]/10 text-[#26a69a] border-[#26a69a]/20'
                    : 'bg-[#2a2a3e] text-[#758696] border-[#2a2a3e]'
                )}>
                  {marketClosed
                    ? <WifiOff className="w-2.5 h-2.5" />
                    : connected
                    ? <Activity className="w-2.5 h-2.5 animate-pulse" />
                    : <WifiOff className="w-2.5 h-2.5" />
                  }
                  {marketClosed ? 'MARKET CLOSED' : connected ? 'LIVE' : 'CONNECTING'}
                </span>
                {tick?.tickCount !== undefined && (
                  <span className="text-[9px] font-mono text-[#758696]">#{tick.tickCount}</span>
                )}
              </div>
              {tick ? (
                <div className="flex items-baseline gap-3">
                  <span
                    key={flash ? `${flash}-${flashSeq}` : 'idle'}
                    className={cn(
                      'text-3xl sm:text-4xl font-mono font-bold tracking-tight transition-colors duration-150 rounded px-1',
                      flash === 'up' && 'price-pulse-up',
                      flash === 'down' && 'price-pulse-down'
                    )}
                    style={{ color: priceColor }}
                  >
                    {fmt(tick.price)}
                  </span>
                  <div className="flex flex-col">
                    <span className={cn(
                      'text-sm font-mono flex items-center font-semibold leading-tight',
                      isUp ? 'text-[#26a69a]' : 'text-[#ef5350]'
                    )}>
                      {isUp ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
                      {isUp ? '+' : ''}{fmt(tick.change)}
                    </span>
                    <span className={cn(
                      'text-xs font-mono font-semibold',
                      isUp ? 'text-[#26a69a]' : 'text-[#ef5350]'
                    )}>
                      ({isUp ? '+' : '-'}{fmt(Math.abs(tick.changePct), 3)}%)
                    </span>
                  </div>
                </div>
              ) : (
                <div className="h-10 w-48 rounded bg-[#1a1a2e] animate-pulse mt-1" />
              )}
            </div>
          </div>

          {/* Divider */}
          <div className="hidden sm:block w-px h-12 bg-[#2a2a3e] mx-6" />

          {/* XAU stats */}
          {tick && (
            <div className="flex flex-row gap-5 sm:gap-7 flex-wrap">
              <StatItem label="24H HIGH" value={fmt(tick.high24h)} positive />
              <StatItem label="24H LOW"  value={fmt(tick.low24h)}  negative />
              <StatItem label="24H OPEN" value={fmt(tick.open24h)} />
              {tick.spread !== undefined && (
                <StatItem label="SPREAD" value={tick.spread.toFixed(1)} />
              )}
            </div>
          )}

          {/* Divider before metals */}
          {(metalsList.length > 0 || dxy) && (
            <div className="hidden xl:block w-px h-12 bg-[#2a2a3e] mx-6" />
          )}

          {/* Precious metals inline */}
          {metalsList.length > 0 && (
            <div className="hidden xl:flex flex-row gap-6 flex-wrap">
              {metalsList.map(m => (
                <MetalItem key={m.symbol} metal={m} />
              ))}
            </div>
          )}

          {/* Divider before DXY */}
          {dxy && dxy.price > 0 && (
            <div className="hidden xl:block w-px h-12 bg-[#2a2a3e] mx-4" />
          )}

          {/* DXY */}
          {dxy && dxy.price > 0 && (
            <div className="hidden xl:flex flex-col gap-0.5">
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] font-mono font-bold text-[#f0b90b] uppercase tracking-widest">
                  DXY
                </span>
                <span className={cn(
                  'text-[9px] font-mono',
                  dxy.change >= 0 ? 'text-[#26a69a]' : 'text-[#ef5350]'
                )}>
                  {dxy.change >= 0 ? '▲' : '▼'}{Math.abs(dxy.changePct).toFixed(2)}%
                </span>
              </div>
              <span className={cn(
                'text-sm font-mono font-semibold',
                dxy.change >= 0 ? 'text-[#26a69a]' : 'text-[#ef5350]'
              )}>
                {dxy.price.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 })}
              </span>
            </div>
          )}

          {/* Live UTC Clock + local city clock */}
          <div className="sm:ml-auto flex items-end gap-3 shrink-0">
            <div className="text-[10px] font-mono flex flex-col items-end gap-0.5">
              <span className="text-[#758696] text-[9px] uppercase tracking-widest">UTC</span>
              <span className="text-[#d1d4dc] font-bold tabular-nums text-[13px]">{utcTime}</span>
            </div>
            <div className="text-[10px] font-mono flex flex-col items-end gap-0.5">
              <span className="text-[#758696] text-[9px] uppercase tracking-widest">{localTzLabel}</span>
              <span className="text-[#d1d4dc] font-bold tabular-nums text-[13px]">{localTime}</span>
            </div>
          </div>
        </div>

        {/* Mobile metals + DXY row */}
        {(metalsList.length > 0 || (dxy && dxy.price > 0)) && (
          <div className="xl:hidden flex gap-4 px-4 pb-3 flex-wrap">
            {metalsList.map(m => (
              <MetalItem key={m.symbol} metal={m} compact />
            ))}
            {dxy && dxy.price > 0 && (
              <div className="flex flex-col gap-0.5">
                <div className="flex items-center gap-1.5">
                  <span className="text-[9px] font-mono font-bold text-[#f0b90b] uppercase tracking-widest">DXY</span>
                  <span className={cn('text-[9px] font-mono', dxy.change >= 0 ? 'text-[#26a69a]' : 'text-[#ef5350]')}>
                    {dxy.change >= 0 ? '▲' : '▼'}{Math.abs(dxy.changePct).toFixed(2)}%
                  </span>
                </div>
                <span className={cn('text-sm font-mono font-semibold', dxy.change >= 0 ? 'text-[#26a69a]' : 'text-[#ef5350]')}>
                  {dxy.price.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 })}
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      <style>{`
        @keyframes pricePulseUp {
          0%   { box-shadow: 0 0 0 0 rgba(38,166,154,0.55); background-color: rgba(38,166,154,0.16); }
          70%  { box-shadow: 0 0 0 10px rgba(38,166,154,0); background-color: rgba(38,166,154,0); }
          100% { box-shadow: 0 0 0 0 rgba(38,166,154,0); background-color: rgba(38,166,154,0); }
        }
        @keyframes pricePulseDown {
          0%   { box-shadow: 0 0 0 0 rgba(239,83,80,0.55); background-color: rgba(239,83,80,0.16); }
          70%  { box-shadow: 0 0 0 10px rgba(239,83,80,0); background-color: rgba(239,83,80,0); }
          100% { box-shadow: 0 0 0 0 rgba(239,83,80,0); background-color: rgba(239,83,80,0); }
        }
        .price-pulse-up { animation: pricePulseUp 600ms ease-out; }
        .price-pulse-down { animation: pricePulseDown 600ms ease-out; }
      `}</style>
    </div>
  );
}

function StatItem({ label, value, positive, negative }: {
  label: string; value: string; positive?: boolean; negative?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[9px] font-mono font-bold text-[#758696] uppercase tracking-widest">{label}</span>
      <span className={cn(
        'text-sm font-mono font-semibold',
        positive ? 'text-[#26a69a]' :
        negative ? 'text-[#ef5350]' :
        'text-[#d1d4dc]'
      )}>
        {value}
      </span>
    </div>
  );
}

function MetalItem({ metal, compact }: { metal: MetalQuote; compact?: boolean }) {
  const isUp = metal.change >= 0;
  return (
    <div className={cn('flex flex-col gap-0.5', compact ? '' : '')}>
      <div className="flex items-center gap-1.5">
        <span className="text-[9px] font-mono font-bold text-[#758696] uppercase tracking-widest">
          {metal.symbol}/USD
        </span>
        <span className={cn('text-[9px] font-mono', isUp ? 'text-[#26a69a]' : 'text-[#ef5350]')}>
          {isUp ? '▲' : '▼'}{Math.abs(metal.changePct).toFixed(2)}%
        </span>
      </div>
      <span className={cn('text-sm font-mono font-semibold', isUp ? 'text-[#26a69a]' : 'text-[#ef5350]')}>
        {metal.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </span>
    </div>
  );
}
