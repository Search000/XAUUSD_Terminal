import React, { useState, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { API_BASE } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useLivePrice } from '@/hooks/use-live-price';

type Tf = '1h' | '4h' | '1d';

interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface ChartData {
  candles: Candle[];
  price: number;
}

const FIB_LEVELS = [
  { ratio: 0,     label: '0%',     key: 'f0'   },
  { ratio: 0.236, label: '23.6%',  key: 'f236' },
  { ratio: 0.382, label: '38.2%',  key: 'f382' },
  { ratio: 0.5,   label: '50%',    key: 'f500' },
  { ratio: 0.618, label: '61.8%',  key: 'f618' },
  { ratio: 0.786, label: '78.6%',  key: 'f786' },
  { ratio: 1,     label: '100%',   key: 'f100' },
  // Extensions
  { ratio: 1.272, label: '127.2%', key: 'ext1272' },
  { ratio: 1.618, label: '161.8%', key: 'ext1618' },
];

const LEVEL_COLORS: Record<string, string> = {
  f0:      '#d1d4dc',
  f236:    '#26a69a',
  f382:    '#00bcd4',
  f500:    '#f0b90b',
  f618:    '#ff9800',
  f786:    '#ef5350',
  f100:    '#d1d4dc',
  ext1272: 'rgba(255,255,255,0.4)',
  ext1618: 'rgba(255,255,255,0.4)',
};

// Manual price correction applied to all displayed prices in this panel.
const MANUAL_PRICE_OFFSET = -61.83;

const TFS: Tf[] = ['1h', '4h', '1d'];
const LOOK_BACK: Record<Tf, number> = { '1h': 60, '4h': 40, '1d': 30 };

function calcSwing(candles: Candle[], lookback: number): { high: number; low: number; highIdx: number; lowIdx: number } {
  const slice = candles.slice(-lookback);
  let high = -Infinity, low = Infinity, highIdx = 0, lowIdx = 0;
  slice.forEach((c, i) => {
    if (c.high > high) { high = c.high; highIdx = i; }
    if (c.low  < low)  { low  = c.low;  lowIdx  = i; }
  });
  return { high, low, highIdx, lowIdx };
}

