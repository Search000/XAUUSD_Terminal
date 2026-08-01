import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { API_BASE } from '@/lib/api';
import { useLivePrice } from '@/hooks/use-live-price';

interface CorrAsset {
  key: string;
  name: string;
  correlation: number | null;
}

function corrColor(v: number | null) {
  if (v === null) return 'text-[#758696]';
  if (v >= 0.5)  return 'text-[#26a69a]';
  if (v <= -0.5) return 'text-[#ef5350]';
  return 'text-[#d1d4dc]';
}

function corrBar(v: number | null) {
  const pct = v === null ? 0 : Math.abs(v) * 100;
  const color = v === null ? '#2a2a3e' : v >= 0 ? '#26a69a' : '#ef5350';
  return { pct, color };
}

export function CorrelationsPanel() {
  const { marketOpen } = useLivePrice();
  // API returns: { DXY: {name, correlation}, SILVER: {...}, SP500: {...}, BONDS: {...} }
  const { data: raw, isLoading } = useQuery({
    queryKey: ['/api/xauusd/correlations'],
    queryFn: async () => {
      const r = await fetch(`${API_BASE}/api/xauusd/correlations`, { credentials: 'include' });
      if (!r.ok) return {};
      return r.json();
    },
    refetchInterval: marketOpen === false ? false : 60000,
  });

  // Convert object → array
  const assets: CorrAsset[] = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? Object.entries(raw).map(([key, val]: [string, any]) => ({
        key,
        name: val?.name ?? key,
        correlation: val?.correlation ?? null,
      }))
    : [];

  return (
    <Card className="border-[#2a2a3e]" style={{ background: '#0d0d14' }}>
      <CardHeader className="pb-2 px-4 pt-4">
        <CardTitle className="text-xs font-mono font-bold text-[#9598a1] uppercase tracking-widest">
          Correlations (30D)
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0 pb-2">
        {isLoading || assets.length === 0 ? (
          <div className="px-4 space-y-3 py-2">
            {[1,2,3,4].map(i => <Skeleton key={i} className="h-10 w-full bg-[#1a1a2e]" />)}
          </div>
        ) : (
          <div className="divide-y divide-[#1a1a2e]">
            {assets.map(({ key, name, correlation }) => {
              const { pct, color } = corrBar(correlation);
              return (
                <div key={key} className="px-4 py-2.5">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-mono text-[#d1d4dc]">{name}</span>
                    <span className={cn('text-xs font-mono font-bold', corrColor(correlation))}>
                      {correlation !== null ? (correlation >= 0 ? '+' : '') + correlation.toFixed(3) : 'N/A'}
                    </span>
                  </div>
                  <div className="h-1 w-full bg-[#1a1a2e] rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{ width: `${pct}%`, background: color }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
