import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { API_BASE } from '@/lib/api';

interface TfCell {
  tf: string;
  label: string;
  pct: number | null;
}

interface HeatmapData {
  timeframes: TfCell[];
  price: number;
}

function getColor(pct: number | null) {
  if (pct === null) return { bg: '#1a1a2e', text: '#758696', border: '#2a2a3e' };
  const abs = Math.abs(pct);
  if (pct > 0) {
    if (abs >= 1.0)  return { bg: 'rgba(38,166,154,0.40)', text: '#26a69a', border: 'rgba(38,166,154,0.6)' };
    if (abs >= 0.5)  return { bg: 'rgba(38,166,154,0.25)', text: '#26a69a', border: 'rgba(38,166,154,0.4)' };
    if (abs >= 0.2)  return { bg: 'rgba(38,166,154,0.15)', text: '#26a69a', border: 'rgba(38,166,154,0.3)' };
    return             { bg: 'rgba(38,166,154,0.08)', text: '#26a69a', border: 'rgba(38,166,154,0.2)' };
  } else {
    if (abs >= 1.0)  return { bg: 'rgba(239,83,80,0.40)', text: '#ef5350', border: 'rgba(239,83,80,0.6)' };
    if (abs >= 0.5)  return { bg: 'rgba(239,83,80,0.25)', text: '#ef5350', border: 'rgba(239,83,80,0.4)' };
    if (abs >= 0.2)  return { bg: 'rgba(239,83,80,0.15)', text: '#ef5350', border: 'rgba(239,83,80,0.3)' };
    return             { bg: 'rgba(239,83,80,0.08)', text: '#ef5350', border: 'rgba(239,83,80,0.2)' };
  }
}

function HeatCell({ cell }: { cell: TfCell }) {
  const { bg, text, border } = getColor(cell.pct);
  const pctStr = cell.pct === null
    ? '—'
    : (cell.pct >= 0 ? '+' : '') + cell.pct.toFixed(2) + '%';
  const arrow = cell.pct === null ? '' : cell.pct > 0 ? '▲' : cell.pct < 0 ? '▼' : '●';

  return (
    <div
      style={{
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: 6,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '10px 8px',
        minHeight: 72,
        boxSizing: 'border-box',
      }}
    >
      <span style={{ fontSize: 10, fontFamily: 'monospace', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#758696', marginBottom: 4 }}>
        {cell.label}
      </span>
      <span style={{ fontSize: 10, fontFamily: 'monospace', color: text, marginBottom: 2 }}>
        {arrow}
      </span>
      <span style={{ fontSize: 13, fontFamily: 'monospace', fontWeight: 700, color: text, lineHeight: 1 }}>
        {pctStr}
      </span>
    </div>
  );
}

export function HeatmapPanel() {
  const { data, isLoading } = useQuery<HeatmapData>({
    queryKey: ['xauusd/heatmap'],
    queryFn: async () => {
      const r = await fetch(`${API_BASE}/api/xauusd/heatmap`, { credentials: 'include' });
      if (!r.ok) throw new Error('fetch error');
      return r.json();
    },
    refetchInterval: 60_000,
    staleTime: 55_000,
    retry: 2,
  });

  const cells: TfCell[] = data?.timeframes ?? [
    { tf: '5m',  label: '5M',  pct: null },
    { tf: '15m', label: '15M', pct: null },
    { tf: '30m', label: '30M', pct: null },
    { tf: '1h',  label: '1H',  pct: null },
    { tf: '4h',  label: '4H',  pct: null },
    { tf: '1d',  label: '1D',  pct: null },
  ];

  const validCells = cells.filter(c => c.pct !== null);
  const bullCells  = validCells.filter(c => (c.pct ?? 0) >  0.001);
  const bearCells  = validCells.filter(c => (c.pct ?? 0) < -0.001);
  const bullSum    = bullCells.reduce((s, c) => s + Math.abs(c.pct ?? 0), 0);
  const bearSum    = bearCells.reduce((s, c) => s + Math.abs(c.pct ?? 0), 0);
  const bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL' =
    bullCells.length > bearCells.length ? 'BULLISH' :
    bearCells.length > bullCells.length ? 'BEARISH' :
    bullCells.length === 0 && bearCells.length === 0 ? 'NEUTRAL' :
    bullSum > bearSum ? 'BULLISH' : bearSum > bullSum ? 'BEARISH' : 'NEUTRAL';
  const biasColor = bias === 'BULLISH' ? '#26a69a' : bias === 'BEARISH' ? '#ef5350' : '#758696';

  return (
    <div style={{ background: '#0d0d14', border: '1px solid #2a2a3e', borderRadius: 8 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderBottom: '1px solid #1a1a2e' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 10, fontFamily: 'monospace', fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#f0b90b' }}>
            XAU/USD
          </span>
          <span style={{ fontSize: 10, fontFamily: 'monospace', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#758696' }}>
            Multi-TF Heatmap
          </span>
        </div>
        {!isLoading && validCells.length > 0 && (
          <span style={{ fontSize: 10, fontFamily: 'monospace', fontWeight: 700, letterSpacing: '0.1em', color: biasColor }}>
            {bias}
          </span>
        )}
      </div>

      {/* Grid — 3 cols × 2 rows */}
      <div style={{ padding: 12 }}>
        {isLoading && !data ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} style={{ height: 72, borderRadius: 6, background: '#1a1a2e', animation: 'pulse 1.5s ease-in-out infinite' }} />
            ))}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            {cells.map(cell => <HeatCell key={cell.tf} cell={cell} />)}
          </div>
        )}
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 20, padding: '0 12px 12px' }}>
        {[{ color: '#26a69a', label: 'Bullish' }, { color: '#ef5350', label: 'Bearish' }].map(({ color, label }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: color }} />
            <span style={{ fontSize: 10, fontFamily: 'monospace', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color }}>{label}</span>
          </div>
        ))}
        <span style={{ fontSize: 10, fontFamily: 'monospace', color: '#758696' }}>darker = stronger move</span>
      </div>
    </div>
  );
}
