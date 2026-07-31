import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { API_BASE } from '@/lib/api';

// API returns: [{ id, name, open, close, timezone, color, active, minsUntilOpen }]
// open/close = minutes from midnight UTC

interface Session {
  id: string;
  name: string;
  open: number;
  close: number;
  timezone: string;
  color: string;
  active: boolean;
  minsUntilOpen: number;
}

function minsToUtc(mins: number) {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function formatCountdown(mins: number) {
  if (mins <= 0) return 'OPEN';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function SessionsPanel() {
  // API returns a plain array
  const { data: raw, isLoading } = useQuery({
    queryKey: ['/api/xauusd/sessions'],
    queryFn: async () => {
      const r = await fetch(`${API_BASE}/api/xauusd/sessions`, { credentials: 'include' });
      if (!r.ok) return [];
      const d = await r.json();
      return Array.isArray(d) ? d : [];
    },
    refetchInterval: 30000,
  });

  const sessions: Session[] = raw ?? [];
  const now = new Date();
  const utcTime = `${String(now.getUTCHours()).padStart(2,'0')}:${String(now.getUTCMinutes()).padStart(2,'0')} UTC`;

  return (
    <Card className="border-[#2a2a3e]" style={{ background: '#0d0d14' }}>
      <CardHeader className="pb-2 px-4 pt-4 flex flex-row items-center justify-between">
        <CardTitle className="text-xs font-mono font-bold text-[#9598a1] uppercase tracking-widest">
          Trading Sessions
        </CardTitle>
        <div className="text-[10px] font-mono text-[#758696] flex items-center gap-1 border border-[#2a2a3e] px-1.5 py-0.5 rounded bg-[#1a1a2e]">
          <Clock className="w-3 h-3" /> {utcTime}
        </div>
      </CardHeader>
      <CardContent className="p-3 pt-1">
        {isLoading || sessions.length === 0 ? (
          <div className="space-y-2">
            {[1,2,3,4].map(i => <Skeleton key={i} className="h-10 w-full bg-[#1a1a2e]" />)}
          </div>
        ) : (
          <div className="space-y-2">
            {sessions.map(session => (
              <div
                key={session.id}
                className={cn(
                  'flex items-center justify-between p-2.5 border rounded text-sm transition-colors',
                  session.active
                    ? 'bg-[#1a1a2e] border-[#2a2a3e]'
                    : 'opacity-50 border-transparent bg-transparent'
                )}
              >
                <div className="flex items-center gap-3">
                  {/* Dot indicator */}
                  <div className="relative flex items-center justify-center w-3 h-3 flex-shrink-0">
                    {session.active ? (
                      <>
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-30"
                          style={{ background: session.color }} />
                        <span className="relative inline-flex rounded-full h-2 w-2"
                          style={{ background: session.color }} />
                      </>
                    ) : (
                      <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[#3a3a4e]" />
                    )}
                  </div>
                  <div>
                    <div className="font-semibold text-[#d1d4dc] text-xs font-mono">{session.name}</div>
                    <div className="text-[9px] font-mono text-[#758696]">{session.timezone}</div>
                  </div>
                </div>

                <div className="text-right">
                  <div className="font-mono text-[10px] text-[#758696]">
                    {minsToUtc(session.open)} – {minsToUtc(session.close)}
                  </div>
                  <div className={cn(
                    'text-[10px] font-mono font-bold uppercase mt-0.5',
                    session.active ? 'text-[#26a69a]' : 'text-[#758696]'
                  )}>
                    {session.active ? 'OPEN' : `in ${formatCountdown(session.minsUntilOpen)}`}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
