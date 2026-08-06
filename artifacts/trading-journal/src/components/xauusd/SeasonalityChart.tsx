import React, { useRef, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { API_BASE } from '@/lib/api';

interface MonthData {
  month: string;
  short: string;
  avg: number;
  median: number;
  bullPct: number;
  count: number;
}

interface SeasonalityResponse {
  months: MonthData[];
  firstYear: number;
  lastYear: number;
  updatedAt: number;
}

const CURRENT_MONTH = new Date().getMonth(); // 0-indexed

type Mode = 'avg' | 'bullpct';

export function SeasonalityChart() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<Mode>('avg');
  const [hovered, setHovered] = useState<number | null>(null);

  const { data, isLoading } = useQuery<SeasonalityResponse>({
    queryKey: ['xauusd/seasonality'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/xauusd/seasonality`, { credentials: 'include' });
      if (!res.ok) throw new Error('seasonality fetch failed');
      return res.json();
    },
    staleTime: 24 * 60 * 60 * 1000, // 24h — monthly data barely changes
    gcTime:    24 * 60 * 60 * 1000,
  });

  const months = data?.months ?? [];

  useEffect(() => {
    if (!months.length) return;

    const draw = () => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const dpr = window.devicePixelRatio || 1;
      const W = container.clientWidth;
      const H = container.clientHeight;
      canvas.width  = W * dpr;
      canvas.height = H * dpr;
      canvas.style.width  = W + 'px';
      canvas.style.height = H + 'px';
      ctx.scale(dpr, dpr);

      const PAD = { top: 24, right: 12, bottom: 36, left: 44 };
      const pw = W - PAD.left - PAD.right;
      const ph = H - PAD.top  - PAD.bottom;

      ctx.fillStyle = '#0d0d14';
      ctx.fillRect(0, 0, W, H);

      const n = months.length;
      const barW = pw / n;
      const gap  = barW * 0.18;
      const bw   = barW - gap;

      // Values: avg % or bull% centered on 50
      const values = months.map(d => mode === 'avg' ? d.avg : (d.bullPct - 50));
      const maxV = Math.max(...values.map(Math.abs), 0.5);
      const zeroY = PAD.top + ph / 2;

      // Grid lines
      [-maxV, -maxV / 2, 0, maxV / 2, maxV].forEach(v => {
        const y = zeroY - (v / maxV) * (ph / 2);
        ctx.beginPath();
        ctx.moveTo(PAD.left, y);
        ctx.lineTo(W - PAD.right, y);
        ctx.strokeStyle = v === 0 ? '#2a2a3e' : '#1a1a2e';
        ctx.lineWidth = v === 0 ? 1.5 : 0.5;
        ctx.stroke();

        const lbl = mode === 'avg'
          ? (v >= 0 ? '+' : '') + v.toFixed(1) + '%'
          : (v >= 0 ? '+' : '') + v.toFixed(0) + '%';
        ctx.fillStyle = '#3a3a4e';
        ctx.font = '9px monospace';
        ctx.textAlign = 'right';
        ctx.fillText(lbl, PAD.left - 4, y + 3);
      });

      months.forEach((d, i) => {
        const val    = values[i];
        const x      = PAD.left + i * barW + gap / 2;
        const barH   = (Math.abs(val) / maxV) * (ph / 2);
        const y      = val >= 0 ? zeroY - barH : zeroY;
        const isCur  = i === CURRENT_MONTH;
        const isHov  = i === hovered;
        const isPos  = val >= 0;

        ctx.globalAlpha = isCur ? 1.0 : isHov ? 0.85 : 0.65;
        ctx.fillStyle   = isPos ? '#26a69a' : '#ef5350';

        const r = Math.min(3, bw / 4);
        ctx.beginPath();
        if (val >= 0) {
          ctx.moveTo(x, y + barH);
          ctx.lineTo(x, y + r);
          ctx.quadraticCurveTo(x, y, x + r, y);
          ctx.lineTo(x + bw - r, y);
          ctx.quadraticCurveTo(x + bw, y, x + bw, y + r);
          ctx.lineTo(x + bw, y + barH);
        } else {
          ctx.moveTo(x, y);
          ctx.lineTo(x + bw, y);
          ctx.lineTo(x + bw, y + barH - r);
          ctx.quadraticCurveTo(x + bw, y + barH, x + bw - r, y + barH);
          ctx.lineTo(x + r, y + barH);
          ctx.quadraticCurveTo(x, y + barH, x, y + barH - r);
        }
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;

        if (isCur) {
          ctx.strokeStyle = '#f0b90b';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }

        if (barH > 12) {
          const lbl = mode === 'avg'
            ? (val >= 0 ? '+' : '') + val.toFixed(1) + '%'
            : (val >= 0 ? '+' : '') + val.toFixed(0) + '%';
          ctx.fillStyle = '#fff';
          ctx.globalAlpha = 0.9;
          ctx.font = 'bold 9px monospace';
          ctx.textAlign = 'center';
          ctx.fillText(lbl, x + bw / 2, val >= 0 ? y + 10 : y + barH - 4);
          ctx.globalAlpha = 1;
        }

        ctx.fillStyle = isCur ? '#f0b90b' : isHov ? '#d1d4dc' : '#758696';
        ctx.font = isCur ? 'bold 9px monospace' : '9px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(d.short, x + bw / 2, H - PAD.bottom + 14);

        if (isCur) {
          ctx.fillStyle = '#f0b90b';
          ctx.beginPath();
          const tx = x + bw / 2;
          const ty = H - PAD.bottom + 22;
          ctx.moveTo(tx - 3, ty); ctx.lineTo(tx + 3, ty); ctx.lineTo(tx, ty - 4);
          ctx.fill();
        }
      });

      // Hover tooltip
      if (hovered !== null && months[hovered]) {
        const d   = months[hovered];
        const val = values[hovered];
        const bx  = PAD.left + hovered * barW + gap / 2 + bw / 2;
        const by  = val >= 0 ? zeroY - (Math.abs(val) / maxV) * (ph / 2) : zeroY;
        const tipW = 130, tipH = 62;
        let tx = bx - tipW / 2;
        const ty = val >= 0 ? by - tipH - 6 : by + Math.abs(val / maxV) * (ph / 2) + 6;
        tx = Math.max(PAD.left, Math.min(W - PAD.right - tipW, tx));

        ctx.fillStyle = '#1a1a2e';
        ctx.strokeStyle = '#2a2a3e';
        ctx.lineWidth = 1;
        ctx.beginPath();
        // @ts-ignore
        ctx.roundRect(tx, ty, tipW, tipH, 4);
        ctx.fill(); ctx.stroke();

        ctx.fillStyle = '#f0b90b';
        ctx.font = 'bold 10px monospace';
        ctx.textAlign = 'left';
        ctx.fillText(d.month, tx + 8, ty + 16);

        ctx.fillStyle = d.avg >= 0 ? '#26a69a' : '#ef5350';
        ctx.font = '9px monospace';
        ctx.fillText(`Avg: ${d.avg >= 0 ? '+' : ''}${d.avg.toFixed(2)}%`, tx + 8, ty + 30);
        ctx.fillStyle = '#9598a1';
        ctx.fillText(`Bull: ${d.bullPct}% of years`, tx + 8, ty + 43);
        ctx.fillText(`${d.count} years of data`, tx + 8, ty + 56);
      }
    };

    draw();
    window.addEventListener('resize', draw);
    return () => window.removeEventListener('resize', draw);
  }, [mode, hovered, months]);

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pw = container.clientWidth - 44 - 12;
    const barW = pw / 12;
    const i = Math.floor((x - 44) / barW);
    setHovered(i >= 0 && i < 12 ? i : null);
  };

  const bestMonth  = months.length ? months.reduce((a, b) => a.avg > b.avg ? a : b) : null;
  const worstMonth = months.length ? months.reduce((a, b) => a.avg < b.avg ? a : b) : null;
  const currentD   = months[CURRENT_MONTH];
  const yearRange  = data ? `${data.firstYear}–${data.lastYear}` : '—';

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
            📅 SEASONALITY
          </span>
          <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={{ background: '#1a1a2e', color: '#758696' }}>
            GOLD {yearRange}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {(['avg', 'bullpct'] as Mode[]).map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className="text-[9px] font-mono font-bold px-2 py-0.5 rounded transition-all"
              style={{
                background: mode === m ? '#f0b90b' : '#1a1a2e',
                color:      mode === m ? '#000'    : '#758696',
                border: `1px solid ${mode === m ? '#f0b90b' : '#2a2a3e'}`,
              }}
            >
              {m === 'avg' ? 'AVG %' : 'BULL %'}
            </button>
          ))}
        </div>
      </div>

      {isLoading || !months.length ? (
        <div className="flex items-center justify-center" style={{ height: 200 }}>
          <div className="flex flex-col items-center gap-2">
            <div className="w-6 h-6 border-2 border-[#f0b90b] border-t-transparent rounded-full animate-spin" />
            <span className="text-[9px] font-mono" style={{ color: '#758696' }}>Fetching historical data…</span>
          </div>
        </div>
      ) : (
        <div ref={containerRef} style={{ height: 200, position: 'relative' }}>
          <canvas
            ref={canvasRef}
            style={{ width: '100%', height: '100%', display: 'block', cursor: 'crosshair' }}
            onMouseMove={handleMouseMove}
            onMouseLeave={() => setHovered(null)}
          />
        </div>
      )}

      {/* Summary row */}
      <div
        className="grid grid-cols-3 gap-px"
        style={{ borderTop: '1px solid #1a1a2e', background: '#1a1a2e' }}
      >
        {[
          {
            label: 'BEST MONTH',
            value: bestMonth?.short ?? '—',
            sub:   bestMonth ? `+${bestMonth.avg.toFixed(2)}%` : '',
            color: '#26a69a',
          },
          {
            label: 'THIS MONTH',
            value: currentD?.short ?? '—',
            sub:   currentD ? `${currentD.avg >= 0 ? '+' : ''}${currentD.avg.toFixed(2)}% avg` : '',
            color: currentD?.avg != null && currentD.avg >= 0 ? '#26a69a' : '#ef5350',
          },
          {
            label: 'WORST MONTH',
            value: worstMonth?.short ?? '—',
            sub:   worstMonth ? `${worstMonth.avg.toFixed(2)}%` : '',
            color: '#ef5350',
          },
        ].map(item => (
          <div key={item.label} className="flex flex-col items-center justify-center py-2.5" style={{ background: '#0d0d14' }}>
            <span className="text-[9px] font-mono font-bold tracking-widest uppercase mb-1" style={{ color: '#758696' }}>
              {item.label}
            </span>
            <span className="text-sm font-mono font-bold" style={{ color: item.color }}>{item.value}</span>
            <span className="text-[9px] font-mono" style={{ color: item.color }}>{item.sub}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