function fmtPrice(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function FibonacciPanel() {
  const [tf, setTf] = useState<Tf>('1h');
  const { price: spotPrice, marketOpen } = useLivePrice();
  const marketClosed = marketOpen === false;

  const { data, isLoading } = useQuery<ChartData>({
    queryKey: ['xauusd/chart', tf],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/xauusd/chart?interval=${tf}`, { credentials: 'include' });
      if (!res.ok) throw new Error('fetch failed');
      return res.json();
    },
    refetchInterval: marketClosed ? false : 60_000,
    staleTime: 30_000,
  });

  const candles = data?.candles ?? [];
  // chart API is built from Yahoo's GC=F futures candles — a different
  // absolute price than the live spot feed shown in the ticker. Compute a
  // constant offset from the last candle close to the live spot price, then
  // shift swingHigh/swingLow by it. Every fib level is a linear combination
  // of swingHigh/swingLow, so shifting both by the same offset shifts every
  // level by the same offset too — the retracement ratios stay correct.
  //
  // The offset is captured ONCE per candle fetch (not recomputed on every
  // live tick), otherwise every fib level would jitter every ~1-2s along
  // with the live price, making the retracement grid look unstable. It only
  // moves when the chart data itself refreshes (every 60s). The "LIVE"
  // marker still tracks the live tick directly for real-time accuracy.
  const refClose = candles.length > 0 ? candles[candles.length - 1].close : 0;
  const offsetRef = useRef<number | null>(null);
  const lastCandlesRef = useRef<typeof candles>([]);
  if (candles !== lastCandlesRef.current) {
    lastCandlesRef.current = candles;
    offsetRef.current = null;
  }
  if (offsetRef.current === null && typeof spotPrice === 'number' && refClose) {
    offsetRef.current = spotPrice - refClose;
  }
  const offset = (offsetRef.current ?? 0) + MANUAL_PRICE_OFFSET;
  const livePrice = typeof spotPrice === 'number'
    ? spotPrice + MANUAL_PRICE_OFFSET
    : (refClose ? refClose + offset : 0);

  const lookback = LOOK_BACK[tf];
  const rawSwing = candles.length >= 2
    ? calcSwing(candles, lookback)
    : { high: 0, low: 0, highIdx: 0, lowIdx: 0 };
  const swingHigh = rawSwing.high + offset;
  const swingLow = rawSwing.low + offset;

  const range = swingHigh - swingLow;

  // Determine trend direction based on which came last
  const slice = candles.slice(-lookback);
  let lastHighI = 0, lastLowI = 0;
  slice.forEach((c, i) => {
    if (c.high >= rawSwing.high) lastHighI = i;
    if (c.low  <= rawSwing.low)  lastLowI  = i;
  });
  // If high came after low → price fell from high → retracement downward
  // If low came after high → price rose from low → retracement upward
  const trendUp = lastLowI > lastHighI; // false = downtrend (retracing from high)

  const levels = FIB_LEVELS.map(lvl => {
    // Retracement: if downtrend, levels go from high DOWN
    //              if uptrend, levels go from low UP
    const price = trendUp
      ? swingLow + lvl.ratio * range
      : swingHigh - lvl.ratio * range;
    return { ...lvl, price };
  });

  // Find which zone current price is in
  const activeLevelIdx = levels.reduce((best, lvl, i) => {
    if (!livePrice) return best;
    const dist = Math.abs(lvl.price - livePrice);
    return dist < Math.abs(levels[best].price - livePrice) ? i : best;
  }, 0);

  // % position of price within range for the bar
  const priceBarPct = range > 0 ? Math.max(0, Math.min(100, ((livePrice - swingLow) / range) * 100)) : 50;

  return (
    <div
      className="rounded-xl overflow-hidden flex flex-col"
      style={{ background: '#0d0d14', border: '1px solid #1a1a2e' }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-2.5"
        style={{ borderBottom: '1px solid #1a1a2e', background: '#0b0b12' }}
      >
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-mono font-bold tracking-widest uppercase" style={{ color: '#f0b90b' }}>
            ⫠ FIBONACCI
          </span>
          <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={{ background: '#1a1a2e', color: '#758696' }}>
            XAU/USD
          </span>
        </div>
        {/* TF selector */}
        <div className="flex items-center gap-1">
          {TFS.map(t => (
            <button
              key={t}
              onClick={() => setTf(t)}
              className="text-[9px] font-mono font-bold px-2 py-0.5 rounded transition-all"
              style={{
                background: tf === t ? '#f0b90b' : '#1a1a2e',
                color: tf === t ? '#000' : '#758696',
                border: `1px solid ${tf === t ? '#f0b90b' : '#2a2a3e'}`,
              }}
            >
              {t.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {isLoading && candles.length === 0 ? (
        <div className="flex items-center justify-center py-10">
          <div className="w-6 h-6 border-2 border-[#f0b90b] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="p-4 flex flex-col gap-4">

          {/* Swing info */}
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-lg p-2.5 text-center" style={{ background: '#1a1a2e', border: '1px solid rgba(239,83,80,0.3)' }}>
              <div className="text-[9px] font-mono font-bold tracking-widest uppercase mb-1" style={{ color: '#758696' }}>SWING HIGH</div>
              <div className="text-sm font-mono font-bold" style={{ color: '#ef5350' }}>{fmtPrice(swingHigh)}</div>
            </div>
            <div className="rounded-lg p-2.5 text-center" style={{ background: '#1a1a2e', border: '1px solid rgba(240,185,11,0.3)' }}>
              <div className="text-[9px] font-mono font-bold tracking-widest uppercase mb-1" style={{ color: '#758696' }}>LIVE</div>
              <div className="text-sm font-mono font-bold" style={{ color: '#f0b90b' }}>{fmtPrice(livePrice)}</div>
              <div className="text-[9px] font-mono mt-0.5" style={{ color: trendUp ? '#26a69a' : '#ef5350' }}>
                {trendUp ? '▲ UPTREND' : '▼ DOWNTREND'}
              </div>
            </div>
            <div className="rounded-lg p-2.5 text-center" style={{ background: '#1a1a2e', border: '1px solid rgba(38,166,154,0.3)' }}>
              <div className="text-[9px] font-mono font-bold tracking-widest uppercase mb-1" style={{ color: '#758696' }}>SWING LOW</div>
              <div className="text-sm font-mono font-bold" style={{ color: '#26a69a' }}>{fmtPrice(swingLow)}</div>
            </div>
          </div>

          {/* Price position bar */}
          {range > 0 && (
            <div>
              <div className="flex justify-between text-[9px] font-mono mb-1" style={{ color: '#758696' }}>
                <span>{fmtPrice(swingLow)}</span>
                <span>RANGE {fmtPrice(range)}</span>
                <span>{fmtPrice(swingHigh)}</span>
              </div>
              <div className="relative h-3 rounded-full overflow-hidden" style={{ background: '#1a1a2e' }}>
                {/* Gradient bar */}
                <div
                  className="absolute inset-y-0 left-0 rounded-full"
                  style={{
                    width: '100%',
                    background: 'linear-gradient(to right, #26a69a, #f0b90b, #ef5350)',
                    opacity: 0.3,
                  }}
                />
                {/* Level tick marks */}
                {levels.slice(0, 7).map(lvl => {
                  const pct = range > 0 ? ((lvl.price - swingLow) / range) * 100 : 0;
                  return (
                    <div
                      key={lvl.key}
                      className="absolute top-0 bottom-0 w-px"
                      style={{ left: `${pct}%`, background: 'rgba(255,255,255,0.15)' }}
                    />
                  );
                })}
                {/* Price needle */}
                <div
                  className="absolute top-0 bottom-0 w-0.5 rounded-full transition-all duration-500"
                  style={{ left: `${priceBarPct}%`, background: '#f0b90b', boxShadow: '0 0 6px #f0b90b' }}
                />
              </div>
              <div className="text-center text-[9px] font-mono mt-1" style={{ color: '#758696' }}>
                {priceBarPct.toFixed(1)}% of range
              </div>
            </div>
          )}

          {/* Levels table */}
          <div className="flex flex-col gap-0.5">
            {levels.map((lvl, i) => {
              const isActive = i === activeLevelIdx;
              const isAbove = livePrice > 0 && lvl.price > livePrice;
              const isBelow = livePrice > 0 && lvl.price < livePrice;
              const dist = livePrice > 0 ? ((lvl.price - livePrice) / livePrice * 100) : 0;
              const color = LEVEL_COLORS[lvl.key] ?? '#9598a1';

              return (
                <div
                  key={lvl.key}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all"
                  style={{
                    background: isActive ? 'rgba(240,185,11,0.12)' : 'transparent',
                    border: `1px solid ${isActive ? 'rgba(240,185,11,0.4)' : 'transparent'}`,
                  }}
                >
                  {/* Color dot */}
                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />

                  {/* Label */}
                  <span className="text-[10px] font-mono font-bold w-14 flex-shrink-0" style={{ color }}>
                    {lvl.label}
                    {lvl.ratio > 1 && <span className="ml-1 text-[8px]" style={{ color: '#758696' }}>EXT</span>}
                  </span>

                  {/* Price */}
                  <span
                    className={cn('text-xs font-mono font-bold flex-1', isActive ? 'text-[#f0b90b]' : '')}
                    style={{ color: isActive ? '#f0b90b' : '#d1d4dc' }}
                  >
                    {fmtPrice(lvl.price)}
                  </span>

                  {/* Distance */}
                  {livePrice > 0 && (
                    <span
                      className="text-[9px] font-mono w-16 text-right flex-shrink-0"
                      style={{ color: isActive ? '#f0b90b' : isAbove ? '#ef5350' : isBelow ? '#26a69a' : '#758696' }}
                    >
                      {isActive ? '◀ HERE' : `${dist >= 0 ? '+' : ''}${dist.toFixed(2)}%`}
                    </span>
                  )}

                  {/* Zone indicator */}
                  {isActive && (
                    <span className="text-[8px] font-mono font-bold px-1.5 py-0.5 rounded" style={{ background: 'rgba(240,185,11,0.2)', color: '#f0b90b' }}>
                      ACTIVE
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {/* Footer info */}
          <div className="flex items-center justify-between text-[9px] font-mono" style={{ color: '#3a3a4e', borderTop: '1px solid #1a1a2e', paddingTop: '8px' }}>
            <span>Last {lookback} candles · {tf.toUpperCase()} chart</span>
            <span>Retracement {trendUp ? '↑ from low' : '↓ from high'}</span>
          </div>
        </div>
      )}
    </div>
  );
}
