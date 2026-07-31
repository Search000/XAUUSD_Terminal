import React, { useRef, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { API_BASE } from '@/lib/api';

interface DataPoint {
  year: number;
  cpi: number | null;
  gold: number | null;
}
interface InflationResponse {
  points: DataPoint[];
  updatedAt: number;
}

function fmt(n: number, sign = true) {
  return (sign && n >= 0 ? '+' : '') + n.toFixed(1) + '%';
}

export function InflationVsGold() {
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<number | null>(null);

  const { data, isLoading } = useQuery<InflationResponse>({
    queryKey: ['xauusd/inflation-vs-gold'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/xauusd/inflation-vs-gold`, { credentials: 'include' });
      if (!res.ok) throw new Error('fetch failed');
      return res.json();
    },
    staleTime: 24 * 60 * 60 * 1000,
    gcTime:    24 * 60 * 60 * 1000,
  });

  const points = data?.points ?? [];

  useEffect(() => {
    if (!points.length) return;
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

      const PAD = { top: 28, right: 52, bottom: 32, left: 48 };
      const pw = W - PAD.left - PAD.right;
      const ph = H - PAD.top  - PAD.bottom;

      ctx.fillStyle = '#0d0d14';
      ctx.fillRect(0, 0, W, H);

      const validCpi  = points.filter(p => p.cpi  !== null).map(p => p.cpi!);
      const validGold = points.filter(p => p.gold !== null).map(p => p.gold!);
      const cpiMin  = Math.min(...validCpi,  0) - 0.5;
      const cpiMax  = Math.max(...validCpi,  0) + 0.5;
      const goldMin = Math.min(...validGold, 0) - 5;
      const goldMax = Math.max(...validGold, 0) + 5;

      const toX    = (i: number) => PAD.left + (i / (points.length - 1)) * pw;
      const toCpiY = (v: number) => PAD.top + ph - ((v - cpiMin) / (cpiMax - cpiMin)) * ph;
      const toGoldY = (v: number) => PAD.top + ph - ((v - goldMin) / (goldMax - goldMin)) * ph;

      // Grid lines
      const gridCount = 5;
      for (let g = 0; g <= gridCount; g++) {
        const y = PAD.top + (g / gridCount) * ph;
        ctx.beginPath();
        ctx.moveTo(PAD.left, y);
        ctx.lineTo(W - PAD.right, y);
        ctx.strokeStyle = '#1a1a2e';
        ctx.lineWidth = 0.5;
        ctx.stroke();

        // Left axis (CPI)
        const cpiVal = cpiMax - (g / gridCount) * (cpiMax - cpiMin);
        ctx.fillStyle = '#26a69a';
        ctx.font = '8px monospace';
        ctx.textAlign = 'right';
        ctx.fillText(fmt(cpiVal), PAD.left - 4, y + 3);

        // Right axis (Gold %)
        const goldVal = goldMax - (g / gridCount) * (goldMax - goldMin);
        ctx.fillStyle = '#f0b90b';
        ctx.font = '8px monospace';
        ctx.textAlign = 'left';
        ctx.fillText(fmt(goldVal), W - PAD.right + 4, y + 3);
      }

      // Zero line
      if (cpiMin < 0 && cpiMax > 0) {
        const zy = toCpiY(0);
        ctx.beginPath();
        ctx.moveTo(PAD.left, zy);
        ctx.lineTo(W - PAD.right, zy);
        ctx.strokeStyle = '#2a2a3e';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // CPI bars (background)
      const barW = Math.max(2, pw / points.length * 0.55);
      points.forEach((p, i) => {
        if (p.cpi === null) return;
        const x    = toX(i);
        const zeroY = toCpiY(0);
        const barY  = p.cpi >= 0 ? toCpiY(p.cpi) : zeroY;
        const barH  = Math.abs(toCpiY(p.cpi) - zeroY);
        ctx.fillStyle = p.cpi >= 0 ? 'rgba(38,166,154,0.25)' : 'rgba(239,83,80,0.25)';
        ctx.fillRect(x - barW / 2, barY, barW, barH);
      });

      // Gold % change line
      ctx.beginPath();
      let goldStarted = false;
      points.forEach((p, i) => {
        if (p.gold === null) return;
        const x = toX(i);
        const y = toGoldY(p.gold);
        if (!goldStarted) { ctx.moveTo(x, y); goldStarted = true; }
        else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = '#f0b90b';
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.stroke();

      // Gold dots
      points.forEach((p, i) => {
        if (p.gold === null) return;
        ctx.beginPath();
        ctx.arc(toX(i), toGoldY(p.gold), i === hovered ? 4 : 2.5, 0, Math.PI * 2);
        ctx.fillStyle = '#f0b90b';
        ctx.fill();
      });

      // X axis labels (every 5 years)
      points.forEach((p, i) => {
        if (p.year % 5 !== 0) return;
        ctx.fillStyle = '#3a3a4e';
        ctx.font = '8px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(String(p.year), toX(i), H - PAD.bottom + 12);
      });

      // Hover tooltip
      if (hovered !== null && points[hovered]) {
        const p   = points[hovered];
        const x   = toX(hovered);
        const tipW = 130, tipH = 62;
        let tx = x - tipW / 2;
        const ty = PAD.top;
        tx = Math.max(PAD.left, Math.min(W - PAD.right - tipW, tx));

        ctx.fillStyle = '#1a1a2e';
        ctx.strokeStyle = '#2a2a3e';
        ctx.lineWidth = 1;
        ctx.beginPath();
        // @ts-ignore
        ctx.roundRect(tx, ty, tipW, tipH, 4);
        ctx.fill(); ctx.stroke();

        // Vertical crosshair
        ctx.beginPath();
        ctx.moveTo(x, PAD.top + 10);
        ctx.lineTo(x, H - PAD.bottom);
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = '#d1d4dc';
        ctx.font = 'bold 10px monospace';
        ctx.textAlign = 'left';
        ctx.fillText(String(p.year), tx + 8, ty + 16);

        ctx.fillStyle = '#26a69a';
        ctx.font = '9px monospace';
        ctx.fillText(`CPI: ${p.cpi !== null ? fmt(p.cpi) : 'N/A'}`, tx + 8, ty + 30);

        ctx.fillStyle = '#f0b90b';
        ctx.fillText(`Gold: ${p.gold !== null ? fmt(p.gold) : 'N/A'}`, tx + 8, ty + 43);

        // Divergence
        if (p.cpi !== null && p.gold !== null) {
          const diff = p.gold - p.cpi;
          ctx.fillStyle = diff >= 0 ? '#26a69a' : '#ef5350';
          ctx.fillText(`Gap: ${fmt(diff)}`, tx + 8, ty + 56);
        }
      }

      // Axis labels
      ctx.fillStyle = '#26a69a';
      ctx.font = 'bold 8px monospace';
      ctx.textAlign = 'left';
      ctx.save();
      ctx.translate(10, PAD.top + ph / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = 'center';
      ctx.fillText('CPI %', 0, 0);
      ctx.restore();

      ctx.fillStyle = '#f0b90b';
      ctx.save();
      ctx.translate(W - 8, PAD.top + ph / 2);
      ctx.rotate(Math.PI / 2);
      ctx.textAlign = 'center';
      ctx.fillText('GOLD %', 0, 0);
      ctx.restore();
    };
    draw();
    window.addEventListener('resize', draw);
    return () => window.removeEventListener('resize', draw);
  }, [points, hovered]);

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || !points.length) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pw = container.clientWidth - 48 - 52;
    const i = Math.round(((x - 48) / pw) * (points.length - 1));
    setHovered(i >= 0 && i < points.length ? i : null);
  };

  // Stats
  const posGold  = points.filter(p => p.gold !== null && p.gold! > 0).length;
  const highCpi  = points.filter(p => p.cpi !== null && p.cpi! > 5);
  const avgGoldHighCpi = highCpi.length
    ? highCpi.reduce((s, p) => s + (p.gold ?? 0), 0) / highCpi.length
    : null;

  return (
    <div className="rounded-xl overflow-hidden flex flex-col" style={{ background: '#0d0d14', border: '1px solid #1a1a2e' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5" style={{ borderBottom: '1px solid #1a1a2e', background: '#0b0b12' }}>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-mono font-bold tracking-widest uppercase" style={{ color: '#f0b90b' }}>
            📈 INFLATION vs GOLD
          </span>
          <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={{ background: '#1a1a2e', color: '#758696' }}>
            US CPI · Annual
          </span>
        </div>
        <div className="flex items-center gap-3 text-[9px] font-mono">
          <span className="flex items-center gap-1"><span className="w-3 h-0.5 inline-block" style={{ background: '#26a69a' }} />CPI</span>
          <span className="flex items-center gap-1"><span className="w-3 h-0.5 inline-block" style={{ background: '#f0b90b' }} />GOLD %</span>
        </div>
      </div>

      {isLoading || !points.length ? (
        <div className="flex items-center justify-center" style={{ height: 220 }}>
          <div className="flex flex-col items-center gap-2">
            <div className="w-6 h-6 border-2 border-[#f0b90b] border-t-transparent rounded-full animate-spin" />
            <span className="text-[9px] font-mono" style={{ color: '#758696' }}>Fetching CPI & Gold data…</span>
          </div>
        </div>
      ) : (
        <div ref={containerRef} style={{ height: 220, position: 'relative' }}>
          <canvas
            ref={canvasRef}
            style={{ width: '100%', height: '100%', display: 'block', cursor: 'crosshair' }}
            onMouseMove={handleMouseMove}
            onMouseLeave={() => setHovered(null)}
          />
        </div>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-px" style={{ borderTop: '1px solid #1a1a2e', background: '#1a1a2e' }}>
        {[
          { label: 'BULL YEARS', value: `${posGold}/${points.length}`, sub: 'gold positive', color: '#26a69a' },
          { label: 'HIGH CPI YEARS', value: highCpi.length ? String(highCpi.length) : '—', sub: 'CPI > 5%', color: '#f0b90b' },
          { label: 'GOLD vs HIGH CPI', value: avgGoldHighCpi != null ? fmt(avgGoldHighCpi) : '—', sub: 'avg when CPI>5%', color: avgGoldHighCpi != null && avgGoldHighCpi >= 0 ? '#26a69a' : '#ef5350' },
        ].map(item => (
          <div key={item.label} className="flex flex-col items-center justify-center py-2.5" style={{ background: '#0d0d14' }}>
            <span className="text-[9px] font-mono font-bold tracking-widest uppercase mb-1" style={{ color: '#758696' }}>{item.label}</span>
            <span className="text-sm font-mono font-bold" style={{ color: item.color }}>{item.value}</span>
            <span className="text-[9px] font-mono" style={{ color: '#758696' }}>{item.sub}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
