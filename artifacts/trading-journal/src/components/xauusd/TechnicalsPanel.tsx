import React, { useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { API_BASE } from '@/lib/api';
import { useLivePrice } from '@/hooks/use-live-price';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

const fmtN = (n: unknown): string => {
  if (typeof n !== 'number' || !isFinite(n)) return '—';
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

// ─── Analysis text ────────────────────────────────────────────────────────────
function buildAnalysis(d: any) {
  const price  = typeof d.currentPrice === 'number' ? d.currentPrice : 0;
  const signal = d.signal ?? 'neutral';
  const r1 = typeof d.r1 === 'number' ? d.r1 : null;
  const r2 = typeof d.r2 === 'number' ? d.r2 : null;
  const s1 = typeof d.s1 === 'number' ? d.s1 : null;
  const s2 = typeof d.s2 === 'number' ? d.s2 : null;
  const pivot = typeof d.pivot === 'number' ? d.pivot : null;

  const isBear = signal === 'bearish' || signal === 'overbought';
  const isBull = signal === 'bullish' || signal === 'oversold';

  let preference = '';
  let altScenario = '';

  if (isBear && r1 && s1 && s2) {
    preference = `Bearish below ${fmtN(r1)}. Targets: ${fmtN(s1)} → ${fmtN(s2)}.`;
    altScenario = r2 ? `Break above ${fmtN(r1)} opens ${fmtN(r2)}.` : '';
  } else if (isBull && s1 && r1 && r2) {
    preference = `Bullish above ${fmtN(s1)}. Targets: ${fmtN(r1)} → ${fmtN(r2)}.`;
    altScenario = s2 ? `Break below ${fmtN(s1)} risks ${fmtN(s2)}.` : '';
  } else {
    preference = pivot
      ? `Neutral near pivot ${fmtN(pivot)}. Watch ${fmtN(r1)} resistance and ${fmtN(s1)} support.`
      : 'No clear directional bias.';
  }

  const rsi = typeof d.rsi === 'number' ? d.rsi : 50;
  const belowSma50 = typeof d.sma50 === 'number' && price < d.sma50;
  const aboveSma50 = typeof d.sma50 === 'number' && price > d.sma50;
  const macdPos = typeof d.macd === 'number' && d.macd > 0;

  const rsiDesc = rsi > 70 ? 'RSI overbought' : rsi < 30 ? 'RSI oversold' : `RSI neutral (${d.rsi?.toFixed(0)})`;
  const macdDesc = macdPos ? 'MACD positive' : 'MACD negative';
  const smaDesc = belowSma50
    ? `Price below SMA50 (${fmtN(d.sma50)})`
    : aboveSma50 ? `Price above SMA50 (${fmtN(d.sma50)})` : '';

  // 1H vs 4H context
  const tfLine = (d.signal_1h && d.signal_4h)
    ? `1H: ${d.signal_1h} · 4H: ${d.signal_4h}`
    : '';

  const comment = [rsiDesc, macdDesc, smaDesc, tfLine].filter(Boolean).join('  ·  ');

  const intraday: 'bull' | 'bear' | 'neutral' = isBear ? 'bear' : isBull ? 'bull' : 'neutral';
  const shortTerm: 'bull' | 'bear' | 'neutral' = isBear ? 'bear' : isBull ? 'bull' : 'neutral';
  const medTerm: 'bull' | 'bear' | 'neutral' =
    typeof d.sma50 === 'number' && price > d.sma50 ? 'bull' : 'bear';

  return { preference, comment, altScenario, intraday, shortTerm, medTerm };
}

// ─── Signal config ────────────────────────────────────────────────────────────
function sigConfig(s: string) {
  if (s === 'bullish' || s === 'oversold')
    return { color: '#26a69a', bg: 'rgba(38,166,154,0.12)', label: s === 'oversold' ? 'OVERSOLD' : 'BULLISH', icon: 'bull' };
  if (s === 'bearish' || s === 'overbought')
    return { color: '#ef5350', bg: 'rgba(239,83,80,0.12)', label: s === 'overbought' ? 'OVERBOUGHT' : 'BEARISH', icon: 'bear' };
  return { color: '#9598a1', bg: 'rgba(149,152,161,0.08)', label: 'NEUTRAL', icon: 'neutral' };
}

// ─── Level row — no bar, no border lines ──────────────────────────────────────
interface LevelRowProps {
  fullLabel: string;
  price: number;
  type: 'resistance' | 'support' | 'pivot' | 'last';
  isCurrent?: boolean;
}

function LevelRow({ fullLabel, price, type, isCurrent }: LevelRowProps) {
  const colors = {
    resistance: '#26a69a',
    support:    '#ef5350',
    pivot:      '#5b9bd5',
    last:       '#f0b90b',
  };
  const color = colors[type];

  return (
    <div className={cn(
      'flex items-center justify-between px-4 py-[8px]',
      isCurrent ? 'bg-[#181824]' : '',
    )}>
      <span
        className="text-[13px] font-mono font-bold tabular-nums"
        style={{ color }}
      >
        {fmtN(price)}
      </span>
      <span
        className="text-[11px] font-mono font-medium tracking-wide"
        style={{ color, opacity: isCurrent ? 1 : 0.75 }}
      >
        {fullLabel}
      </span>
    </div>
  );
}

// ─── Trend icon ───────────────────────────────────────────────────────────────
function TrendIcon({ dir }: { dir: 'bull' | 'bear' | 'neutral' }) {
  if (dir === 'bull') return <TrendingUp className="w-3 h-3" />;
  if (dir === 'bear') return <TrendingDown className="w-3 h-3" />;
  return <Minus className="w-3 h-3" />;
}

// ─── Main component ───────────────────────────────────────────────────────────
export function TechnicalsPanel() {
  const { price: livePrice, marketOpen } = useLivePrice();
  const marketClosed = marketOpen === false;
  const { data, isLoading } = useQuery({
    queryKey: ['/api/xauusd/technicals'],
    queryFn: async () => {
      const r = await fetch(`${API_BASE}/api/xauusd/technicals`, { credentials: 'include' });
      if (!r.ok) return null;
      const d = await r.json();
      return d && typeof d === 'object' && 'rsi' in d ? d : null;
    },
    refetchInterval: marketClosed ? false : 60000,
  });

  // Offset captured ONCE per backend fetch (not recomputed on every live
  // tick) so support/resistance/pivot levels stay stable instead of
  // jittering every ~1-2s with the live price. See usage below.
  const offsetRef = useRef<number | null>(null);
  const lastDataRef = useRef<typeof data>(null);
  if (data !== lastDataRef.current) {
    lastDataRef.current = data;
    offsetRef.current = null; // needs recapture against the new fetch
  }
  if (offsetRef.current === null && !marketClosed && data && typeof livePrice === 'number' && typeof data.currentPrice === 'number') {
    offsetRef.current = livePrice - data.currentPrice;
  }

  if (isLoading || !data) {
    return (
      <div className="rounded-xl border border-[#2a2a3e] p-4 space-y-2" style={{ background: '#0d0d14' }}>
        <div className="flex items-center justify-between mb-3">
          <Skeleton className="h-3 w-28 bg-[#1a1a2e]" />
          <Skeleton className="h-5 w-16 bg-[#1a1a2e] rounded" />
        </div>
        {[1,2,3,4,5,6].map(i => <Skeleton key={i} className="h-8 w-full bg-[#1a1a2e] rounded" />)}
      </div>
    );
  }

  // The technicals endpoint computes support/resistance/pivot from Yahoo's
  // GC=F futures candles, which trade at a different absolute price than the
  // live spot feed shown in the ticker. Rebase every level by a constant
  // offset so the levels sit on the live price scale — the spacing between
  // levels (which is what actually matters for the analysis) is unchanged
  // since every level shifts by the same amount.
  const offset = offsetRef.current ?? 0;
  const shift = (v: unknown) => typeof v === 'number' ? v + offset : v;
  const data_ = {
    ...data,
    // "Current Price" itself always tracks the live tick in real time;
    // only the other levels use the frozen offset so they stay stable.
    currentPrice: typeof livePrice === 'number' ? livePrice : shift(data.currentPrice),
    r1: shift(data.r1),
    r2: shift(data.r2),
    s1: shift(data.s1),
    s2: shift(data.s2),
    pivot: shift(data.pivot),
    sma50: shift(data.sma50),
  };

  const analysis = buildAnalysis(data_);
  const sig = data_.signal ?? 'neutral';
  const sc = sigConfig(sig);

  // Level rows — r1/r2 are ALWAYS resistance, s1/s2 are ALWAYS support (2 of
  // each, plus current price and pivot). Previously these were re-labeled by
  // comparing each level to the current price, which could flip a genuine
  // resistance level to "Support" once the live-price rebase offset nudged
  // it below price — collapsing the panel to 1 resistance / 3 support rows
  // instead of the fixed 2/2 layout.
  // Fixed positional order — NOT sorted by price value. Current Price
  // always sits in the middle with both resistance levels above it and
  // both support levels below, even if the live price has since traded
  // through r1/s1 (r1/r2/s1/s2/pivot are only refreshed every 60s, so the
  // live tick can genuinely be above r1 or below s1 in between — that's
  // real breakout behavior, not something to hide, but the layout should
  // stay put rather than value-sorting rows into a different order).
  type Row = { price: number; fullLabel: string; type: 'resistance' | 'support' | 'pivot' | 'last' };
  const rows: Row[] = [
    data_.r2           && { price: data_.r2,           fullLabel: 'Resistance',    type: 'resistance' as const },
    data_.r1           && { price: data_.r1,           fullLabel: 'Resistance',    type: 'resistance' as const },
    data_.currentPrice && { price: data_.currentPrice, fullLabel: 'Current Price', type: 'last'        as const },
    data_.pivot        && { price: data_.pivot,        fullLabel: 'Pivot Point',   type: 'pivot'       as const },
    data_.s1           && { price: data_.s1,           fullLabel: 'Support',       type: 'support'     as const },
    data_.s2           && { price: data_.s2,           fullLabel: 'Support',       type: 'support'     as const },
  ].filter(Boolean) as Row[];

  const trendItems = [
    { label: 'Intraday', dir: analysis.intraday  },
    { label: 'Short',    dir: analysis.shortTerm },
    { label: 'Medium',   dir: analysis.medTerm   },
  ];

  return (
    <div className="rounded-xl border border-[#2a2a3e] overflow-hidden" style={{ background: '#0d0d14' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-[#1a1a2e]">
        <span className="text-[10px] font-mono font-bold text-[#758696] uppercase tracking-widest">
          XAU/USD · Technicals
        </span>
        <span
          className="flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-bold font-mono rounded-full"
          style={{ background: sc.bg, color: sc.color }}
        >
          {sc.icon === 'bull'    && <TrendingUp   className="w-3 h-3" />}
          {sc.icon === 'bear'    && <TrendingDown className="w-3 h-3" />}
          {sc.icon === 'neutral' && <Minus        className="w-3 h-3" />}
          {sc.label}
        </span>
      </div>

      {/* Preference */}
      <div className="px-4 py-3 border-b border-[#1a1a2e]">
        <p className="text-[12px] font-semibold leading-snug" style={{ color: sc.color }}>
          {analysis.preference}
        </p>
        {analysis.altScenario && (
          <p className="text-[10px] text-[#758696] mt-1 leading-snug">{analysis.altScenario}</p>
        )}
      </div>

      {/* Level rows — no dividers between them */}
      <div className="py-1">
        {rows.map((row, i) => (
          <LevelRow
            key={i}
            fullLabel={row.fullLabel}
            price={row.price}
            type={row.type}
            isCurrent={row.type === 'last'}
          />
        ))}
      </div>

      {/* Indicator strip */}
      <div className="px-4 py-2 border-t border-[#1a1a2e]">
        <p className="text-[9px] font-mono text-[#3a3a4e] leading-relaxed">{analysis.comment}</p>
      </div>

      {/* Trend row */}
      <div className="flex border-t border-[#1a1a2e]">
        {trendItems.map(({ label, dir }) => {
          const c = dir === 'bull' ? '#26a69a' : dir === 'bear' ? '#ef5350' : '#758696';
          return (
            <div key={label} className="flex-1 flex flex-col items-center py-2.5 gap-1 border-r border-[#1a1a2e] last:border-r-0">
              <span className="text-[8px] font-mono text-[#758696] uppercase tracking-wider">{label}</span>
              <span className="flex items-center gap-0.5 text-[10px] font-mono font-bold" style={{ color: c }}>
                <TrendIcon dir={dir} />
                {dir === 'bull' ? 'Bull' : dir === 'bear' ? 'Bear' : 'Flat'}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
