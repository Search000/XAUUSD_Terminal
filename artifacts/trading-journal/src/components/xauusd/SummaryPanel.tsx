import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatCurrency, formatPercent, formatNumber, cn } from '@/lib/utils';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { API_BASE } from '@/lib/api';

export function SummaryPanel() {
  const { data, isLoading } = useQuery({
    queryKey: ['/api/xauusd/summary'],
    queryFn: () => fetch(`${API_BASE}/api/xauusd/summary`, { credentials: 'include' }).then(r => r.json()),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Market Summary</CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        {isLoading || !data ? (
          <div className="space-y-4">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : (
          <div className="space-y-5">

            <div className="grid grid-cols-2 gap-3">
              <div className="bg-muted/30 border border-border p-3 rounded flex flex-col gap-1">
                <span className="text-[10px] text-muted-foreground uppercase font-semibold">24H Volume</span>
                <span className="font-mono text-sm font-bold text-foreground">
                  {formatNumber(data.tradingVolume24h, 0)}
                </span>
              </div>
              <div className="bg-muted/30 border border-border p-3 rounded flex flex-col gap-1">
                <span className="text-[10px] text-muted-foreground uppercase font-semibold">All Time High</span>
                <span className="font-mono text-sm font-bold text-primary">
                  {formatCurrency(data.allTimeHigh)}
                </span>
              </div>
            </div>

            <div>
              <h4 className="text-[10px] font-semibold text-muted-foreground uppercase mb-2">Performance</h4>
              <div className="flex gap-2">
                <PerfBox label="1D" value={data.dailyChangePct} />
                <PerfBox label="1W" value={data.weeklyChangePct} />
                <PerfBox label="1M" value={data.monthlyChangePct} />
                <PerfBox label="1Y" value={data.yearlyChangePct} />
              </div>
            </div>

            <div>
              <h4 className="text-[10px] font-semibold text-muted-foreground uppercase mb-2 flex items-center justify-between">
                <span>Dominant Trend</span>
                <TrendIcon trend={data.dominantTrend} />
              </h4>
              <div className="flex flex-wrap gap-2">
                {data.keyDrivers.map((driver: string, i: number) => (
                  <span key={i} className="text-xs px-2 py-1 bg-muted text-muted-foreground rounded-full border border-border/50">
                    {driver}
                  </span>
                ))}
              </div>
            </div>

          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PerfBox({ label, value }: { label: string; value: number }) {
  const isPositive = value > 0;
  const isNegative = value < 0;

  return (
    <div className={cn(
      "flex-1 flex flex-col items-center justify-center p-2 rounded border",
      isPositive ? "bg-positive/5 border-positive/20" : isNegative ? "bg-negative/5 border-negative/20" : "bg-muted border-border"
    )}>
      <span className="text-[10px] text-muted-foreground font-mono">{label}</span>
      <span className={cn(
        "text-xs font-mono font-bold mt-0.5",
        isPositive ? "text-positive" : isNegative ? "text-negative" : "text-muted-foreground"
      )}>
        {formatPercent(value, 1)}
      </span>
    </div>
  );
}

function TrendIcon({ trend }: { trend: string }) {
  if (trend === 'bullish') return <span className="flex items-center gap-1 text-xs text-positive"><TrendingUp className="w-3 h-3"/> Bullish</span>;
  if (trend === 'bearish') return <span className="flex items-center gap-1 text-xs text-negative"><TrendingDown className="w-3 h-3"/> Bearish</span>;
  return <span className="flex items-center gap-1 text-xs text-muted-foreground"><Minus className="w-3 h-3"/> Neutral</span>;
}
