import React, { useEffect, useState, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { API_BASE } from '@/lib/api';
import { formatDistanceToNow } from 'date-fns';

/* ─── palette ──────────────────────────────────────────────────────────── */
const C = {
  bg:      '#000000',
  panel:   '#050505',
  border:  '#1a2a1a',
  green:   '#00ff41',
  amber:   '#ffb300',
  red:     '#ff3333',
  cyan:    '#00e5ff',
  magenta: '#ff00ff',
  dim:     '#336633',
  dimmer:  '#1a331a',
  white:   '#cccccc',
  gray:    '#558855',
};

/* ─── helpers ──────────────────────────────────────────────────────────── */
function fmt(n: number, d = 2) {
  return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}
function pct(n: number) {
  const s = (n >= 0 ? '+' : '') + fmt(n) + '%';
  return { text: s, color: n >= 0 ? C.green : C.red };
}
function pad(s: string, len: number) {
  return s.length >= len ? s.slice(0, len) : s + ' '.repeat(len - s.length);
}
function rpad(s: string, len: number) {
  return s.length >= len ? s.slice(0, len) : ' '.repeat(len - s.length) + s;
}
function line(char = '─', len = 80) { return char.repeat(len); }

/* ─── Blinking cursor ──────────────────────────────────────────────────── */
function Cursor() {
  const [on, setOn] = useState(true);
  useEffect(() => { const t = setInterval(() => setOn(v => !v), 530); return () => clearInterval(t); }, []);
  return <span style={{ color: C.green, opacity: on ? 1 : 0 }}>█</span>;
}

/* ─── Clock ────────────────────────────────────────────────────────────── */
function Clock() {
  const [time, setTime] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setTime(new Date()), 1000); return () => clearInterval(t); }, []);
  const utc = time.toUTCString().replace('GMT', 'UTC');
  return <span style={{ color: C.cyan }}>{utc}</span>;
}

/* ─── Ticker animation ─────────────────────────────────────────────────── */
function PriceTicker({ price, prev }: { price: number; prev: number | null }) {
  const [flash, setFlash] = useState<'up' | 'dn' | null>(null);
  useEffect(() => {
    if (prev === null) return;
    setFlash(price >= prev ? 'up' : 'dn');
    const t = setTimeout(() => setFlash(null), 400);
    return () => clearTimeout(t);
  }, [price]);
  const color = flash === 'up' ? C.green : flash === 'dn' ? C.red : C.amber;
  return <span style={{ color, fontWeight: 'bold', fontSize: 22, letterSpacing: 2 }}>{fmt(price)}</span>;
}

/* ─── Section header ───────────────────────────────────────────────────── */
function SectionHead({ label, right }: { label: string; right?: string }) {
  return (
    <div style={{ color: C.dim, fontFamily: 'monospace', fontSize: 11, marginBottom: 4 }}>
      {'┌─ '}
      <span style={{ color: C.green, fontWeight: 'bold' }}>{label}</span>
      <span style={{ color: C.dim }}>
        {' ' + line('─', Math.max(1, 56 - label.length - (right?.length ?? 0)))}
        {right && <span style={{ color: C.gray }}>{right}</span>}
        {' ─┐'}
      </span>
    </div>
  );
}

/* ─── interfaces ───────────────────────────────────────────────────────── */
interface MetalQuote { symbol: string; name: string; price: number; change: number; changePct: number; }
interface HeatCell { tf: string; label: string; pct: number | null; }
interface HeatData { timeframes: HeatCell[]; price: number; }
interface VolData {
  atr14: number; atrPct: number; level: 'low' | 'medium' | 'high' | 'extreme';
  trend: 'rising' | 'falling' | 'stable'; price: number; dayHigh: number; dayLow: number;
}
interface NewsItem { id: string; title: string; source: string; publishedAt: string; sentiment?: string; }
interface CorrItem { symbol: string; name: string; correlation: number; change: number; changePct: number; price: number; }

