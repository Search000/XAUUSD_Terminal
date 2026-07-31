import { useEffect, useRef, useState } from 'react';
import { API_BASE } from '@/lib/api';

/**
 * Subscribes to the single shared live-price SSE feed (/api/xauusd/live-price)
 * and returns the latest price.
 *
 * This is the SAME feed the "Gold / US Dollar · LIVE" ticker uses. Any panel
 * that shows a "current price" should use this hook instead of deriving the
 * number from its own Yahoo/GC=F candle data — otherwise panels end up
 * showing different prices (GC=F futures vs live spot) even though the user
 * sees them side by side as if they were the same number.
 */
export function useLivePrice(): number | null {
  const [price, setPrice] = useState<number | null>(null);
  const priceRef = useRef<number | null>(null);

  useEffect(() => {
    let es: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let retryCount = 0;
    let mounted = true;

    function connect() {
      if (!mounted) return;
      es = new EventSource(`${API_BASE}/api/xauusd/live-price`, { withCredentials: true });

      es.onopen = () => { retryCount = 0; };

      es.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (typeof data.price === 'number' && mounted) {
            priceRef.current = data.price;
            setPrice(data.price);
          }
        } catch { /* ignore parse errors */ }
      };

      es.onerror = () => {
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

  return price;
}
