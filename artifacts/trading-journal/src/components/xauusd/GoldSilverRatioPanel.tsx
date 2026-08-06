import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer,
} from 'recharts';
import { API_BASE } from '@/lib/api';
import { useLivePrice } from '@/hooks/use-live-price';

interface RatioPoint { time: number; ratio: number; }

interface GsrData {
  current: number | null;
  avg20: number | null;
  high1y: number | null;
  low1y: number | null;
  signal: string;
  series: RatioPoint[];
  updatedAt: number;
}

function signalColor(signal: string) {
  if (signal === 'SILVER UNDERVALUED') return '#26a69a';
  if (signal === 'GOLD UNDERVALUED') return '#ef5350';
  return '#9598a1';
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg p-2.5 text-xs border" style={{ background: '#0d0d14', borderColor: '#2a2a3e' }}>
      <div className="text-muted-foreground mb-1">{label}</div>
      <div style={{ color: '#d4a843' }}>Ratio: {payload[0].value.toFixed(2)}</div>
    </div>
  );
}

export function GoldSilverRatioPanel() {
  const { marketOpen } = useLivePrice();
  const { data, isLoading, isError } = useQuery<GsrData>({
    queryKey: ['xauusd/gold-silver-ratio'],
    queryFn: async () => {
      const r = await fetch(`${API_BASE}/api/xauusd/gold-silver-ratio`, { credentials: 'include' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    refetchInterval: marketOpen === false ? false : 5 * 60 * 1000,
    retry: 2,
  });

  const series = data?.series ?? [];
  const chartData = series.map(p => ({
    ...p,
    label: new Date(p.time).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
  }));

  return (
    <Card className="border-[#2a2a3e]" style={{ background: '#0d0d14' }}>
      <CardHeader className="pb-2 px-4 pt-4 flex flex-row items-center justify-between">
        <CardTitle className="text-xs font-mono font-bold text-[#9598a1] uppercase tracking-widest">
          Gold/Silver Ratio
        </CardTitle>
        {data?.current != null && (
          <span
            className="text-[10px] font-mono px-1.5 py-0.5 rounded border"
            style={{
              color: signalColor(data.signal),
              borderColor: `${signalColor(data.signal)}66`,
              background: `${signalColor(data.signal)}14`,
            }}
          >
            {data.current.toFixed(2)}
          </span>
        )}
      </CardHeader>
      <CardContent className="p-3 pt-1">
        <p className="text-[10px] text-muted-foreground mb-2">
          XAU/XAG price ratio — how many oz of silver buy 1 oz of gold. Extremes flag relative mispricing.
        </p>

        {isLoading ? (
          <Skeleton className="h-[160px] w-full bg-[#1a1a2e]" />
        ) : isError || series.length === 0 ? (
          <div className="h-[160px] flex items-center justify-center text-xs text-muted-foreground">
            Ratio data unavailable right now
          </div>
        ) : (
          <>
            <div style={{ height: 160 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="gsrGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#d4a843" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#d4a843" stopOpacity={0.02} />
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
                    width={34}
                  />
                  {data?.avg20 != null && (
                    <ReferenceLine y={data.avg20} stroke="rgba(255,255,255,0.2)" strokeDasharray="2 2" />
                  )}
                  <Tooltip content={<CustomTooltip />} cursor={{ stroke: 'rgba(212,168,67,0.25)', strokeWidth: 1 }} />
                  <Area
                    type="monotone"
                    dataKey="ratio"
                    stroke="#d4a843"
                    strokeWidth={2}
                    fill="url(#gsrGrad)"
                    dot={false}
                    activeDot={{ r: 3, fill: '#d4a843', stroke: '#0d0d14', strokeWidth: 2 }}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="grid grid-cols-3 gap-2 mt-2 text-[10px] font-mono text-center">
              <div>
                <div className="text-muted-foreground">20D Avg</div>
                <div className="text-[#d1d4dc]">{data?.avg20?.toFixed(2) ?? 'N/A'}</div>
              </div>
              <div>
                <div className="text-muted-foreground">1Y High</div>
                <div className="text-[#ef5350]">{data?.high1y?.toFixed(2) ?? 'N/A'}</div>
              </div>
              <div>
                <div className="text-muted-foreground">1Y Low</div>
                <div className="text-[#26a69a]">{data?.low1y?.toFixed(2) ?? 'N/A'}</div>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
