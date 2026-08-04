import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer,
} from 'recharts';
import { API_BASE } from '@/lib/api';
import { useLivePrice } from '@/hooks/use-live-price';

interface VixSeriesPoint { time: number; value: number; }

interface VixData {
  value: number | null;
  change: number | null;
  changePct: number | null;
  avg20: number | null;
  label: string | null;
  series: VixSeriesPoint[];
  updatedAt: number;
}

function labelColor(label: string | null) {
  switch (label) {
    case 'COMPLACENT': return '#26a69a';
    case 'NORMAL':      return '#9598a1';
    case 'ELEVATED':    return '#e6a23c';
    case 'FEAR / PANIC':return '#ef5350';
    default:            return '#9598a1';
  }
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg p-2.5 text-xs border" style={{ background: '#0d0d14', borderColor: '#2a2a3e' }}>
      <div className="text-muted-foreground mb-1">{label}</div>
      <div style={{ color: '#e6a23c' }}>VIX: {payload[0].value.toFixed(2)}</div>
    </div>
  );
}

export function VixPanel() {
  const { marketOpen } = useLivePrice();
  const { data, isLoading, isError } = useQuery<VixData>({
    queryKey: ['xauusd/vix'],
    queryFn: async () => {
      const r = await fetch(`${API_BASE}/api/xauusd/vix`, { credentials: 'include' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    refetchInterval: marketOpen === false ? false : 60 * 1000,
    retry: 2,
  });

  const series = data?.series ?? [];
  const chartData = series.map(p => ({
    ...p,
    label: new Date(p.time).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
  }));
  const color = labelColor(data?.label ?? null);

  return (
    <Card className="border-[#2a2a3e]" style={{ background: '#0d0d14' }}>
      <CardHeader className="pb-2 px-4 pt-4 flex flex-row items-center justify-between">
        <CardTitle className="text-xs font-mono font-bold text-[#9598a1] uppercase tracking-widest">
          VIX / Risk Sentiment
        </CardTitle>
        {data?.value != null && (
          <span
            className="text-[10px] font-mono px-1.5 py-0.5 rounded border"
            style={{ color, borderColor: `${color}66`, background: `${color}14` }}
          >
            {data.value.toFixed(2)} · {data.label}
          </span>
        )}
      </CardHeader>
      <CardContent className="p-3 pt-1">
        <p className="text-[10px] text-muted-foreground mb-2">
          CBOE Volatility Index — market fear gauge. High VIX often correlates with gold safe-haven demand.
        </p>

        {isLoading ? (
          <Skeleton className="h-[160px] w-full bg-[#1a1a2e]" />
        ) : isError || series.length === 0 ? (
          <div className="h-[160px] flex items-center justify-center text-xs text-muted-foreground">
            VIX data unavailable right now
          </div>
        ) : (
          <>
            <div style={{ height: 160 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="vixGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#e6a23c" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#e6a23c" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: '#556', fontSize: 9, fontFamily: 'monospace' }}
                    tickLine={false}
                    axisLine={{ stroke: 'rgba(255,255,255,0.06)' }}
                    interval={Math.max(0, Math.floor(chartData.length / 6) - 1)}
                  />
                  <YAxis
                    domain={['auto', 'auto']}
                    tick={{ fill: '#556', fontSize: 9, fontFamily: 'monospace' }}
                    tickLine={false}
                    axisLine={false}
                    width={30}
                  />
                  {data?.avg20 != null && (
                    <ReferenceLine y={data.avg20} stroke="rgba(255,255,255,0.2)" strokeDasharray="2 2" />
                  )}
                  <ReferenceLine y={20} stroke="rgba(230,162,60,0.25)" strokeDasharray="2 2" />
                  <Tooltip content={<CustomTooltip />} cursor={{ stroke: 'rgba(230,162,60,0.25)', strokeWidth: 1 }} />
                  <Area
                    type="monotone"
                    dataKey="value"
                    stroke="#e6a23c"
                    strokeWidth={2}
                    fill="url(#vixGrad)"
                    dot={false}
                    activeDot={{ r: 3, fill: '#e6a23c', stroke: '#0d0d14', strokeWidth: 2 }}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="grid grid-cols-3 gap-2 mt-2 text-[10px] font-mono text-center">
              <div>
                <div className="text-muted-foreground">Change</div>
                <div style={{ color: (data?.change ?? 0) >= 0 ? '#ef5350' : '#26a69a' }}>
                  {data?.change != null ? `${data.change >= 0 ? '+' : ''}${data.change.toFixed(2)}` : 'N/A'}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">% Chg</div>
                <div style={{ color: (data?.changePct ?? 0) >= 0 ? '#ef5350' : '#26a69a' }}>
                  {data?.changePct != null ? `${data.changePct >= 0 ? '+' : ''}${data.changePct.toFixed(2)}%` : 'N/A'}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">20D Avg</div>
                <div className="text-[#d1d4dc]">{data?.avg20?.toFixed(2) ?? 'N/A'}</div>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
