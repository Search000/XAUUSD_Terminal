import React, { useRef, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { API_BASE } from '@/lib/api';

interface DataPoint {
  year: number;
  fedRate: number | null;
  goldPrice: number | null;
}
interface FedRateResponse {
  points: DataPoint[];
  latestRate: number | null;
  latestDate: string | null;
  updatedAt: number;
}

function fmt2(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function FedRateTracker() {
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<number | null>(null);

  const { data, isLoading } = useQuery<FedRateResponse>({
    queryKey: ['xauusd/fed-rate-vs-gold'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/xauusd/fed-rate-vs-gold`, { credentials: 'include' });
      if (!res.ok) throw new Error('fetch failed');
      return res.json();
    },
    staleTime: 6 * 60 * 60 * 1000,
    gcTime:    6 * 60 * 60 * 1000,
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

      const PAD = { top: 28, right: 56, bottom: 32, left: 44 };
      const pw = W - PAD.left - PAD.right;
      const ph = H - PAD.top  - PAD.bottom;

      ctx.fillStyle = '#0d0d14';
      ctx.fillRect(0, 0, W, H);

      const fedMin = 0;
      const fedMax = Math.max(...points.filter(p => p.fedRate !== null).map(p => p.fedRate!)) + 1;
      const goldMin = Math.min(...points.filter(p => p.goldPrice !== null).map(p => p.goldPrice!)) * 0.9;
      const goldMax = Math.max(...points.filter(p => p.goldPrice !== null).map(p => p.goldPrice!)) * 1.05;

      const toX     = (i: number) => PAD.left + (i / (points.length - 1)) * pw;
      const toFedY  = (v: number) => PAD.top + ph - ((v - fedMin) / (fedMax - fedMin)) * ph;
      const toGoldY = (v: number) => PAD.top + ph - ((v - goldMin) / (goldMax - goldMin)) * ph;

      // Grid
      for (let g = 0; g <= 5; g++) {
        const y = PAD.top + (g / 5) * ph;
        ctx.beginPath();
        ctx.moveTo(PAD.left, y);
        ctx.lineTo(W - PAD.right, y);
        ctx.strokeStyle = '#1a1a2e';
        ctx.lineWidth = 0.5;
        ctx.stroke();

        const fedVal = fedMax - (g / 5) * (fedMax - fedMin);
        ctx.fillStyle = '#ef5350';
        ctx.font = '8px monospace';
        ctx.textAlign = 'right';
        ctx.fillText(fedVal.toFixed(1) + '%', PAD.left - 4, y + 3);

        const goldVal = goldMax - (g / 5) * (goldMax - goldMin);
        ctx.fillStyle = '#f0b90b';
        ctx.font = '8px monospace';
        ctx.textAlign = 'left';
        ctx.fillText('$' + Math.round(goldVal).toLocaleString(), W - PAD.right + 4, y + 3);
      }

      // Fed rate area fill
      ctx.beginPath();
      let firstFed = true;
      let lastFedX = 0, lastFedY = 0;
      points.forEach((p, i) => {
        if (p.fedRate === null) return;
        const x = toX(i); const y = toFedY(p.fedRate);
        if (firstFed) { ctx.moveTo(x, y); firstFed = false; }
        else ctx.lineTo(x, y);
        lastFedX = x; lastFedY = y;
      });
      // Close the area to the bottom
      const validFed = points.filter(p => p.fedRate !== null);
      if (validFed.length) {
        ctx.lineTo(toX(points.indexOf(validFed[validFed.length - 1])), toFedY(0));
        ctx.lineTo(toX(points.indexOf(validFed[0])), toFedY(0));
      }
      ctx.closePath();
      ctx.fillStyle = 'rgba(239,83,80,0.1)';
      ctx.fill();

      // Fed rate line
      ctx.beginPath();
      firstFed = true;
      points.forEach((p, i) => {
        if (p.fedRate === null) return;
        const x = toX(i); const y = toFedY(p.fedRate);
        if (firstFed) { ctx.moveTo(x, y); firstFed = false; }
        else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = '#ef5350';
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.stroke();

      // Gold price line
      ctx.beginPath();
      let firstGold = true;
      points.forEach((p, i) => {
        if (p.goldPrice === null) return;
        const x = toX(i); const y = toGoldY(p.goldPrice);
        if (firstGold) { ctx.moveTo(x, y); firstGold = false; }
        else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = '#f0b90b';
      ctx.lineWidth = 2.5;
      ctx.lineJoin = 'round';
      ctx.stroke();

      // Dots on hover
      points.forEach((p, i) => {
        if (p.fedRate !== null) {
          ctx.beginPath();
          ctx.arc(toX(i), toFedY(p.fedRate), i === hovered ? 4 : 2, 0, Math.PI * 2);
          ctx.fillStyle = '#ef5350';
          ctx.fill();
        }
        if (p.goldPrice !== null) {
          ctx.beginPath();
          ctx.arc(toX(i), toGoldY(p.goldPrice), i === hovered ? 4 : 2, 0, Math.PI * 2);
          ctx.fillStyle = '#f0b90b';
          ctx.fill();
        }
      });

      // Rate hike/cut zones annotations
      // Draw vertical markers when rate changes significantly year-over-year
      for (let i = 1; i < points.length; i++) {
        const prev = points[i - 1].fedRate;
        const curr = points[i].fedRate;
        if (prev === null || curr === null) continue;
        const diff = curr - prev;
        if (Math.abs(diff) >= 1.5) {
          const x = toX(i);
          ctx.beginPath();
          ctx.moveTo(x, PAD.top);
          ctx.lineTo(x, H - PAD.bottom);
          ctx.strokeStyle = diff > 0 ? 'rgba(239,83,80,0.15)' : 'rgba(38,166,154,0.15)';
          ctx.lineWidth = 8;
          ctx.stroke();
          ctx.lineWidth = 1;
        }
      }

      // X labels (every 5 years)
      points.forEach((p, i) => {
        if (p.year % 5 !== 0) return;
        ctx.fillStyle = '#3a3a4e';
        ctx.font = '8px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(String(p.year), toX(i), H - PAD.bottom + 12);
      });

      // Hover tooltip
      if (hovered !== null && points[hovered]) {
        const p  = points[hovered];
        const x  = toX(hovered);
        const tipW = 140, tipH = 62;
        let tx = x - tipW / 2;
        const ty = PAD.top;
        tx = Math.max(PAD.left, Math.min(W - PAD.right - tipW, tx));

        ctx.beginPath();
        ctx.moveTo(x, PAD.top + 4);
        ctx.lineTo(x, H - PAD.bottom);
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = '#1a1a2e';
        ctx.strokeStyle = '#2a2a3e';
        ctx.lineWidth = 1;
        ctx.beginPath();
        // @ts-ignore
        ctx.roundRect(tx, ty, tipW, tipH, 4);
        ctx.fill(); ctx.stroke();

        ctx.fillStyle = '#d1d4dc';
        ctx.font = 'bold 10px monospace';
        ctx.textAlign = 'left';
        ctx.fillText(String(p.year), tx + 8, ty + 16);

        ctx.fillStyle = '#ef5350';
        ctx.font = '9px monospace';
        ctx.fillText(`Fed Rate: ${p.fedRate !== null ? p.fedRate.toFixed(2) + '%' : 'N/A'}`, tx + 8, ty + 30);

        ctx.fillStyle = '#f0b90b';
        ctx.fillText(`Gold: $${p.goldPrice !== null ? fmt2(p.goldPrice) : 'N/A'}`, tx + 8, ty + 43);

        if (hovered > 0 && points[hovered - 1].fedRate !== null && p.fedRate !== null) {
          const fedDiff = p.fedRate - points[hovered - 1].fedRate!;
          ctx.fillStyle = fedDiff > 0 ? '#ef5350' : '#26a69a';
          ctx.fillText(`Rate Δ: ${fedDiff >= 0 ? '+' : ''}${fedDiff.toFixed(2)}%`, tx + 8, ty + 56);
        }
      }
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
    const pw = container.clientWidth - 44 - 56;
    const i = Math.round(((x - 44) / pw) * (points.length - 1));
    setHovered(i >= 0 && i < points.length ? i : null);
  };

  // Stats
  const highRateYears  = points.filter(p => p.fedRate !== null && p.fedRate! >= 4);
  const lowRateYears   = points.filter(p => p.fedRate !== null && p.fedRate! < 1);
  const avgGoldHighRate = highRateYears.length
    ? highRateYears.reduce((s, p) => s + (p.goldPrice ?? 0), 0) / highRateYears.length
    : null;

  return (
    <div className="rounded-xl overflow-hidden flex flex-col" style={{ background: '#0d0d14', border: '1px solid #1a1a2e' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5" style={{ borderBottom: '1px solid #1a1a2e', background: '#0b0b12' }}>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-mono font-bold tracking-widest uppercase" style={{ color: '#f0b90b' }}>
            🏦 FED RATE vs GOLD
          </span>
          {data?.latestRate != null && (
            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={{ background: 'rgba(239,83,80,0.15)', color: '#ef5350', border: '1px solid rgba(239,83,80,0.3)' }}>
              CURRENT {data.latestRate.toFixed(2)}%
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-[9px] font-mono">
          <span className="flex items-center gap-1"><span className="w-3 h-0.5 inline-block" style={{ background: '#ef5350' }} />FED RATE</span>
          <span className="flex items-center gap-1"><span className="w-3 h-0.5 inline-block" style={{ background: '#f0b90b' }} />GOLD $</span>
        </div>
      </div>

      {isLoading || !points.length ? (
        <div className="flex items-center justify-center" style={{ height: 220 }}>
          <div className="flex flex-col items-center gap-2">
            <div className="w-6 h-6 border-2 border-[#f0b90b] border-t-transparent rounded-full animate-spin" />
            <span className="text-[9px] font-mono" style={{ color: '#758696' }}>Fetching FRED & Gold data…</span>
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
          { label: 'HIGH RATE YEARS', value: String(highRateYears.length), sub: 'Fed ≥ 4%', color: '#ef5350' },
          { label: 'NEAR ZERO YEARS', value: String(lowRateYears.length),  sub: 'Fed < 1%', color: '#26a69a' },
          { label: 'GOLD @ HIGH RATE', value: avgGoldHighRate != null ? '$' + Math.round(avgGoldHighRate).toLocaleString() : '—', sub: 'avg price', color: '#f0b90b' },
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
