import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer,
} from 'recharts';
import { API_BASE } from '@/lib/api';

interface CotPoint {
  date: string;
  netLongs: number;
  longs: number;
  shorts: number;
}

interface CotHistoryData {
  points: CotPoint[];
  updatedAt: number;
}

function fmtK(n: number) {
  const k = n / 1000;
  return `${k >= 0 ? '+' : ''}${k.toFixed(0)}K`;
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const p: CotPoint = payload[0].payload;
  return (
    <div
      className="rounded-lg p-2.5 text-xs border"
      style={{ background: '#0d0d14', borderColor: '#2a2a3e' }}
    >
      <div className="text-muted-foreground mb-1">{label}</div>
      <div style={{ color: p.netLongs >= 0 ? '#26a69a' : '#ef5350' }}>
        Net Longs: {fmtK(p.netLongs)}
      </div>
      <div className="text-muted-foreground">Long: {(p.longs / 1000).toFixed(0)}K · Short: {(p.shorts / 1000).toFixed(0)}K</div>
    </div>
  );
}

export function CotHistoryPanel() {
  const { data, isLoading, isError } = useQuery<CotHistoryData>({
    queryKey: ['xauusd/cot-history'],
    queryFn: async () => {
      const r = await fetch(`${API_BASE}/api/xauusd/cot-history`, { credentials: 'include' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    staleTime: 60 * 60 * 1000, // CFTC only updates weekly
    refetchInterval: 6 * 60 * 60 * 1000,
    retry: 2,
  });

  const points = data?.points ?? [];
  const latest = points[points.length - 1];
  const first = points[0];
  const trendUp = latest && first ? latest.netLongs > first.netLongs : null;

  const chartData = points.map(p => ({
    ...p,
    label: new Date(p.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
  }));

  return (
    <Card className="border-[#2a2a3e]" style={{ background: '#0d0d14' }}>
      <CardHeader className="pb-2 px-4 pt-4 flex flex-row items-center justify-between">
        <CardTitle className="text-xs font-mono font-bold text-[#9598a1] uppercase tracking-widest">
          COT Positioning History
        </CardTitle>
        {latest && (
          <span
            className="text-[10px] font-mono px-1.5 py-0.5 rounded border"
            style={{
              color: latest.netLongs >= 0 ? '#26a69a' : '#ef5350',
              borderColor: latest.netLongs >= 0 ? 'rgba(38,166,154,0.4)' : 'rgba(239,83,80,0.4)',
              background: latest.netLongs >= 0 ? 'rgba(38,166,154,0.08)' : 'rgba(239,83,80,0.08)',
            }}
          >
            {fmtK(latest.netLongs)}
          </span>
        )}
      </CardHeader>
      <CardContent className="p-3 pt-1">
        <p className="text-[10px] text-muted-foreground mb-2">
          Large-speculator (non-commercial) net-long futures positioning · CFTC weekly report{first ? ` · since ${new Date(first.date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}` : ''}
        </p>

        {isLoading ? (
          <Skeleton className="h-[180px] w-full bg-[#1a1a2e]" />
        ) : isError || points.length === 0 ? (
          <div className="h-[180px] flex items-center justify-center text-xs text-muted-foreground">
            COT data unavailable right now
          </div>
        ) : (
          <>
            <div style={{ height: 180 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="cotGrad" x1="0" y1="0" x2="0" y2="1">
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
                    tick={{ fill: '#556', fontSize: 9, fontFamily: 'monospace' }}
                    tickLine={false}
                    axisLine={false}
                    width={42}
                    tickFormatter={v => fmtK(v)}
                  />
                  <ReferenceLine y={0} stroke="rgba(255,255,255,0.15)" strokeDasharray="2 2" />
                  <Tooltip content={<CustomTooltip />} cursor={{ stroke: 'rgba(212,168,67,0.25)', strokeWidth: 1 }} />
                  <Area
                    type="monotone"
                    dataKey="netLongs"
                    stroke="#d4a843"
                    strokeWidth={2}
                    fill="url(#cotGrad)"
                    dot={false}
                    activeDot={{ r: 3, fill: '#d4a843', stroke: '#0d0d14', strokeWidth: 2 }}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            {trendUp !== null && (
              <p className="text-[10px] text-muted-foreground mt-1.5">
                Large speculators have been{' '}
                <span style={{ color: trendUp ? '#26a69a' : '#ef5350' }}>
                  {trendUp ? 'adding to' : 'reducing'} net-long positioning
                </span>{' '}
                over this period.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
