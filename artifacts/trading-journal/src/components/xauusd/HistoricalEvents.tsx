import React, { useState, useRef, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  ComposedChart, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer, Area,
} from 'recharts';
import { API_BASE } from '@/lib/api';

/* ── Historical gold price data (annual avg USD/oz) ────────────────────── */
const GOLD_PRICES: { year: number; price: number }[] = [
  { year: 1971, price: 41 },
  { year: 1972, price: 58 },
  { year: 1973, price: 97 },
  { year: 1974, price: 159 },
  { year: 1975, price: 161 },
  { year: 1976, price: 125 },
  { year: 1977, price: 148 },
  { year: 1978, price: 193 },
  { year: 1979, price: 306 },
  { year: 1980, price: 615 },
  { year: 1981, price: 460 },
  { year: 1982, price: 376 },
  { year: 1983, price: 424 },
  { year: 1984, price: 361 },
  { year: 1985, price: 317 },
  { year: 1986, price: 368 },
  { year: 1987, price: 447 },
  { year: 1988, price: 437 },
  { year: 1989, price: 381 },
  { year: 1990, price: 383 },
  { year: 1991, price: 362 },
  { year: 1992, price: 344 },
  { year: 1993, price: 360 },
  { year: 1994, price: 384 },
  { year: 1995, price: 384 },
  { year: 1996, price: 388 },
  { year: 1997, price: 331 },
  { year: 1998, price: 294 },
  { year: 1999, price: 279 },
  { year: 2000, price: 279 },
  { year: 2001, price: 271 },
  { year: 2002, price: 310 },
  { year: 2003, price: 363 },
  { year: 2004, price: 410 },
  { year: 2005, price: 444 },
  { year: 2006, price: 604 },
  { year: 2007, price: 696 },
  { year: 2008, price: 872 },
  { year: 2009, price: 972 },
  { year: 2010, price: 1225 },
  { year: 2011, price: 1571 },
  { year: 2012, price: 1669 },
  { year: 2013, price: 1411 },
  { year: 2014, price: 1266 },
  { year: 2015, price: 1160 },
  { year: 2016, price: 1251 },
  { year: 2017, price: 1257 },
  { year: 2018, price: 1268 },
  { year: 2019, price: 1393 },
  { year: 2020, price: 1769 },
  { year: 2021, price: 1799 },
  { year: 2022, price: 1800 },
  { year: 2023, price: 1941 },
  { year: 2024, price: 2386 },
  { year: 2025, price: 2950 },
];

// Last year in the static array
const STATIC_LAST_YEAR = 2025;

/* ── Major historical events ────────────────────────────────────────────── */
interface GoldEvent {
  year: number;
  label: string;
  shortLabel: string;
  description: string;
  type: 'crisis' | 'policy' | 'peak' | 'trough' | 'geopolitical';
}

