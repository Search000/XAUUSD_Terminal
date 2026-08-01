import React, { useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { API_BASE } from '@/lib/api';
import { useLivePrice } from '@/hooks/use-live-price';
import { cn } from '@/lib/utils';

interface VolatilityData {
  atr14: number;
  atrPct: number;
  level: 'low' | 'medium' | 'high' | 'extreme';
  trend: 'rising' | 'falling' | 'stable';
  price: number;
  dayHigh: number;
  dayLow: number;
  dayRange: number;
  histAtr: number[];
}

const LEVEL_CONFIG = {
  low:     { label: 'LOW',     color: '#26a69a', bg: 'rgba(38,166,154,0.12)',  border: 'rgba(38,166,154,0.3)',  pct: 20 },
  medium:  { label: 'MEDIUM',  color: '#f0b90b', bg: 'rgba(240,185,11,0.12)',  border: 'rgba(240,185,11,0.3)',  pct: 50 },
  high:    { label: 'HIGH',    color: '#f57c00', bg: 'rgba(245,124,0,0.12)',    border: 'rgba(245,124,0,0.3)',   pct: 78 },
  extreme: { label: 'EXTREME', color: '#ef5350', bg: 'rgba(239,83,80,0.12)',   border: 'rgba(239,83,80,0.3)',   pct: 100 },
};

const TREND_ICON = {
  rising:  { icon: '↑', color: '#ef5350', label: 'Rising' },
  falling: { icon: '↓', color: '#26a69a', label: 'Falling' },
  stable:  { icon: '→', color: '#758696', label: 'Stable' },
};

// Arc gauge drawn on canvas
function GaugeArc({ pct, color }: { pct: number; color: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const W = c.clientWidth;
    const H = c.clientHeight;
    c.width  = W * dpr;
    c.height = H * dpr;
    ctx.scale(dpr, dpr);

    const cx = W / 2;
    const cy = H * 0.88;
    const r  = Math.min(W, H * 1.6) * 0.42;
    const startA = Math.PI;
    const endA   = 2 * Math.PI;
    const fillA  = startA + (pct / 100) * Math.PI;

    // Track bg
    ctx.beginPath();
    ctx.arc(cx, cy, r, startA, endA);
    ctx.strokeStyle = '#1a1a2e';
    ctx.lineWidth = 10;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Segment colors along arc
    const segments = [
      { start: 0,    end: 0.30, color: '#26a69a' },
      { start: 0.30, end: 0.60, color: '#f0b90b' },
      { start: 0.60, end: 0.85, color: '#f57c00' },
      { start: 0.85, end: 1.00, color: '#ef5350' },
    ];
    for (const seg of segments) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, startA + seg.start * Math.PI, startA + seg.end * Math.PI);
      ctx.strokeStyle = seg.color;
      ctx.globalAlpha = 0.25;
      ctx.lineWidth = 10;
      ctx.lineCap = 'butt';
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Fill arc
    if (pct > 0) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, startA, fillA);
      ctx.strokeStyle = color;
      ctx.lineWidth = 10;
      ctx.lineCap = 'round';
      ctx.shadowColor = color;
      ctx.shadowBlur = 8;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // Needle
    const needleA = startA + (pct / 100) * Math.PI;
    const nx = cx + (r) * Math.cos(needleA);
    const ny = cy + (r) * Math.sin(needleA);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(nx, ny);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Center dot
    ctx.beginPath();
    ctx.arc(cx, cy, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

  }, [pct, color]);

  return (
    <canvas
      ref={ref}
      style={{ width: '100%', height: 80, display: 'block' }}
    />
  );
}

// Mini sparkline for ATR history
function AtrSparkline({ data, color }: { data: number[]; color: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  const draw = React.useCallback(() => {
    const c = ref.current;
    if (!c || data.length < 2) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const W = c.offsetWidth || c.parentElement?.offsetWidth || 200;
    const H = 28;
    c.width  = W * dpr;
    c.height = H * dpr;
    c.style.width  = W + 'px';
    c.style.height = H + 'px';
    ctx.scale(dpr, dpr);

    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    const toX = (i: number) => (i / (data.length - 1)) * W;
    const toY = (v: number) => H - 2 - ((v - min) / range) * (H - 4);

    // Fill
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, color + '55');
    grad.addColorStop(1, color + '00');
    ctx.beginPath();
    ctx.moveTo(toX(0), H);
    data.forEach((v, i) => ctx.lineTo(toX(i), toY(v)));
    ctx.lineTo(toX(data.length - 1), H);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Line
    ctx.beginPath();
    data.forEach((v, i) => i === 0 ? ctx.moveTo(toX(i), toY(v)) : ctx.lineTo(toX(i), toY(v)));
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Last dot
    const lx = toX(data.length - 1);
    const ly = toY(data[data.length - 1]);
    ctx.beginPath();
    ctx.arc(lx, ly, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }, [data, color]);

  useEffect(() => {
    // Draw immediately, then again after a short delay to catch layout
    draw();
    const t = setTimeout(draw, 80);
    return () => clearTimeout(t);
  }, [draw]);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(c);
    return () => ro.disconnect();
  }, [draw]);

  return <canvas ref={ref} style={{ width: '100%', height: 28, display: 'block' }} />;
}

