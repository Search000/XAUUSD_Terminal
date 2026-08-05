import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { API_BASE } from '@/lib/api';
import { useLivePrice } from '@/hooks/use-live-price';

interface UnusualRow {
  type: 'CALL' | 'PUT';
  strike: number;
  volume: number;
  openInterest: number;
  volOiRatio: number;
  iv: number | null;
  inTheMoney: boolean;
  signal: 'bullish' | 'bearish';
}

interface OptionsFlowData {
  underlying: string;
  spot: number;
  expiration: number;
  totalCallVol: number;
  totalPutVol: number;
  totalCallOi: number;
  totalPutOi: number;
  putCallVolRatio: number;
  putCallOiRatio: number;
  unusual: UnusualRow[];
  gamma: { netGexUsd: number; regime: 'positive' | 'negative' };
  updatedAt: number;
}

function fmtVol(n: number) {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toString();
}

function fmtGex(n: number) {
  const abs = Math.abs(n);
  const s = abs >= 1_000_000 ? `${(abs / 1_000_000).toFixed(1)}M` : abs >= 1_000 ? `${(abs / 1_000).toFixed(0)}K` : abs.toFixed(0);
  return `${n < 0 ? '-' : '+'}$${s}`;
}

export function OptionsFlowPanel() {
  const { marketOpen } = useLivePrice();

  const { data, isLoading } = useQuery<OptionsFlowData>({
    queryKey: ['/api/xauusd/options-flow'],
    queryFn: async () => {
      const r = await fetch(`${API_BASE}/api/xauusd/options-flow`, { credentials: 'include' });
      if (!r.ok) throw new Error('Failed to load options flow');
      return r.json();
    },
    refetchInterval: marketOpen === false ? false : 10 * 60 * 1000,
    staleTime: 5 * 60 * 1000,
  });

  return (
    <Card className="border-[#2a2a3e]" style={{ background: '#0d0d14' }}>
      <CardHeader className="pb-2 px-4 pt-4 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-xs font-mono font-bold text-[#9598a1] uppercase tracking-widest">
          Options Flow
        </CardTitle>
        {data && (
          <span className="text-[10px] font-mono text-[#758696]">
            {data.underlying} proxy · ${data.spot}
          </span>
        )}
      </CardHeader>
      <CardContent className="p-0 pb-3">
        {isLoading || !data ? (
          <div className="px-4 space-y-3 py-2">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-10 w-full bg-[#1a1a2e]" />)}
          </div>
        ) : (
          <>
            <div className="px-4 pb-2 text-[10px] font-mono text-[#758696]">
              Nearest expiry {new Date(data.expiration).toLocaleDateString()} · GLD (gold proxy — XAUUSD has no listed options)
            </div>

            {/* Put/Call + Gamma summary */}
            <div className="grid grid-cols-3 divide-x divide-[#1a1a2e] border-y border-[#1a1a2e]">
              <div className="px-3 py-2.5">
                <div className="text-[10px] font-mono text-[#758696]">P/C Vol Ratio</div>
                <div className={cn('text-sm font-mono font-bold', data.putCallVolRatio > 1 ? 'text-[#ef5350]' : 'text-[#26a69a]')}>
                  {data.putCallVolRatio.toFixed(2)}
                </div>
              </div>
              <div className="px-3 py-2.5">
                <div className="text-[10px] font-mono text-[#758696]">Call/Put Vol</div>
                <div className="text-sm font-mono font-bold text-[#d1d4dc]">
                  {fmtVol(data.totalCallVol)}/{fmtVol(data.totalPutVol)}
                </div>
              </div>
              <div className="px-3 py-2.5">
                <div className="text-[10px] font-mono text-[#758696]">Net Gamma (est.)</div>
                <div className={cn('text-sm font-mono font-bold', data.gamma.regime === 'positive' ? 'text-[#26a69a]' : 'text-[#ef5350]')}>
                  {fmtGex(data.gamma.netGexUsd)}
                </div>
              </div>
            </div>
            <div className="px-4 pt-1.5 pb-2 text-[10px] font-mono text-[#758696]">
              {data.gamma.regime === 'positive'
                ? 'Positive regime → dealers tend to buy dips / sell rips (dampens moves)'
                : 'Negative regime → dealers tend to chase direction (amplifies moves)'}
            </div>

            {/* Unusual activity */}
            <div className="px-4 pt-2 pb-1 text-[10px] font-mono font-bold text-[#9598a1] uppercase tracking-widest">
              Unusual Activity (Vol/OI)
            </div>
            <div className="divide-y divide-[#1a1a2e]">
              {data.unusual.length === 0 && (
                <div className="px-4 py-3 text-[10px] font-mono text-[#758696]">No unusual strikes right now</div>
              )}
              {data.unusual.map((row, i) => (
                <div key={i} className="px-4 py-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      'text-[10px] font-mono font-bold px-1.5 py-0.5 rounded',
                      row.type === 'CALL' ? 'bg-[#26a69a1a] text-[#26a69a]' : 'bg-[#ef53501a] text-[#ef5350]'
                    )}>
                      {row.type}
                    </span>
                    <span className="text-xs font-mono text-[#d1d4dc]">${row.strike}</span>
                    {row.inTheMoney && <span className="text-[9px] font-mono text-[#758696]">ITM</span>}
                  </div>
                  <div className="text-right">
                    <div className="text-xs font-mono text-[#d1d4dc]">{row.volOiRatio}x vol/OI</div>
                    <div className="text-[10px] font-mono text-[#758696]">
                      {fmtVol(row.volume)} vol · {fmtVol(row.openInterest)} OI
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