const EVENTS: GoldEvent[] = [
  {
    year: 1971, label: 'Nixon Shock', shortLabel: 'Nixon',
    description: 'US ends gold standard. USD no longer convertible to gold. Gold freed from $35/oz peg.',
    type: 'policy',
  },
  {
    year: 1980, label: '1980 ATH', shortLabel: '$615',
    description: 'Gold reaches $850/oz. Driven by Iran hostage crisis, Soviet invasion of Afghanistan, and hyperinflation.',
    type: 'peak',
  },
  {
    year: 1999, label: "Brown's Bottom", shortLabel: '$279',
    description: 'UK Treasury sells 60% of gold reserves at ~$275/oz. Gold hits 20-year low.',
    type: 'trough',
  },
  {
    year: 2001, label: '9/11 & War', shortLabel: '9/11',
    description: 'Terror attacks + loose Fed policy begin multi-year gold bull run from $271/oz.',
    type: 'geopolitical',
  },
  {
    year: 2008, label: 'Financial Crisis', shortLabel: 'GFC',
    description: 'Lehman Brothers collapse. Safe-haven demand surges. Gold rises strongly through crisis.',
    type: 'crisis',
  },
  {
    year: 2011, label: '2011 ATH $1,921', shortLabel: '$1,921',
    description: 'European debt crisis + QE2. Gold peaks at $1,921/oz in September.',
    type: 'peak',
  },
  {
    year: 2013, label: 'Taper Tantrum', shortLabel: 'Taper',
    description: 'Fed hints QE tapering. Gold drops 28% — biggest annual decline since 1981.',
    type: 'crisis',
  },
  {
    year: 2020, label: 'COVID-19', shortLabel: 'COVID',
    description: 'Pandemic triggers massive stimulus. Gold surges to then-ATH of $2,075/oz in August 2020.',
    type: 'peak',
  },
  {
    year: 2022, label: 'Ukraine War', shortLabel: 'Ukraine',
    description: 'Russia invades Ukraine. Gold spikes above $2,000 then retreats as Fed aggressively hikes rates.',
    type: 'geopolitical',
  },
  {
    year: 2024, label: '2024 ATH $2,787', shortLabel: '$2,787',
    description: 'Central bank buying + de-dollarization + Middle East conflict push gold to new all-time highs.',
    type: 'peak',
  },
  {
    year: 2025, label: '2025 ATH $3,500+', shortLabel: '$3.5k',
    description: 'Trade war tariffs, recession fears, and continued central bank accumulation drive gold above $3,000.',
    type: 'peak',
  },
];

/* ── Type colors ─────────────────────────────────────────────────────────── */
const TYPE_COLOR: Record<GoldEvent['type'], string> = {
  peak:        '#26a69a',
  trough:      '#ef5350',
  crisis:      '#f59e0b',
  policy:      '#818cf8',
  geopolitical:'#fb923c',
};

const TYPE_LABEL: Record<GoldEvent['type'], string> = {
  peak:        'ATH/Peak',
  trough:      'Bottom',
  crisis:      'Crisis',
  policy:      'Policy',
  geopolitical:'Geopolitical',
};

/* ── Custom tooltip ──────────────────────────────────────────────────────── */
function CustomTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: { value: number }[];
  label?: number;
}) {
  if (!active || !payload?.length) return null;
  const price = payload[0]?.value;
  const evt = EVENTS.find(e => e.year === label);
  return (
    <div
      className="rounded-lg p-3 text-xs max-w-[220px] pointer-events-none"
      style={{ background: '#0d1117', border: '1px solid #30363d', boxShadow: '0 8px 24px rgba(0,0,0,0.6)' }}
    >
      <div className="font-bold text-white mb-1">{label}</div>
      <div className="font-mono text-[13px] mb-2" style={{ color: '#d4a843' }}>
        ${price?.toLocaleString()}/oz
      </div>
      {evt && (
        <>
          <div className="font-bold mb-0.5" style={{ color: TYPE_COLOR[evt.type] }}>
            {evt.label}
          </div>
          <div className="text-muted-foreground leading-relaxed">{evt.description}</div>
        </>
      )}
    </div>
  );
}

/* ── Custom reference label rendered below the chart line ─────────────── */
function EventLabel(props: {
  viewBox?: { x: number; y: number; width: number; height: number };
  color: string;
  text: string;
}) {
  const { viewBox, color, text } = props;
  if (!viewBox) return null;
  const { x, y, height } = viewBox;
  // Place label near the bottom of the chart area
  const labelY = y + height - 6;
  return (
    <text
      x={x + 3}
      y={labelY}
      fill={color}
      fontSize={8}
      fontFamily="monospace"
      style={{ userSelect: 'none', pointerEvents: 'none' }}
    >
      {text}
    </text>
  );
}

/* ── Main Component ─────────────────────────────────────────────────────── */
type FilterType = 'all' | GoldEvent['type'];

