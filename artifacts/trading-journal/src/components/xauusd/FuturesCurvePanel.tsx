import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { API_BASE } from '@/lib/api';

interface FcRow {
  label: string;
  month: string;
  price: number;
  spread: number;
  spreadPct: number;
  theoretical?: boolean;
}

interface FcData {
  rows: FcRow[];
  structure: 'contango' | 'backwardation' | 'mixed' | 'flat';
  spotPrice: number;
  annCarry: number;
  carryRate?: number;
  riskFreeRate?: number;
  updatedAt: number;
}

function fmt(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const STRUCTURE_META = {
  contango: {
    label: 'CONTANGO',
    desc: 'Futures priced above spot — market expects higher prices or elevated carry costs.',
    color: 'text-emerald-400',
    border: 'border-emerald-500/40',
    bg: 'bg-emerald-500/5',
  },
  backwardation: {
    label: 'BACKWARDATION',
    desc: 'Futures priced below spot — strong immediate demand or supply squeeze.',
    color: 'text-rose-400',
    border: 'border-rose-500/40',
    bg: 'bg-rose-500/5',
  },
  mixed: {
    label: 'MIXED',
    desc: 'Curve has both contango and backwardation across different expirations.',
    color: 'text-yellow-400',
    border: 'border-yellow-500/40',
    bg: 'bg-yellow-500/5',
  },
  flat: {
    label: 'FLAT',
    desc: 'No significant premium or discount across the curve.',
    color: 'text-muted-foreground',
    border: 'border-border',
    bg: 'bg-muted/10',
  },
};

export function FuturesCurvePanel() {
  const { data, isLoading, isError } = useQuery<FcData>({
    queryKey: ['xauusd-futures-curve'],
    queryFn: () =>
      fetch(`${API_BASE}/api/xauusd/futures-curve`, { credentials: 'include' }).then(r => r.json()),
    refetchInterval: 3 * 60 * 1000,
    staleTime: 2 * 60 * 1000,
  });

  const meta = data ? STRUCTURE_META[data.structure] : null;

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold tracking-wide">Gold Futures Curve</h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Contango / Backwardation — COMEX GC contracts
          </p>
        </div>
        {data && data.updatedAt > 0 && (
          <span className="text-[10px] text-muted-foreground font-mono">
            {new Date(data.updatedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </div>

      {isLoading && (
        <div className="space-y-2 animate-pulse">
          <div className="h-14 bg-muted rounded-lg" />
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-7 bg-muted rounded" style={{ width: `${60 + i * 7}%` }} />
          ))}
        </div>
      )}

      {isError && (
        <p className="text-xs text-destructive">Failed to load futures curve.</p>
      )}

      {data && meta && (
        <>
          {/* Structure badge */}
          <div className={`rounded-lg border ${meta.border} ${meta.bg} px-3 py-2.5 mb-4`}>
            <div className="flex items-center gap-2 mb-1">
              <span className={`text-xs font-bold tracking-widest ${meta.color}`}>
                {meta.label}
              </span>
              {data.annCarry !== 0 && (
                <span className={`text-[10px] font-mono ${data.annCarry > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {data.annCarry > 0 ? '+' : ''}{data.annCarry.toFixed(2)}% / yr
                </span>
              )}
              {data.carryRate != null && (
                <span className="text-[10px] font-mono text-muted-foreground">
                  · carry rate {data.carryRate.toFixed(2)}%
                </span>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">{meta.desc}</p>
          </div>

          {/* Curve table */}
          <div className="space-y-[3px]">
            {/* Column headers */}
            <div className="flex items-center gap-2 px-1.5 pb-1 text-[10px] text-muted-foreground uppercase tracking-widest border-b border-border mb-1">
              <span className="w-24 shrink-0">Expiry</span>
              <span className="flex-1 text-right">Price</span>
              <span className="w-20 text-right shrink-0">vs Spot</span>
              <span className="w-14 text-right shrink-0">Spread%</span>
            </div>

            {data.rows.map((row, i) => {
              const isSpot = i === 0;
              const positive = row.spread > 0;
              const negative = row.spread < 0;

              return (
                <div
                  key={row.label}
                  className={`flex items-center gap-2 rounded px-1.5 py-[5px] text-[11px] font-mono ${
                    isSpot ? 'bg-blue-500/10 border border-blue-500/25' : 'hover:bg-muted/20'
                  }`}
                >
                  {/* Label */}
                  <span className={`w-24 shrink-0 font-semibold ${isSpot ? 'text-blue-300' : 'text-foreground'}`}>
                    {row.label}
                  </span>

                  {/* Price */}
                  <span className="flex-1 text-right text-foreground">
                    ${fmt(row.price)}
                  </span>

                  {/* Spread */}
                  <span className={`w-20 text-right shrink-0 ${isSpot ? 'text-muted-foreground' : positive ? 'text-emerald-400' : negative ? 'text-rose-400' : 'text-muted-foreground'}`}>
                    {isSpot ? '—' : `${positive ? '+' : ''}${fmt(row.spread)}`}
                  </span>

                  {/* Spread % */}
                  <span className={`w-14 text-right shrink-0 ${isSpot ? 'text-muted-foreground' : positive ? 'text-emerald-400' : negative ? 'text-rose-400' : 'text-muted-foreground'}`}>
                    {isSpot ? '—' : `${positive ? '+' : ''}${row.spreadPct.toFixed(2)}%`}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Explanation */}
          <div className="mt-4 pt-3 border-t border-border space-y-1 text-[10px] text-muted-foreground">
            <div className="flex items-start gap-1.5">
              <span className="text-emerald-400 shrink-0">▲ Contango</span>
              <span>= Futures &gt; Spot. Normal for gold (storage + financing costs). Bearish short-term sentiment.</span>
            </div>
            <div className="flex items-start gap-1.5">
              <span className="text-rose-400 shrink-0">▼ Backwardation</span>
              <span>= Futures &lt; Spot. Rare for gold — signals strong physical demand or short squeeze.</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