/* ─── Main Terminal ────────────────────────────────────────────────────── */
export function TerminalMode({ onClose }: { onClose: () => void }) {
  const prevPrice = useRef<number | null>(null);

  const { data: metals } = useQuery<MetalQuote[]>({
    queryKey: ['xauusd/metals'],
    queryFn: () => fetch(`${API_BASE}/api/xauusd/metals`, { credentials: 'include' }).then(r => r.json()),
    refetchInterval: 5000,
  });
  const { data: heatmap } = useQuery<HeatData>({
    queryKey: ['xauusd/heatmap'],
    queryFn: () => fetch(`${API_BASE}/api/xauusd/heatmap`, { credentials: 'include' }).then(r => r.json()),
    refetchInterval: 30000,
  });
  const { data: vol } = useQuery<VolData>({
    queryKey: ['xauusd/volatility'],
    queryFn: () => fetch(`${API_BASE}/api/xauusd/volatility`, { credentials: 'include' }).then(r => r.json()),
    refetchInterval: 15000,
  });
  const { data: news } = useQuery<NewsItem[]>({
    queryKey: ['/api/xauusd/news'],
    queryFn: () => fetch(`${API_BASE}/api/xauusd/news`, { credentials: 'include' }).then(r => r.json()),
    refetchInterval: 300000,
  });
  const { data: corr } = useQuery<{ correlations: CorrItem[] }>({
    queryKey: ['/api/xauusd/correlations'],
    queryFn: () => fetch(`${API_BASE}/api/xauusd/correlations`, { credentials: 'include' }).then(r => r.json()),
    refetchInterval: 60000,
  });

  const gold = metals?.find(m => m.symbol === 'XAU');
  const curPrice = gold?.price ?? 0;

  useEffect(() => {
    if (curPrice > 0) {
      prevPrice.current = curPrice;
    }
  }, [curPrice]);

  // keyboard close
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 't' || e.key === 'T' || e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const VOL_COLOR: Record<string, string> = {
    low: C.green, medium: C.amber, high: '#f57c00', extreme: C.red,
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 999,
        background: C.bg,
        fontFamily: '"Courier New", "Lucida Console", monospace',
        fontSize: 12,
        color: C.green,
        overflowY: 'auto',
        padding: '12px 16px',
      }}
      onWheel={e => e.stopPropagation()}
    >
      {/* ── TOP BAR ──────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid ${C.border}`, paddingBottom: 6, marginBottom: 10 }}>
        <div style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
          <span style={{ color: C.amber, fontWeight: 'bold', fontSize: 14, letterSpacing: 3 }}>
            ◈ XAUUSD TERMINAL
          </span>
          <span style={{ color: C.dim }}>v2.6</span>
        </div>
        <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
          <Clock />
          <button
            onClick={onClose}
            style={{
              background: 'transparent', border: `1px solid ${C.border}`,
              color: C.gray, cursor: 'pointer', fontFamily: 'monospace',
              fontSize: 11, padding: '2px 8px', borderRadius: 2,
            }}
          >
            [T] EXIT
          </button>
        </div>
      </div>

      {/* ── LIVE PRICE BANNER ────────────────────────────────────────── */}
      <div style={{
        borderBottom: `1px solid ${C.border}`, paddingBottom: 10, marginBottom: 10,
        display: 'flex', alignItems: 'center', gap: 40, flexWrap: 'wrap',
      }}>
        <div>
          <div style={{ color: C.dim, fontSize: 10, letterSpacing: 2, marginBottom: 2 }}>XAU/USD  SPOT</div>
          {gold ? (
            <PriceTicker price={gold.price} prev={prevPrice.current} />
          ) : (
            <span style={{ color: C.dim }}>LOADING...</span>
          )}
        </div>
        {gold && (
          <>
            <div>
              <div style={{ color: C.dim, fontSize: 10, letterSpacing: 2, marginBottom: 2 }}>CHANGE</div>
              <span style={{ color: gold.change >= 0 ? C.green : C.red, fontSize: 16, fontWeight: 'bold' }}>
                {gold.change >= 0 ? '+' : ''}{fmt(gold.change)} ({gold.changePct >= 0 ? '+' : ''}{fmt(gold.changePct)}%)
              </span>
            </div>
          </>
        )}
        {metals?.filter(m => m.symbol !== 'XAU').map(m => (
          <div key={m.symbol}>
            <div style={{ color: C.dim, fontSize: 10, letterSpacing: 1, marginBottom: 2 }}>{m.symbol}</div>
            <span style={{ color: C.white, fontSize: 13 }}>{fmt(m.price)}</span>
            <span style={{ color: m.changePct >= 0 ? C.green : C.red, fontSize: 11, marginLeft: 5 }}>
              {m.changePct >= 0 ? '+' : ''}{fmt(m.changePct)}%
            </span>
          </div>
        ))}
        <div style={{ marginLeft: 'auto' }}>
          <Cursor />
        </div>
      </div>

      {/* ── MAIN GRID ────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>

        {/* LEFT COL */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* HEATMAP */}
          <div>
            <SectionHead label="MULTI-TF HEATMAP" right="% CHG" />
            <div style={{ border: `1px solid ${C.border}`, padding: '8px 10px', borderRadius: 2 }}>
              {heatmap?.timeframes ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 4 }}>
                  {heatmap.timeframes.map((tf) => {
                    const p = tf.pct ?? 0;
                    const col = p > 0 ? C.green : p < 0 ? C.red : C.dim;
                    return (
                      <div key={tf.tf} style={{ textAlign: 'center' }}>
                        <div style={{ color: C.dim, fontSize: 10 }}>{tf.label}</div>
                        <div style={{ color: col, fontWeight: 'bold', fontSize: 13 }}>
                          {p >= 0 ? '+' : ''}{fmt(p)}%
                        </div>
                        <div style={{ height: 3, background: col, opacity: Math.min(1, Math.abs(p) / 1.5), marginTop: 2, borderRadius: 1 }} />
                      </div>
                    );
                  })}
                </div>
              ) : (
                <span style={{ color: C.dim }}>FETCHING DATA...</span>
              )}
            </div>
          </div>

          {/* VOLATILITY */}
          <div>
            <SectionHead label="VOLATILITY  ATR-14" />
            <div style={{ border: `1px solid ${C.border}`, padding: '8px 10px', borderRadius: 2 }}>
              {vol ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                    <span>
                      <span style={{ color: C.dim }}>LEVEL   </span>
                      <span style={{ color: VOL_COLOR[vol.level], fontWeight: 'bold', letterSpacing: 2 }}>{vol.level.toUpperCase()}</span>
                    </span>
                    <span>
                      <span style={{ color: C.dim }}>ATR14   </span>
                      <span style={{ color: C.white }}>${fmt(vol.atr14)}</span>
                    </span>
                    <span>
                      <span style={{ color: C.dim }}>ATR%    </span>
                      <span style={{ color: C.white }}>{fmt(vol.atrPct)}%</span>
                    </span>
                    <span>
                      <span style={{ color: C.dim }}>TREND   </span>
                      <span style={{ color: vol.trend === 'rising' ? C.red : vol.trend === 'falling' ? C.green : C.dim }}>
                        {vol.trend === 'rising' ? '↑ RISING' : vol.trend === 'falling' ? '↓ FALLING' : '→ STABLE'}
                      </span>
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                    <span>
                      <span style={{ color: C.dim }}>DAY-HI  </span>
                      <span style={{ color: C.green }}>${fmt(vol.dayHigh)}</span>
                    </span>
                    <span>
                      <span style={{ color: C.dim }}>DAY-LO  </span>
                      <span style={{ color: C.red }}>${fmt(vol.dayLow)}</span>
                    </span>
                    <span>
                      <span style={{ color: C.dim }}>RANGE   </span>
                      <span style={{ color: C.white }}>${fmt(vol.dayHigh - vol.dayLow)}</span>
                    </span>
                  </div>
                  {/* ATR bar */}
                  <div style={{ marginTop: 2 }}>
                    <div style={{ color: C.dim, fontSize: 10, marginBottom: 3 }}>
                      LOW {'░'.repeat(10)} MED {'░'.repeat(10)} HIGH {'░'.repeat(10)} EXTREME
                    </div>
                    <div style={{ height: 4, background: C.dimmer, borderRadius: 2, position: 'relative' }}>
                      <div style={{
                        position: 'absolute', top: 0, left: 0, height: '100%',
                        width: `${vol.level === 'low' ? 20 : vol.level === 'medium' ? 50 : vol.level === 'high' ? 78 : 100}%`,
                        background: VOL_COLOR[vol.level],
                        borderRadius: 2, transition: 'width 0.4s',
                      }} />
                    </div>
                  </div>
                </div>
              ) : <span style={{ color: C.dim }}>FETCHING DATA...</span>}
            </div>
          </div>

          {/* CORRELATIONS */}
          <div>
            <SectionHead label="CORRELATIONS" right="LIVE" />
            <div style={{ border: `1px solid ${C.border}`, padding: '6px 10px', borderRadius: 2 }}>
              {corr?.correlations ? (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                  <thead>
                    <tr style={{ color: C.dim, borderBottom: `1px solid ${C.border}` }}>
                      <td style={{ padding: '2px 4px', width: 70 }}>SYMBOL</td>
                      <td style={{ padding: '2px 4px', width: 55, textAlign: 'right' }}>PRICE</td>
                      <td style={{ padding: '2px 4px', width: 55, textAlign: 'right' }}>CHG%</td>
                      <td style={{ padding: '2px 4px', textAlign: 'right' }}>CORR</td>
                    </tr>
                  </thead>
                  <tbody>
                    {corr.correlations.slice(0, 8).map(c => {
                      const corrCol = c.correlation > 0.3 ? C.green : c.correlation < -0.3 ? C.red : C.dim;
                      const chgCol  = c.changePct >= 0 ? C.green : C.red;
                      return (
                        <tr key={c.symbol} style={{ borderBottom: `1px solid ${C.dimmer}` }}>
                          <td style={{ padding: '3px 4px', color: C.cyan, fontWeight: 'bold' }}>{c.symbol}</td>
                          <td style={{ padding: '3px 4px', color: C.white, textAlign: 'right' }}>
                            {fmt(c.price, c.price < 100 ? 4 : 2)}
                          </td>
                          <td style={{ padding: '3px 4px', color: chgCol, textAlign: 'right' }}>
                            {c.changePct >= 0 ? '+' : ''}{fmt(c.changePct)}%
                          </td>
                          <td style={{ padding: '3px 4px', textAlign: 'right', color: corrCol, fontWeight: 'bold' }}>
                            {c.correlation >= 0 ? '+' : ''}{fmt(c.correlation, 3)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : <span style={{ color: C.dim }}>FETCHING DATA...</span>}
            </div>
          </div>
        </div>

        {/* RIGHT COL */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* NEWS FEED */}
          <div style={{ flex: 1 }}>
            <SectionHead label="NEWS  SENTIMENT  FEED" right="LIVE" />
            <div style={{ border: `1px solid ${C.border}`, padding: '6px 0', borderRadius: 2, maxHeight: 420, overflowY: 'auto' }}>
              {news?.length ? news.slice(0, 20).map((item, i) => {
                const sentCol = item.sentiment === 'bullish' ? C.green : item.sentiment === 'bearish' ? C.red : C.dim;
                const sentTag = item.sentiment === 'bullish' ? '▲' : item.sentiment === 'bearish' ? '▼' : '—';
                return (
                  <div
                    key={item.id}
                    style={{
                      padding: '5px 10px',
                      borderBottom: `1px solid ${C.dimmer}`,
                      display: 'flex', gap: 8, alignItems: 'flex-start',
                    }}
                  >
                    <span style={{ color: C.dim, fontSize: 10, minWidth: 18 }}>
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <span style={{ color: sentCol, minWidth: 12 }}>{sentTag}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ color: C.white, lineHeight: 1.4, fontSize: 11 }}>{item.title}</div>
                      <div style={{ color: C.dim, fontSize: 10, marginTop: 2 }}>
                        [{item.source}]  {formatDistanceToNow(new Date(item.publishedAt), { addSuffix: true })}
                      </div>
                    </div>
                  </div>
                );
              }) : (
                Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} style={{ padding: '5px 10px', color: C.dim, borderBottom: `1px solid ${C.dimmer}` }}>
                    {'> '}LOADING FEED...
                  </div>
                ))
              )}
            </div>
          </div>

          {/* METALS TABLE */}
          <div>
            <SectionHead label="PRECIOUS METALS" right="SPOT" />
            <div style={{ border: `1px solid ${C.border}`, padding: '6px 10px', borderRadius: 2 }}>
              {metals?.length ? (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                  <thead>
                    <tr style={{ color: C.dim, borderBottom: `1px solid ${C.border}` }}>
                      <td style={{ padding: '2px 4px' }}>METAL</td>
                      <td style={{ padding: '2px 4px', textAlign: 'right' }}>PRICE</td>
                      <td style={{ padding: '2px 4px', textAlign: 'right' }}>CHG</td>
                      <td style={{ padding: '2px 4px', textAlign: 'right' }}>CHG%</td>
                    </tr>
                  </thead>
                  <tbody>
                    {metals.map(m => {
                      const col = m.changePct >= 0 ? C.green : C.red;
                      return (
                        <tr key={m.symbol} style={{ borderBottom: `1px solid ${C.dimmer}` }}>
                          <td style={{ padding: '3px 4px', color: C.amber, fontWeight: 'bold' }}>{m.symbol}</td>
                          <td style={{ padding: '3px 4px', color: C.white, textAlign: 'right', fontWeight: 'bold' }}>
                            ${fmt(m.price)}
                          </td>
                          <td style={{ padding: '3px 4px', color: col, textAlign: 'right' }}>
                            {m.change >= 0 ? '+' : ''}{fmt(m.change)}
                          </td>
                          <td style={{ padding: '3px 4px', color: col, textAlign: 'right', fontWeight: 'bold' }}>
                            {m.changePct >= 0 ? '+' : ''}{fmt(m.changePct)}%
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : <span style={{ color: C.dim }}>LOADING...</span>}
            </div>
          </div>

        </div>
      </div>

      {/* ── STATUS BAR ───────────────────────────────────────────────── */}
      <div style={{
        marginTop: 14, borderTop: `1px solid ${C.border}`, paddingTop: 6,
        display: 'flex', justifyContent: 'space-between', fontSize: 10, color: C.dim,
      }}>
        <span>XAUUSD TERMINAL  ◈  PRESS [T] OR [ESC] TO EXIT</span>
        <span style={{ color: C.green }}>● LIVE</span>
      </div>
    </div>
  );
}
