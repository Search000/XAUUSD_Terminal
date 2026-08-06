import React, { useRef, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { API_BASE } from '@/lib/api';
import { format } from 'date-fns';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useLivePrice } from '@/hooks/use-live-price';

interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface FlowBar {
  time: number;
  buyVol: number;
  sellVol: number;
  delta: number;
  cumDelta: number;
  bull: boolean;
}

interface Computed {
  bars: FlowBar[];
  totalBuyVol: number;
  totalSellVol: number;
  buyPct: number;
  sellPct: number;
  cumDelta: number;
  deltaSign: 'positive' | 'negative' | 'neutral';
  price: number;
}

function computeFlow(candles: Candle[]): Computed {
  let cumDelta = 0;
  const bars: FlowBar[] = candles.map(c => {
    const isBull = c.close >= c.open;
    const bodySize = Math.abs(c.close - c.open);
    const totalRange = (c.high - c.low) || 0.01;
    const vol = c.volume || 1000;
    const buyVol  = isBull
      ? vol * (0.5 + (bodySize / totalRange) * 0.45)
      : vol * (0.5 - (bodySize / totalRange) * 0.35);
    const sellVol = vol - buyVol;
    const delta = buyVol - sellVol;
    cumDelta += delta;
    return {
      time: c.time,
      buyVol:  Math.round(buyVol),
      sellVol: Math.round(sellVol),
      delta:   Math.round(delta),
      cumDelta: Math.round(cumDelta),
      bull: isBull,
    };
  });

  const totalBuyVol  = bars.reduce((s, b) => s + b.buyVol, 0);
  const totalSellVol = bars.reduce((s, b) => s + b.sellVol, 0);
  const totalVol     = totalBuyVol + totalSellVol || 1;
  const buyPct       = (totalBuyVol / totalVol) * 100;

  return {
    bars,
    totalBuyVol,
    totalSellVol,
    buyPct:    parseFloat(buyPct.toFixed(1)),
    sellPct:   parseFloat((100 - buyPct).toFixed(1)),
    cumDelta:  Math.round(cumDelta),
    deltaSign: cumDelta > 100 ? 'positive' : cumDelta < -100 ? 'negative' : 'neutral',
    price:     candles[candles.length - 1]?.close ?? 0,
  };
}

// ─── Delta canvas ─────────────────────────────────────────────────────────────
function DeltaCanvas({ bars }: { bars: FlowBar[] }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const c = ref.current;
    if (!c || !bars.length) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const W = c.clientWidth || 300;
    const H = c.clientHeight || 90;
    c.width  = W * dpr;
    c.height = H * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);

    const PAD = { top: 4, bottom: 18, left: 2, right: 2 };
    const pw   = W - PAD.left - PAD.right;
    const ph   = H - PAD.top  - PAD.bottom;
    const barW = pw / bars.length;
    const gap  = Math.max(1, barW * 0.15);
    const maxAbs = Math.max(1, ...bars.map(b => Math.abs(b.delta)));
    const midY   = PAD.top + ph / 2;

    // Zero line
    ctx.beginPath();
    ctx.moveTo(PAD.left, midY);
    ctx.lineTo(W - PAD.right, midY);
    ctx.strokeStyle = '#2a2a3e';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Delta bars
    bars.forEach((bar, i) => {
      const x  = PAD.left + i * barW + gap / 2;
      const bw = barW - gap;
      const h  = (Math.abs(bar.delta) / maxAbs) * (ph / 2 - 2);
      ctx.fillStyle = bar.delta >= 0 ? '#26a69a' : '#ef5350';
      ctx.globalAlpha = 0.85;
      if (bar.delta >= 0) ctx.fillRect(x, midY - h, bw, h);
      else                ctx.fillRect(x, midY,     bw, h);
      ctx.globalAlpha = 1;
    });

    // Cumulative delta line
    const cums     = bars.map(b => b.cumDelta);
    const minCum   = Math.min(...cums);
    const maxCum   = Math.max(...cums);
    const cumRange = maxCum - minCum || 1;
    const toCumY   = (v: number) => PAD.top + ph - ((v - minCum) / cumRange) * ph;

    ctx.beginPath();
    bars.forEach((bar, i) => {
      const x = PAD.left + i * barW + barW / 2;
      const y = toCumY(bar.cumDelta);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = '#f0b90b';
    ctx.lineWidth   = 1.5;
    ctx.setLineDash([3, 2]);
    ctx.stroke();
    ctx.setLineDash([]);

    // X-axis time labels
    ctx.font      = `${Math.max(7, W * 0.025)}px monospace`;
    ctx.fillStyle = '#758696';
    ctx.textAlign = 'center';
    bars.forEach((bar, i) => {
      if (i % Math.max(1, Math.floor(bars.length / 6)) === 0) {
        ctx.fillText(format(new Date(bar.time), 'HH:mm'), PAD.left + i * barW + barW / 2, H - 2);
      }
    });
  }, [bars]);

  return <canvas ref={ref} style={{ width: '100%', height: 90, display: 'block' }} />;
}