export function HistoricalEvents() {
  const [activeFilter, setActiveFilter] = useState<FilterType>('all');
  const [selectedEvent, setSelectedEvent] = useState<GoldEvent | null>(null);
  const chartWrapperRef = useRef<HTMLDivElement>(null);

  const currentYear = new Date().getFullYear();

  // Fetch live gold price to auto-populate current year — no manual update ever needed
  const { data: metalsData } = useQuery<{ symbol: string; price: number }[]>({
    queryKey: ['xauusd/metals'],
    queryFn: () => fetch(`${API_BASE}/api/xauusd/metals`, { credentials: 'include' }).then(r => r.json()),
    staleTime: 60_000,
  });

  const livePrice = metalsData?.find(m => m.symbol === 'XAU')?.price ?? null;

  // Merge static history + auto current-year entry (if current year > last static year)
  const chartData = useMemo(() => {
    const rows = [...GOLD_PRICES];
    if (currentYear > STATIC_LAST_YEAR && livePrice && livePrice > 0) {
      // Fill any missing years between static end and current year
      for (let y = STATIC_LAST_YEAR + 1; y < currentYear; y++) {
        if (!rows.find(r => r.year === y)) {
          // Interpolate — we don't have data yet, mark with previous year value
          rows.push({ year: y, price: rows[rows.length - 1].price });
        }
      }
      // Current year uses live price
      const existing = rows.findIndex(r => r.year === currentYear);
      if (existing >= 0) rows[existing] = { year: currentYear, price: Math.round(livePrice) };
      else rows.push({ year: currentYear, price: Math.round(livePrice) });
    }
    return rows.sort((a, b) => a.year - b.year);
  }, [livePrice, currentYear]);

  const visibleEvents = activeFilter === 'all'
    ? EVENTS
    : EVENTS.filter(e => e.type === activeFilter);

  const filterTypes: { key: FilterType; label: string }[] = [
    { key: 'all',         label: 'All' },
    { key: 'peak',        label: 'Peaks' },
    { key: 'crisis',      label: 'Crisis' },
    { key: 'policy',      label: 'Policy' },
    { key: 'geopolitical',label: 'Geo' },
    { key: 'trough',      label: 'Bottoms' },
  ];

  return (
    <Card className="flex flex-col h-full">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-sm">Historical Gold Events</CardTitle>
          <div className="flex items-center gap-1 flex-wrap">
            {filterTypes.map(f => (
              <button
                key={f.key}
                onClick={() => setActiveFilter(f.key)}
                className="text-[10px] font-mono px-2 py-0.5 rounded transition-all"
                style={{
                  background: activeFilter === f.key
                    ? (f.key === 'all' ? 'rgba(255,255,255,0.12)' : `${TYPE_COLOR[f.key as GoldEvent['type']]}30`)
                    : 'transparent',
                  color: activeFilter === f.key
                    ? (f.key === 'all' ? '#fff' : TYPE_COLOR[f.key as GoldEvent['type']])
                    : '#555',
                  border: `1px solid ${activeFilter === f.key
                    ? (f.key === 'all' ? 'rgba(255,255,255,0.2)' : `${TYPE_COLOR[f.key as GoldEvent['type']]}60`)
                    : 'transparent'}`,
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-3 mt-1 flex-wrap">
          {(Object.keys(TYPE_COLOR) as GoldEvent['type'][]).map(t => (
            <div key={t} className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full shrink-0" style={{ background: TYPE_COLOR[t] }} />
              <span className="text-[10px] text-muted-foreground">{TYPE_LABEL[t]}</span>
            </div>
          ))}
        </div>
      </CardHeader>

      <CardContent className="p-0 flex-1 flex flex-col min-h-0">
        {/* Chart — prevent wheel from scrolling the page (desktop only;
            touch scroll must pass through so mobile users can still scroll
            the page when their finger starts inside this chart). */}
        <div
          ref={chartWrapperRef}
          className="px-2 pt-1"
          style={{ height: 260 }}
          onWheel={e => e.stopPropagation()}
        >
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={chartData}
              margin={{ top: 12, right: 12, bottom: 20, left: 4 }}
            >
              <defs>
                <linearGradient id="goldGradHist" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#d4a843" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#d4a843" stopOpacity={0.02} />
                </linearGradient>
              </defs>

              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />

              <XAxis
                dataKey="year"
                tick={{ fill: '#556', fontSize: 9, fontFamily: 'monospace' }}
                tickLine={false}
                axisLine={{ stroke: 'rgba(255,255,255,0.06)' }}
                interval={4}
              />
              <YAxis
                tick={{ fill: '#556', fontSize: 9, fontFamily: 'monospace' }}
                tickLine={false}
                axisLine={false}
                tickFormatter={v => `$${v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v}`}
                width={38}
                domain={[0, 'auto']}
              />

              <Tooltip
                content={<CustomTooltip />}
                cursor={{ stroke: 'rgba(212,168,67,0.25)', strokeWidth: 1 }}
                allowEscapeViewBox={{ x: false, y: false }}
              />

              <Area
                type="monotone"
                dataKey="price"
                stroke="#d4a843"
                strokeWidth={2}
                fill="url(#goldGradHist)"
                dot={false}
                activeDot={{ r: 4, fill: '#d4a843', stroke: '#0d1117', strokeWidth: 2 }}
                isAnimationActive={false}
              />

              {/* Event markers — label at bottom so they don't overlap the price line */}
              {visibleEvents.map(evt => (
                <ReferenceLine
                  key={evt.year}
                  x={evt.year}
                  stroke={TYPE_COLOR[evt.type]}
                  strokeWidth={1}
                  strokeDasharray="3 4"
                  opacity={0.75}
                  label={
                    <EventLabel
                      color={TYPE_COLOR[evt.type]}
                      text={evt.shortLabel}
                    />
                  }
                />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Events list — scrollable, isolated from page scroll */}
        <div
          className="border-t border-border/40 overflow-y-auto flex-1"
          style={{ overscrollBehavior: 'contain' }}
          onWheel={e => e.stopPropagation()}
        >
          {visibleEvents.map(evt => {
            const priceData = chartData.find(p => p.year === evt.year);
            const isSelected = selectedEvent?.year === evt.year;
            return (
              <div
                key={evt.year}
                onClick={() => setSelectedEvent(isSelected ? null : evt)}
                className="flex gap-3 px-4 py-2.5 border-b border-border/30 last:border-0 cursor-pointer transition-colors"
                style={{ background: isSelected ? `${TYPE_COLOR[evt.type]}0d` : 'transparent' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = `${TYPE_COLOR[evt.type]}0a`; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = isSelected ? `${TYPE_COLOR[evt.type]}0d` : 'transparent'; }}
              >
                {/* Year + color stripe */}
                <div className="shrink-0 flex flex-col items-center gap-0.5">
                  <span className="text-[11px] font-bold font-mono" style={{ color: TYPE_COLOR[evt.type] }}>
                    {evt.year}
                  </span>
                  <div
                    className="w-px flex-1 mt-0.5"
                    style={{ background: `${TYPE_COLOR[evt.type]}35`, minHeight: 14 }}
                  />
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                    <span className="text-xs font-semibold text-foreground">{evt.label}</span>
                    <span
                      className="text-[9px] font-mono px-1.5 py-0.5 rounded shrink-0"
                      style={{
                        background: `${TYPE_COLOR[evt.type]}18`,
                        color: TYPE_COLOR[evt.type],
                        border: `1px solid ${TYPE_COLOR[evt.type]}35`,
                      }}
                    >
                      {TYPE_LABEL[evt.type].toUpperCase()}
                    </span>
                    {priceData && (
                      <span className="text-[10px] font-mono ml-auto" style={{ color: '#d4a843' }}>
                        ~${priceData.price.toLocaleString()}/oz
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    {evt.description}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
