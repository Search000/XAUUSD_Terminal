import React, { useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { API_BASE } from '@/lib/api';
import { useLivePrice } from '@/hooks/use-live-price';

interface Stock {
  sym: string;
  name: string;
  current: number | null;
  prevClose: number;
  change: number | null;
  changePct: number | null;
  sparkline: number[];
}
interface MiningResponse {
  stocks: Stock[];
  updatedAt: number;
}

function Sparkline({ data, positive }: { data: number[]; positive: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data.length) return;
    const dpr = window.devicePixelRatio || 1;
    const W = 80, H = 32;
    canvas.width  = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width  = W + 'px';
    canvas.style.height = H + 'px';
    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);

    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    const PAD = 3;

    const pts = data.map((v, i) => ({
      x: PAD + (i / (data.length - 1)) * (W - PAD * 2),
      y: H - PAD - ((v - min) / range) * (H - PAD * 2),
    }));

    // Fill
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, positive ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.beginPath();
    ctx.moveTo(pts[0].x, H);
    pts.forEach(p => ctx.lineTo(p.x, p.y));
    ctx.lineTo(pts[pts.length - 1].x, H);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Line
    ctx.beginPath();
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.strokeStyle = positive ? '#22c55e' : '#ef4444';
    ctx.lineWidth   = 1.5;
    ctx.lineJoin    = 'round';
    ctx.stroke();

    // Dot at end
    const last = pts[pts.length - 1];
    ctx.beginPath();
    ctx.arc(last.x, last.y, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = positive ? '#22c55e' : '#ef4444';
    ctx.fill();
  }, [data, positive]);

  return <canvas ref={canvasRef} style={{ width: 80, height: 32 }} />;
}

export function MiningStocks() {
  const { marketOpen } = useLivePrice();
  const { data, isLoading, dataUpdatedAt } = useQuery<MiningResponse>({
    queryKey: ['xauusd/mining-stocks'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/xauusd/mining-stocks`, { credentials: 'include' });
      if (!res.ok) throw new Error('fetch failed');
      return res.json();
    },
    // Uses the gold-market open flag as an approximation — these are NYSE
    // stocks so their real hours differ slightly on weekdays, but both are
    // closed on weekends, which is the case this mainly guards against.
    refetchInterval: marketOpen === false ? false : 60_000,
    staleTime: 60_000,
  });

  const stocks = data?.stocks ?? [];
  const updatedStr = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
            <span className="text-lg">⛏️</span> Gold Mining Stocks
          </h3>
          <p className="text-xs text-zinc-500 mt-0.5">ETFs & miners · 1-min refresh</p>
        </div>
        {updatedStr && (
          <span className="text-xs text-zinc-500 bg-zinc-800 px-2 py-0.5 rounded">
            {updatedStr}
          </span>
        )}
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center h-[240px]">
          <div className="flex flex-col items-center gap-2">
            <div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-xs text-zinc-500">Fetching prices…</span>
          </div>
        </div>
      ) : stocks.length === 0 ? (
        <div className="flex items-center justify-center h-[240px] text-zinc-500 text-xs">
          No data available
        </div>
      ) : (
        <div className="flex flex-col divide-y divide-zinc-800">
          {/* Column headers */}
          <div className="grid grid-cols-[2fr_3fr_2fr_1.5fr_2.5fr] gap-2 pb-2 text-xs text-zinc-500 px-1">
            <span>Ticker</span>
            <span>Name</span>
            <span className="text-right">Price</span>
            <span className="text-right">Chg%</span>
            <span className="text-right">5D</span>
          </div>

          {stocks.map(s => {
            const pos      = (s.changePct ?? 0) >= 0;
            const priceStr = s.current != null ? `$${s.current.toFixed(2)}` : '—';
            const chgStr   = s.changePct != null
              ? `${s.changePct >= 0 ? '+' : ''}${s.changePct.toFixed(2)}%`
              : '—';

            return (
              <div
                key={s.sym}
                className="grid grid-cols-[2fr_3fr_2fr_1.5fr_2.5fr] gap-2 py-2 px-1 items-center hover:bg-zinc-800/50 rounded transition-colors"
              >
                {/* Ticker */}
                <span className="text-xs font-bold text-amber-400">{s.sym}</span>

                {/* Name */}
                <span className="text-xs text-zinc-400 truncate">{s.name}</span>

                {/* Price */}
                <span className="text-xs font-semibold text-zinc-100 text-right">{priceStr}</span>

                {/* Change % */}
                <span className={`text-xs font-semibold text-right ${pos ? 'text-green-400' : 'text-red-400'}`}>
                  {chgStr}
                </span>

                {/* Sparkline */}
                <div className="flex justify-end">
                  {s.sparkline.length >= 2 ? (
                    <Sparkline data={s.sparkline} positive={pos} />
                  ) : (
                    <span className="text-xs text-zinc-600 w-[80px] text-right">—</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Summary row */}
      {stocks.length > 0 && (() => {
        const rising  = stocks.filter(s => (s.changePct ?? 0) > 0).length;
        const falling = stocks.filter(s => (s.changePct ?? 0) < 0).length;
        const avgChg  = stocks.reduce((s, x) => s + (x.changePct ?? 0), 0) / stocks.length;
        return (
          <div className="grid grid-cols-3 gap-2 border-t border-zinc-800 pt-3">
            {[
              { label: 'Rising', val: `${rising}/${stocks.length}`, color: 'text-green-400' },
              { label: 'Avg Change', val: `${avgChg >= 0 ? '+' : ''}${avgChg.toFixed(2)}%`, color: avgChg >= 0 ? 'text-green-400' : 'text-red-400' },
              { label: 'Falling', val: `${falling}/${stocks.length}`, color: 'text-red-400' },
            ].map(s => (
              <div key={s.label} className="text-center">
                <div className={`text-sm font-semibold ${s.color}`}>{s.val}</div>
                <div className="text-xs text-zinc-500">{s.label}</div>
              </div>
            ))}
          </div>
        );
      })()}
    </div>
  );
}
