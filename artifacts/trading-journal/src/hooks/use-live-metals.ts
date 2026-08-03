import { useEffect, useRef, useState } from 'react';
import { API_BASE } from '@/lib/api';

export type MetalSymbol = 'XAG' | 'XPT' | 'XPD' | 'DXY';

export interface LiveMetalTick {
  price: number;
  changePct: number | null;
  timestamp: number;
  marketOpen: boolean;
}

type LiveMetalsMap = Partial<Record<MetalSymbol, LiveMetalTick>>;

/**
 * Subscribes to the shared live-metals SSE feed (/api/xauusd/live-metals) —
 * SILVER, PLATINUM, PALLADIUM, DXY, streamed off the same single upstream
 * TradingView connection the gold ticker uses (see useLivePrice / liveGoldFeed
 * on the backend). Not every instrument is guaranteed to resolve on this
 * feed (unofficial endpoint, fallback symbols may all fail for a given
 * instrument) — callers should fall back to the 30s-polled /xauusd/metals
 * endpoint for any symbol missing from `ticks`.
 */
export function useLiveMetals(): { ticks: LiveMetalsMap; connected: boolean } {
  const [ticks, setTicks] = useState<LiveMetalsMap>({});
  const [connected, setConnected] = useState(false);
  const ticksRef = useRef<LiveMetalsMap>({});

  useEffect(() => {
    let es: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let retryCount = 0;
    let mounted = true;

    function connect() {
      if (!mounted) return;
      es = new EventSource(`${API_BASE}/api/xauusd/live-metals`, { withCredentials: true });

      es.onopen = () => { if (mounted) setConnected(true); retryCount = 0; };

      es.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (!mounted) return;
          const sym: MetalSymbol | undefined = data.sym;
          if (!sym || typeof data.price !== 'number') return;
          ticksRef.current = {
            ...ticksRef.current,
            [sym]: {
              price: data.price,
              changePct: typeof data.changePct === 'number' ? data.changePct : null,
              timestamp: typeof data.timestamp === 'number' ? data.timestamp : Date.now(),
              marketOpen: typeof data.marketOpen === 'boolean' ? data.marketOpen : true,
            },
          };
          setTicks(ticksRef.current);
        } catch { /* ignore parse errors */ }
      };

      es.onerror = () => {
        if (mounted) setConnected(false);
        es?.close();
        const delay = Math.min(1500 * 1.5 ** retryCount, 12000);
        retryCount = Math.min(retryCount + 1, 6);
        retryTimer = setTimeout(connect, delay);
      };
    }

    connect();
    return () => {
      mounted = false;
      es?.close();
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, []);

  return { ticks, connected };
}
