import React, { useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { API_BASE } from '@/lib/api';
import { useLivePrice } from '@/hooks/use-live-price';
import { cn } from '@/lib/utils';

interface FearGreedData {
  score: number;
  label: string;
  color: string;
  components: {
    rsi: number;
    momentum: number;
    volatility: number;
    pricePos: number;
  };
  price: number;
  timestamp: number;
}

const ZONES = [
  { min: 0,  max: 20,  label: 'Extreme Fear', color: '#ef5350', short: 'EXFEAR' },
  { min: 20, max: 40,  label: 'Fear',         color: '#f57c00', short: 'FEAR'   },
  { min: 40, max: 60,  label: 'Neutral',      color: '#f0b90b', short: 'NEUT'   },
  { min: 60, max: 80,  label: 'Greed',        color: '#26a69a', short: 'GREED'  },
  { min: 80, max: 100, label: 'Extreme Greed',color: '#00e676', short: 'EXGREED'},
];

function getZone(score: number) {
  return ZONES.find(z => score >= z.min && score <= z.max) ?? ZONES[2];
}

// ─── Arc Gauge ────────────────────────────────────────────────────────────────
function FGGauge({ score, color }: { score: number; color: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const W = c.clientWidth || 200;
    const H = c.clientHeight || 110;
    c.width  = W * dpr;
    c.height = H * dpr;
    ctx.scale(dpr, dpr);

    const cx = W / 2;
    const cy = H * 0.82;
    const r  = Math.min(W * 0.42, H * 0.9);
    const START = Math.PI;
    const END   = 2 * Math.PI;

    // Track
    ctx.beginPath();
    ctx.arc(cx, cy, r, START, END);
    ctx.strokeStyle = '#1a1a2e';
    ctx.lineWidth = 12;
    ctx.lineCap = 'butt';
    ctx.stroke();

    // Zone segments
    const segs = [
      { from: 0,   to: 0.20, color: '#ef5350' },
      { from: 0.20,to: 0.40, color: '#f57c00' },
      { from: 0.40,to: 0.60, color: '#f0b90b' },
      { from: 0.60,to: 0.80, color: '#26a69a' },
      { from: 0.80,to: 1.00, color: '#00e676' },
    ];
    for (const seg of segs) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, START + seg.from * Math.PI, START + seg.to * Math.PI);
      ctx.strokeStyle = seg.color;
      ctx.lineWidth = 12;
      ctx.lineCap = 'butt';
      ctx.globalAlpha = 0.28;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Active fill
    const fillEnd = START + (score / 100) * Math.PI;
    ctx.beginPath();
    ctx.arc(cx, cy, r, START, fillEnd);
    ctx.strokeStyle = color;
    ctx.lineWidth = 12;
    ctx.lineCap = 'round';
    ctx.shadowColor = color;
    ctx.shadowBlur = 10;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Needle
    const needleA = fillEnd;
    const nx = cx + r * Math.cos(needleA);
    const ny = cy + r * Math.sin(needleA);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(nx, ny);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Center dot
    ctx.beginPath();
    ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 6;
    ctx.fill();
    ctx.shadowBlur = 0;

    // Zone labels: E.FEAR | FEAR | NEUTRAL | GREED | E.GREED
    ctx.font = `bold ${Math.max(7, W * 0.035)}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#758696';
    const labelSegs = [
      { pct: 0.10, text: 'E.FEAR' },
      { pct: 0.30, text: 'FEAR'   },
      { pct: 0.50, text: 'NEUT'   },
      { pct: 0.70, text: 'GREED'  },
      { pct: 0.90, text: 'E.GRD'  },
    ];
    for (const ls of labelSegs) {
      const a = START + ls.pct * Math.PI;
      const lx = cx + (r + 18) * Math.cos(a);
      const ly = cy + (r + 18) * Math.sin(a);
      ctx.fillText(ls.text, lx, ly);
    }
  }, [score, color]);

  return <canvas ref={ref} style={{ width: '100%', height: 110, display: 'block' }} />;
}

// ─── Component row ────────────────────────────────────────────────────────────
function CompRow({ label, value, bar, positive }: {
  label: string; value: string; bar: number; positive: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[9px] font-mono uppercase tracking-widest w-20 shrink-0" style={{ color: '#758696' }}>
        {label}
      </span>
      <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: '#1a1a2e' }}>
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{
            width: `${Math.min(100, Math.max(0, bar))}%`,
            background: positive ? '#26a69a' : '#ef5350',
          }}
        />
      </div>
      <span className="text-[10px] font-mono w-14 text-right tabular-nums" style={{ color: positive ? '#26a69a' : '#ef5350' }}>
        {value}
      </span>
    </div>
  );
}

export function FearGreedIndex() {
  const { marketOpen } = useLivePrice();
  const { data, isLoading } = useQuery<FearGreedData>({
    queryKey: ['xauusd/fear-greed'],
    queryFn: async () => {
      const r = await fetch(`${API_BASE}/api/xauusd/fear-greed`, { credentials: 'include' });
      if (!r.ok) throw new Error('fetch error');
      return r.json();
    },
    refetchInterval: marketOpen === false ? false : 5 * 60_000,
    staleTime:       4 * 60_000,
  });

  const score = data?.score ?? 50;
  const zone  = getZone(score);
  const color = data?.color ?? zone.color;

  return (
    <div
      className="rounded-lg overflow-hidden"
      style={{ background: '#0d0d14', border: '1px solid #2a2a3e' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b" style={{ borderColor: '#1a1a2e' }}>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono font-bold tracking-[0.18em] uppercase" style={{ color: '#f0b90b' }}>
            GOLD
          </span>
          <span className="text-[10px] font-mono font-bold tracking-[0.12em] uppercase" style={{ color: '#758696' }}>
            Fear & Greed Index
          </span>
        </div>
        {!isLoading && data && (
          <span className="text-[9px] font-mono font-bold tracking-widest uppercase" style={{ color }}>
            {data.label}
          </span>
        )}
      </div>

      <div className="p-4 flex flex-col gap-4">
        {isLoading && !data ? (
          <div className="flex flex-col items-center gap-3">
            <div className="w-7 h-7 border-2 border-[#f0b90b] border-t-transparent rounded-full animate-spin" />
            <span className="text-[10px] font-mono text-[#758696]">Calculating...</span>
          </div>
        ) : (
          <>
            {/* Gauge */}
            <div className="relative">
              <FGGauge score={score} color={color} />
              {/* Score overlay */}
              <div className="absolute inset-0 flex flex-col items-center justify-end pb-2 pointer-events-none">
                <span
                  className="text-3xl font-mono font-black tabular-nums leading-none"
                  style={{ color }}
                >
                  {score}
                </span>
                <span className="text-[9px] font-mono font-bold uppercase tracking-widest mt-0.5" style={{ color: '#758696' }}>
                  / 100
                </span>
              </div>
            </div>

            {/* Zone bar */}
            <div className="flex rounded overflow-hidden h-1.5 gap-px">
              {ZONES.map(z => (
                <div
                  key={z.short}
                  className="flex-1 transition-opacity duration-300"
                  style={{
                    background: z.color,
                    opacity: zone.short === z.short ? 1 : 0.18,
                  }}
                />
              ))}
            </div>

            {/* Components */}
            {data?.components && (
              <div className="flex flex-col gap-2 pt-1">
                <CompRow
                  label="RSI (14)"
                  value={`${data.components.rsi.toFixed(1)}`}
                  bar={data.components.rsi}
                  positive={data.components.rsi >= 50}
                />
                <CompRow
                  label="Momentum"
                  value={`${data.components.momentum >= 0 ? '+' : ''}${data.components.momentum.toFixed(2)}%`}
                  bar={Math.min(100, Math.abs(data.components.momentum) * 20 + 50)}
                  positive={data.components.momentum >= 0}
                />
                <CompRow
                  label="Volatility"
                  value={`${data.components.volatility.toFixed(3)}%`}
                  bar={Math.min(100, (1 - data.components.volatility) * 100)}
                  positive={data.components.volatility < 0.5}
                />
                <CompRow
                  label="Price Pos"
                  value={`${data.components.pricePos.toFixed(1)}%`}
                  bar={data.components.pricePos}
                  positive={data.components.pricePos >= 50}
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
