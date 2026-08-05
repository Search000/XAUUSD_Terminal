import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { API_BASE } from '@/lib/api';
import { useLivePrice } from '@/hooks/use-live-price';

interface VarStressData {
  price: number;
  ozPerLot: number;
  sampleDays: number;
  dailyVolPct: number;
  var: {
    parametric95Pct: number;
    parametric99Pct: number;
    historical95Pct: number;
    historical99Pct: number;
    parametric95UsdPerLot: number;
    parametric99UsdPerLot: number;
    historical95UsdPerLot: number;
    historical99UsdPerLot: number;
  };
  stress: { label: string; pct: number; usdPerLot: number }[];
  updatedAt: number;
}

function fmtUsd(n: number) {
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export function VarStressPanel() {
  const { marketOpen } = useLivePrice();
  const [lots, setLots] = useState(1);

  const { data, isLoading } = useQuery<VarStressData>({
    queryKey: ['/api/xauusd/var-stress'],
    queryFn: async () => {
      const r = await fetch(`${API_BASE}/api/xauusd/var-stress`, { credentials: 'include' });
      if (!r.ok) throw new Error('Failed to load VaR/stress data');
      return r.json();
    },
    refetchInterval: marketOpen === false ? false : 5 * 60 * 1000,
  });

  const mult = Number.isFinite(lots) && lots > 0 ? lots : 0;

  return (
    <Card className="border-[#2a2a3e]" style={{ background: '#0d0d14' }}>
      <CardHeader className="pb-2 px-4 pt-4 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-xs font-mono font-bold text-[#9598a1] uppercase tracking-widest">
          VaR / Stress Test
        </CardTitle>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-mono text-[#758696]">Lots</span>
          <Input
            type="number"
            min={0.01}
            step={0.01}
            value={lots}
            onChange={(e) => setLots(parseFloat(e.target.value))}
            className="h-6 w-16 text-xs font-mono bg-[#1a1a2e] border-[#2a2a3e] text-[#d1d4dc] px-1.5"
          />
        </div>
      </CardHeader>
      <CardContent className="p-0 pb-3">
        {isLoading || !data ? (
          <div className="px-4 space-y-3 py-2">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-10 w-full bg-[#1a1a2e]" />)}
          </div>
        ) : (
          <>
            <div className="px-4 pb-2 text-[10px] font-mono text-[#758696]">
              Daily vol {data.dailyVolPct}% · {data.sampleDays}d sample (5y) · @ {fmtUsd(data.price)}
            </div>

            {/* VaR rows */}
            <div className="divide-y divide-[#1a1a2e]">
              <div className="px-4 py-2.5 flex items-center justify-between">
                <div>
                  <div className="text-xs font-mono text-[#d1d4dc]">1-Day VaR (95%)</div>
                  <div className="text-[10px] font-mono text-[#758696]">historical</div>
                </div>
                <div className="text-right">
                  <div className="text-xs font-mono font-bold text-[#ef5350]">
                    -{data.var.historical95Pct}%
                  </div>
                  <div className="text-[10px] font-mono text-[#9598a1]">
                    -{fmtUsd(data.var.historical95UsdPerLot * mult)}
                  </div>
                </div>
              </div>
              <div className="px-4 py-2.5 flex items-center justify-between">
                <div>
                  <div className="text-xs font-mono text-[#d1d4dc]">1-Day VaR (99%)</div>
                  <div className="text-[10px] font-mono text-[#758696]">historical</div>
                </div>
                <div className="text-right">
                  <div className="text-xs font-mono font-bold text-[#ef5350]">
                    -{data.var.historical99Pct}%
                  </div>
                  <div className="text-[10px] font-mono text-[#9598a1]">
                    -{fmtUsd(data.var.historical99UsdPerLot * mult)}
                  </div>
                </div>
              </div>
            </div>

            {/* Stress scenarios */}
            <div className="px-4 pt-3 pb-1 text-[10px] font-mono font-bold text-[#9598a1] uppercase tracking-widest">
              Worst-case (actual, 5y history)
            </div>
            <div className="divide-y divide-[#1a1a2e]">
              {data.stress.map((s) => (
                <div key={s.label} className="px-4 py-2.5 flex items-center justify-between">
                  <div className="text-xs font-mono text-[#d1d4dc]">{s.label}</div>
                  <div className="text-right">
                    <div className={cn('text-xs font-mono font-bold', s.pct < 0 ? 'text-[#ef5350]' : 'text-[#26a69a]')}>
                      {s.pct >= 0 ? '+' : ''}{s.pct}%
                    </div>
                    <div className="text-[10px] font-mono text-[#9598a1]">
                      -{fmtUsd(s.usdPerLot * mult)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
