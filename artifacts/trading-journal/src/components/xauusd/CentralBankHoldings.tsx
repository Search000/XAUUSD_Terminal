import React, { useRef, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { API_BASE } from '@/lib/api';

interface Holding {
  country: string;
  tonnes: number;
  year: number;
}
interface CBHResponse {
  holdings: Holding[];
  dataYear: number;
  updatedAt: number;
}

export function CentralBankHoldings() {
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);
  const [hovered, setHovered]   = useState<number | null>(null);
  const [canvasW, setCanvasW]   = useState(600);

  const { data, isLoading } = useQuery<CBHResponse>({
    queryKey: ['xauusd/central-bank-holdings'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/xauusd/central-bank-holdings`, { credentials: 'include' });
      if (!res.ok) throw new Error('fetch failed');
      return res.json();
    },
    staleTime: 24 * 60 * 60 * 1000,
    gcTime:    24 * 60 * 60 * 1000,
  });

  // Top 12
  const holdings = (data?.holdings ?? []).slice(0, 12);

  /* ── Resize observer ──
     Uses a state-backed callback ref (not useRef) because this container
     only mounts once loading finishes — a plain useRef + useEffect([]) would
     run before the node exists and never observe it, leaving canvasW stuck
     at its 600px default and overflowing narrower cards. */
  useEffect(() => {
    if (!containerEl) return;
    setCanvasW(containerEl.clientWidth);
    const ro = new ResizeObserver(([e]) => setCanvasW(e.contentRect.width));
    ro.observe(containerEl);
    return () => ro.disconnect();
  }, [containerEl]);

  /* ── Draw ── */
  useEffect(() => {
    if (!holdings.length) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const W   = canvasW;
    const H   = 280;
    canvas.width  = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width  = W + 'px';
    canvas.style.height = H + 'px';
    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);

    const PAD_L = 90, PAD_R = 16, PAD_T = 12, PAD_B = 24;
    const chartW = W - PAD_L - PAD_R;
    const chartH = H - PAD_T - PAD_B;
    const n = holdings.length;
    const barH    = Math.floor(chartH / n * 0.68);
    const gapH    = Math.floor(chartH / n);
    const maxVal  = holdings[0].tonnes;

    // Gold tier colours
    const goldGrad = (ctx: CanvasRenderingContext2D, x: number, w: number, i: number) => {
      const g = ctx.createLinearGradient(x, 0, x + w, 0);
      if (i === 0) { g.addColorStop(0, '#f59e0b'); g.addColorStop(1, '#fbbf24'); }
      else if (i === 1) { g.addColorStop(0, '#b45309'); g.addColorStop(1, '#d97706'); }
      else if (i === 2) { g.addColorStop(0, '#78350f'); g.addColorStop(1, '#92400e'); }
      else { g.addColorStop(0, '#44403c'); g.addColorStop(1, '#57534e'); }
      return g;
    };

    holdings.forEach((h, i) => {
      const barW   = (h.tonnes / maxVal) * chartW;
      const y      = PAD_T + i * gapH + (gapH - barH) / 2;
      const isHov  = hovered === i;

      // Bar
      ctx.fillStyle = goldGrad(ctx, PAD_L, barW, i);
      ctx.globalAlpha = isHov ? 1 : 0.88;
      roundRect(ctx, PAD_L, y, Math.max(barW, 2), barH, 3);
      ctx.fill();
      ctx.globalAlpha = 1;

      // Hover highlight border
      if (isHov) {
        ctx.strokeStyle = '#fcd34d';
        ctx.lineWidth   = 1.5;
        roundRect(ctx, PAD_L, y, barW, barH, 3);
        ctx.stroke();
      }

      // Country label
      ctx.fillStyle   = isHov ? '#fcd34d' : '#d4d4d8';
      ctx.font        = `${isHov ? 600 : 400} 11px system-ui`;
      ctx.textAlign   = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(h.country, PAD_L - 6, y + barH / 2);

      // Value label inside / outside bar
      ctx.fillStyle   = barW > 60 ? '#fff' : '#a3a3a3';
      ctx.font        = '10px system-ui';
      ctx.textAlign   = barW > 60 ? 'right' : 'left';
      const vx = barW > 60 ? PAD_L + barW - 5 : PAD_L + barW + 4;
      ctx.fillText(h.tonnes.toLocaleString() + 't', vx, y + barH / 2);
    });

    // X-axis grid lines
    const ticks = [0, 1000, 2000, 4000, 6000, 8000, 10000].filter(t => t <= maxVal * 1.05);
    ctx.strokeStyle = '#3f3f46';
    ctx.lineWidth   = 0.5;
    ctx.font        = '9px system-ui';
    ctx.fillStyle   = '#71717a';
    ctx.textAlign   = 'center';
    ctx.textBaseline = 'top';
    ticks.forEach(t => {
      const x = PAD_L + (t / maxVal) * chartW;
      ctx.beginPath(); ctx.moveTo(x, PAD_T); ctx.lineTo(x, H - PAD_B); ctx.stroke();
      if (t > 0) ctx.fillText(t >= 1000 ? `${t / 1000}k` : String(t), x, H - PAD_B + 4);
    });
  }, [holdings, hovered, canvasW]);

  /* ── Mouse hit-test ── */
  const onMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!holdings.length) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    const H    = 280;
    const n    = holdings.length;
    const PAD_T = 12, PAD_B = 24;
    const chartH = H - PAD_T - PAD_B;
    const gapH   = chartH / n;
    const my = e.clientY - rect.top;
    const idx = Math.floor((my - PAD_T) / gapH);
    setHovered(idx >= 0 && idx < n ? idx : null);
  };

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
            <span className="text-lg">🏦</span> Central Bank Gold Reserves
          </h3>
          <p className="text-xs text-zinc-500 mt-0.5">Official holdings · Top 12 nations · tonnes</p>
        </div>
        {data && (
          <span className="text-xs text-zinc-500 bg-zinc-800 px-2 py-0.5 rounded">
            IMF {data.dataYear}
          </span>
        )}
      </div>

      {/* Chart */}
      {isLoading ? (
        <div className="flex items-center justify-center h-[280px]">
          <div className="flex flex-col items-center gap-2">
            <div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-xs text-zinc-500">Loading IMF data…</span>
          </div>
        </div>
      ) : holdings.length === 0 ? (
        <div className="flex items-center justify-center h-[280px] text-zinc-500 text-xs">
          No data available
        </div>
      ) : (
        <div ref={setContainerEl} className="w-full">
          <canvas
            ref={canvasRef}
            className="w-full cursor-crosshair"
            style={{ height: 280, maxWidth: '100%' }}
            onMouseMove={onMouseMove}
            onMouseLeave={() => setHovered(null)}
          />
        </div>
      )}

      {/* Tooltip row */}
      {hovered !== null && holdings[hovered] && (
        <div className="flex items-center gap-4 bg-zinc-800 rounded-lg px-3 py-2 text-xs">
          <span className="font-semibold text-amber-400">{holdings[hovered].country}</span>
          <span className="text-zinc-300">{holdings[hovered].tonnes.toLocaleString()} tonnes</span>
          <span className="text-zinc-500">
            {((holdings[hovered].tonnes / holdings[0].tonnes) * 100).toFixed(1)}% of USA
          </span>
        </div>
      )}

      {/* Bottom stats */}
      {holdings.length > 0 && (
        <div className="grid grid-cols-3 gap-2 border-t border-zinc-800 pt-3">
          {[
            { label: 'Top Holder', val: holdings[0]?.country, sub: holdings[0]?.tonnes.toLocaleString() + 't' },
            { label: 'Total Top 12', val: holdings.slice(0, 12).reduce((s, h) => s + h.tonnes, 0).toLocaleString() + 't', sub: 'combined' },
            { label: '#2 vs #1', val: ((holdings[1]?.tonnes / holdings[0]?.tonnes) * 100).toFixed(0) + '%', sub: holdings[1]?.country },
          ].map(s => (
            <div key={s.label} className="text-center">
              <div className="text-sm font-semibold text-amber-400">{s.val}</div>
              <div className="text-xs text-zinc-500">{s.label}</div>
              <div className="text-xs text-zinc-600">{s.sub}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
