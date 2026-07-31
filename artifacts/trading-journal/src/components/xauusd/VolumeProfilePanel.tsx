import React, { useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { API_BASE } from '@/lib/api';
import { useLivePrice } from '@/hooks/use-live-price';

interface VpRow {
  price: number;
  priceTo: number;
  vol: number;
  volPct: number;
  barWidth: number;
  isPoc: boolean;
  isVah: boolean;
  isVal: boolean;
  inVa: boolean;
}

interface VpData {
  rows: VpRow[];
  poc: number;
  pocTo: number;
  vah: number;
  val: number;
  step: number;
  currentPrice: number;
  rangeHi: number;
  rangeLo: number;
  totalCandles: number;
  updatedAt: number;
}

function fmt(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function fmtPrecise(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function VolumeProfilePanel() {
  const livePrice = useLivePrice();
  const { data, isLoading, isError } = useQuery<VpData>({
    queryKey: ['xauusd-volume-profile'],
    queryFn: () => fetch(`${API_BASE}/api/xauusd/volume-profile`, { credentials: 'include' }).then(r => r.json()),
    refetchInterval: 5 * 60 * 1000,
    staleTime: 4 * 60 * 1000,
  });

  // The volume-profile endpoint is built from Yahoo's GC=F futures candles,
  // which trade at a different absolute price than the live spot feed shown
  // in the ticker. Rebase VAH/POC/VAL/rows by a constant offset so they sit
  // on the live price scale — the relative spacing between levels (what the
  // analysis actually depends on) is unchanged since every level shifts by
  // the same amount.
  //
  // The offset is captured ONCE per backend fetch (not recomputed on every
  // live tick) so the levels stay stable instead of jittering every ~1-2s
  // with the live price. "Current price" itself still tracks the live tick
  // directly for real-time accuracy.
  const offsetRef = useRef<number | null>(null);
  const lastDataRef = useRef<VpData | undefined>(undefined);
  if (data !== lastDataRef.current) {
    lastDataRef.current = data;
    offsetRef.current = null;
  }
  if (offsetRef.current === null && data && typeof livePrice === 'number') {
    offsetRef.current = livePrice - data.currentPrice;
  }
  const offset = offsetRef.current ?? 0;
  const vp: VpData | null = data ? {
    ...data,
    currentPrice: typeof livePrice === 'number' ? livePrice : data.currentPrice + offset,
    poc: data.poc + offset,
    pocTo: data.pocTo + offset,
    vah: data.vah + offset,
    val: data.val + offset,
    rangeHi: data.rangeHi + offset,
    rangeLo: data.rangeLo + offset,
    rows: data.rows.map(r => ({ ...r, price: r.price + offset, priceTo: r.priceTo + offset })),
  } : null;

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold tracking-wide">Volume Profile</h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Price levels ranked by traded volume — 1h candles, last 5 days
          </p>
        </div>
        {vp && (
          <span className="text-[10px] text-muted-foreground font-mono">
            {vp.totalCandles} bars · 1h · 5d
          </span>
        )}
      </div>

      {isLoading && (
        <div className="space-y-1.5 animate-pulse">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-5 bg-muted rounded" style={{ width: `${40 + i * 6}%` }} />
          ))}
        </div>
      )}

      {isError && (
        <p className="text-xs text-destructive">Failed to load volume profile.</p>
      )}

      {vp && (
        <>
          {/* Key levels summary */}
          <div className="grid grid-cols-3 gap-2 mb-4 text-center">
            <div className="rounded-lg border border-border bg-muted/30 p-2">
              <div className="text-[10px] text-muted-foreground uppercase tracking-widest mb-0.5">VAH</div>
              <div className="text-sm font-mono font-bold text-emerald-400">${fmt(vp.vah)}</div>
              <div className="text-[9px] text-muted-foreground">Value Area High</div>
            </div>
            <div className="rounded-lg border-2 border-yellow-500/60 bg-yellow-500/5 p-2">
              <div className="text-[10px] text-yellow-400 uppercase tracking-widest mb-0.5">POC</div>
              <div className="text-sm font-mono font-bold text-yellow-300">${fmt(vp.poc)}</div>
              <div className="text-[9px] text-muted-foreground">Point of Control</div>
            </div>
            <div className="rounded-lg border border-border bg-muted/30 p-2">
              <div className="text-[10px] text-muted-foreground uppercase tracking-widest mb-0.5">VAL</div>
              <div className="text-sm font-mono font-bold text-rose-400">${fmt(vp.val)}</div>
              <div className="text-[9px] text-muted-foreground">Value Area Low</div>
            </div>
          </div>

          {/* Current price position */}
          <div className="flex items-center gap-2 mb-3 px-1">
            <div className="w-2 h-2 rounded-full bg-blue-400 shrink-0" />
            <span className="text-[11px] text-muted-foreground">
              Current price{' '}
              <span className="font-mono text-foreground font-semibold">${fmtPrecise(vp.currentPrice)}</span>
              {vp.currentPrice >= vp.val && vp.currentPrice <= vp.vah
                ? <span className="ml-1 text-emerald-400">— inside Value Area</span>
                : vp.currentPrice > vp.vah
                ? <span className="ml-1 text-yellow-400">— above VAH</span>
                : <span className="ml-1 text-rose-400">— below VAL</span>}
            </span>
          </div>

          {/* Price level rows — descending (high to low) */}
          <div className="space-y-[3px]">
            {[...vp.rows].reverse().map((row) => {
              const isCurrent =
                vp.currentPrice >= row.price && vp.currentPrice < row.priceTo;

              return (
                <div
                  key={row.price}
                  className={`flex items-center gap-2 rounded px-1.5 py-[3px] text-[11px] font-mono transition-colors ${
                    row.isPoc
                      ? 'bg-yellow-500/15 border border-yellow-500/40'
                      : isCurrent
                      ? 'bg-blue-500/10 border border-blue-500/30'
                      : row.inVa
                      ? 'bg-muted/20'
                      : ''
                  }`}
                >
                  {/* Price label */}
                  <span
                    className={`w-24 shrink-0 text-right ${
                      row.isPoc
                        ? 'text-yellow-300 font-bold'
                        : isCurrent
                        ? 'text-blue-300 font-semibold'
                        : 'text-muted-foreground'
                    }`}
                  >
                    ${fmt(row.price)}
                  </span>

                  {/* Bar */}
                  <div className="flex-1 h-3 bg-muted/30 rounded-sm overflow-hidden">
                    <div
                      className={`h-full rounded-sm transition-all ${
                        row.isPoc
                          ? 'bg-yellow-400'
                          : row.inVa
                          ? 'bg-emerald-500/70'
                          : 'bg-slate-500/50'
                      }`}
                      style={{ width: `${row.barWidth}%` }}
                    />
                  </div>

                  {/* Volume % */}
                  <span className="w-10 text-right text-muted-foreground shrink-0">
                    {row.volPct}%
                  </span>

                  {/* Tags */}
                  <span className="w-8 shrink-0 text-center">
                    {row.isPoc && <span className="text-yellow-400 font-bold text-[9px]">POC</span>}
                    {row.isVah && <span className="text-emerald-400 text-[9px]">VAH</span>}
                    {row.isVal && <span className="text-rose-400 text-[9px]">VAL</span>}
                    {isCurrent && !row.isPoc && (
                      <span className="text-blue-400 text-[9px]">NOW</span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Legend */}
          <div className="flex flex-wrap items-center gap-4 mt-3 pt-3 border-t border-border text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-sm bg-yellow-400" />
              POC — highest volume level
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-sm bg-emerald-500/70" />
              Value Area (70% of volume)
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-sm bg-blue-400" />
              Current price
            </span>
          </div>

          <p className="text-[10px] text-muted-foreground/60 mt-2">
            Updated: {new Date(vp.updatedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
          </p>
        </>
      )}
    </div>
  );
}