// ─── Pressure bar ─────────────────────────────────────────────────────────────
function PressureBar({ buyPct, sellPct }: { buyPct: number; sellPct: number }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between text-[9px] font-mono font-bold uppercase tracking-widest">
        <span style={{ color: '#26a69a' }}>BUY {buyPct.toFixed(1)}%</span>
        <span style={{ color: '#ef5350' }}>SELL {sellPct.toFixed(1)}%</span>
      </div>
      <div className="flex h-2 rounded-full overflow-hidden" style={{ background: '#1a1a2e' }}>
        <div className="h-full transition-all duration-700"
          style={{ width: `${buyPct}%`, background: 'linear-gradient(to right,#26a69a,#00e676)' }} />
        <div className="h-full transition-all duration-700"
          style={{ width: `${sellPct}%`, background: 'linear-gradient(to right,#ef5350,#b71c1c)' }} />
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export function OrderFlowPanel() {
  const { price: livePrice, marketOpen } = useLivePrice();
  const marketClosed = marketOpen === false;
  // Uses existing /chart endpoint — no new backend needed
  const { data, isLoading, isError } = useQuery<{ candles: Candle[] }>({
    queryKey: ['xauusd/chart', '5m'],
    queryFn: async () => {
      const r = await fetch(`${API_BASE}/api/xauusd/chart?interval=5m`, { credentials: 'include' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    refetchInterval: marketClosed ? false : 60_000,
    staleTime:       55_000,
    retry: 1,
  });

  const flow: Computed | null = React.useMemo(() => {
    const candles = data?.candles;
    if (!Array.isArray(candles) || candles.length < 5) return null;
    return computeFlow(candles.slice(-36)); // last 3h of 5m bars
  }, [data]);

  const deltaColor = flow?.deltaSign === 'positive' ? '#26a69a'
    : flow?.deltaSign === 'negative' ? '#ef5350' : '#758696';

  const [showChart, setShowChart] = useState(false);

  const fmtVol = (v: number) =>
    v >= 1_000_000 ? (v / 1_000_000).toFixed(1) + 'M'
    : v >= 1_000   ? (v / 1_000).toFixed(0)     + 'K'
    : v.toString();

  return (
    <div className="rounded-lg overflow-hidden" style={{ background: '#0d0d14', border: '1px solid #2a2a3e' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b" style={{ borderColor: '#1a1a2e' }}>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono font-bold tracking-[0.18em] uppercase" style={{ color: '#f0b90b' }}>
            XAU/USD
          </span>
          <span className="text-[10px] font-mono font-bold tracking-[0.12em] uppercase" style={{ color: '#758696' }}>
            Order Flow
          </span>
        </div>
        {flow && (
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] font-mono font-bold" style={{ color: deltaColor }}>
              Δ {flow.cumDelta >= 0 ? '+' : ''}{fmtVol(flow.cumDelta)}
            </span>
            <span
              className="text-[9px] font-mono font-bold uppercase tracking-widest px-1.5 py-0.5 rounded"
              style={{ color: deltaColor, background: deltaColor + '22', border: `1px solid ${deltaColor}44` }}
            >
              {flow.deltaSign === 'positive' ? 'BUY PRESSURE'
                : flow.deltaSign === 'negative' ? 'SELL PRESSURE' : 'NEUTRAL'}
            </span>
          </div>
        )}
      </div>

      <div className="p-3 flex flex-col gap-3">
        {isLoading && !flow ? (
          <div className="flex items-center justify-center h-24">
            <div className="flex flex-col items-center gap-2">
              <div className="w-6 h-6 border-2 border-[#f0b90b] border-t-transparent rounded-full animate-spin" />
              <span className="text-[10px] font-mono text-[#758696]">Loading flow data...</span>
            </div>
          </div>
        ) : isError && !flow ? (
          <div className="flex items-center justify-center h-24">
            <span className="text-[10px] font-mono text-[#ef5350]">Failed to load chart data</span>
          </div>
        ) : flow ? (
          <>
            <PressureBar buyPct={flow.buyPct} sellPct={flow.sellPct} />

            {/* Stats */}
            <div className="grid grid-cols-4 gap-2">
              {[
                { label: 'Buy Vol',  value: fmtVol(flow.totalBuyVol),  color: '#26a69a' },
                { label: 'Sell Vol', value: fmtVol(flow.totalSellVol), color: '#ef5350' },
                { label: 'Cum Δ',   value: (flow.cumDelta >= 0 ? '+' : '') + fmtVol(flow.cumDelta), color: deltaColor },
                { label: 'Price',   value: (typeof livePrice === 'number' ? livePrice : flow.price).toFixed(2), color: '#d1d4dc' },
              ].map(s => (
                <div key={s.label} className="flex flex-col items-center rounded-md py-2"
                  style={{ background: '#0a0a12', border: '1px solid #1a1a2e' }}>
                  <span className="text-[8px] font-mono uppercase tracking-widest mb-1" style={{ color: '#758696' }}>
                    {s.label}
                  </span>
                  <span className="text-xs font-mono font-bold tabular-nums" style={{ color: s.color }}>
                    {s.value}
                  </span>
                </div>
              ))}
            </div>

            {/* Delta bars */}
            <div>
              <div
                className="flex items-center justify-between mb-1.5 cursor-pointer select-none"
                onClick={() => setShowChart(v => !v)}
              >
                <span className="text-[9px] font-mono uppercase tracking-widest" style={{ color: '#758696' }}>
                  Delta Bars (5m) + Cumulative Δ
                </span>
                <div className="flex items-center gap-3">
                  {showChart && (
                    <>
                      {[
                        { color: '#26a69a', label: 'Buy' },
                        { color: '#ef5350', label: 'Sell' },
                      ].map(l => (
                        <div key={l.label} className="flex items-center gap-1">
                          <div className="w-2 h-2 rounded-sm" style={{ background: l.color }} />
                          <span className="text-[9px] font-mono" style={{ color: '#758696' }}>{l.label}</span>
                        </div>
                      ))}
                      <div className="flex items-center gap-1">
                        <div className="w-4 h-px" style={{ borderTop: '1px dashed #f0b90b' }} />
                        <span className="text-[9px] font-mono" style={{ color: '#758696' }}>Cum Δ</span>
                      </div>
                    </>
                  )}
                  {showChart
                    ? <ChevronUp className="w-3 h-3" style={{ color: '#758696' }} />
                    : <ChevronDown className="w-3 h-3" style={{ color: '#758696' }} />
                  }
                </div>
              </div>
              {showChart && <DeltaCanvas bars={flow.bars} />}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