export function VolatilityMeter() {
  const { marketOpen } = useLivePrice();
  const { data, isLoading } = useQuery<VolatilityData>({
    queryKey: ['xauusd/volatility'],
    queryFn: async () => {
      const r = await fetch(`${API_BASE}/api/xauusd/volatility`, { credentials: 'include' });
      if (!r.ok) throw new Error('fetch error');
      return r.json();
    },
    refetchInterval: marketOpen === false ? false : 60_000,
    staleTime: 55_000,
    retry: 2,
  });

  const level = data?.level ?? 'medium';
  const cfg   = LEVEL_CONFIG[level];
  const trend = data?.trend ?? 'stable';
  const trendCfg = TREND_ICON[trend];

  return (
    <div
      className="rounded-lg overflow-hidden"
      style={{ background: '#0d0d14', border: '1px solid #2a2a3e' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b" style={{ borderColor: '#1a1a2e' }}>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono font-bold tracking-[0.18em] uppercase" style={{ color: '#f0b90b' }}>
            Volatility
          </span>
          <span className="text-[10px] font-mono font-bold tracking-[0.12em] uppercase" style={{ color: '#758696' }}>
            ATR-14
          </span>
        </div>
        {data && (
          <div
            className="flex items-center gap-1 px-2 py-0.5 rounded"
            style={{ background: cfg.bg, border: `1px solid ${cfg.border}` }}
          >
            <span className="text-[9px] font-mono font-bold" style={{ color: cfg.color }}>
              {cfg.label}
            </span>
          </div>
        )}
      </div>

      <div className="p-3 flex flex-col gap-3">
        {isLoading && !data ? (
          <div className="flex flex-col gap-2">
            <div className="h-20 rounded animate-pulse" style={{ background: '#1a1a2e' }} />
            <div className="h-8 rounded animate-pulse" style={{ background: '#1a1a2e' }} />
          </div>
        ) : (
          <>
            {/* Gauge */}
            <GaugeArc pct={cfg.pct} color={cfg.color} />

            {/* ATR value + trend */}
            <div className="flex items-center justify-between -mt-1">
              <div className="flex flex-col">
                <span className="text-[9px] font-mono uppercase tracking-widest" style={{ color: '#758696' }}>ATR(14)</span>
                <span className="text-lg font-mono font-bold tabular-nums" style={{ color: cfg.color }}>
                  {data ? data.atr14.toFixed(2) : '—'}
                </span>
              </div>
              <div className="flex flex-col items-center">
                <span className="text-[9px] font-mono uppercase tracking-widest" style={{ color: '#758696' }}>ATR%</span>
                <span className="text-lg font-mono font-bold tabular-nums" style={{ color: cfg.color }}>
                  {data ? data.atrPct.toFixed(3) + '%' : '—'}
                </span>
              </div>
              <div className="flex flex-col items-end">
                <span className="text-[9px] font-mono uppercase tracking-widest" style={{ color: '#758696' }}>Trend</span>
                <span className="text-lg font-mono font-bold" style={{ color: trendCfg.color }}>
                  {trendCfg.icon} <span className="text-xs">{trendCfg.label}</span>
                </span>
              </div>
            </div>

            {/* Day range */}
            {data && (
              <div className="flex items-center justify-between px-0.5">
                <div className="flex flex-col">
                  <span className="text-[9px] font-mono uppercase tracking-widest" style={{ color: '#758696' }}>Day Range</span>
                  <span className="text-xs font-mono font-semibold tabular-nums" style={{ color: '#d1d4dc' }}>
                    {data.dayLow.toFixed(2)} – {data.dayHigh.toFixed(2)}
                  </span>
                </div>
                <div className="flex flex-col items-end">
                  <span className="text-[9px] font-mono uppercase tracking-widest" style={{ color: '#758696' }}>Range%</span>
                  <span className="text-xs font-mono font-semibold" style={{ color: '#d1d4dc' }}>
                    {data.dayRange.toFixed(3)}%
                  </span>
                </div>
              </div>
            )}

            {/* Sparkline */}
            {data && data.histAtr.length > 2 && (
              <div>
                <span className="text-[9px] font-mono uppercase tracking-widest block mb-1" style={{ color: '#758696' }}>
                  ATR History
                </span>
                <AtrSparkline data={data.histAtr} color={cfg.color} />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
