import React, { useState, useRef, useEffect, useCallback } from 'react';
import { API_BASE } from '@/lib/api';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { useAuth } from '@clerk/react';
import { ZoomIn, ZoomOut, ChevronLeft, ChevronRight } from 'lucide-react';

type Timeframe = '1m';

interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface CrosshairState {
  x: number;
  y: number;
  idx: number;
}

const TV = {
  bg: '#0d0d14',
  grid: '#1a1a2e',
  border: '#2a2a3e',
  text: '#9598a1',
  textBright: '#d1d4dc',
  green: '#26a69a',
  red: '#ef5350',
  crosshair: '#758696',
  priceLabel: '#f0b90b',
  volume: 'rgba(38,166,154,0.22)',
  volumeDown: 'rgba(239,83,80,0.22)',
  liveLine: '#f0b90b',
  tickPulse: 'rgba(240,185,11,0.15)',
};

const PAD = { top: 12, right: 80, bottom: 30, left: 8 };

function getRange(_tf: Timeframe) {
  return '1d';
}

function fmtPrice(p: number) {
  return p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtTime(ts: number, tf: Timeframe) {
  const d = new Date(ts);
  if (tf === '1d') return format(d, 'MMM d');
  if (tf === '4h' || tf === '1h') return format(d, 'MMM d HH:mm');
  return format(d, 'HH:mm');
}

type ViewMode = 'line' | 'footprint';

interface FootprintRow {
  priceLow: number;
  priceHigh: number;
  buyVol: number;
  sellVol: number;
  totalVol: number;
}

// Synthesizes per-price-level buy/sell volume from OHLCV data (no raw tick/DOM
// feed is available). Same buy/sell-ratio heuristic used in OrderFlowPanel,
// weighted per row by proximity to open/close so activity clusters realistically.
function computeFootprintRows(c: Candle, rows: number): FootprintRow[] {
  const range = (c.high - c.low) || 0.01;
  const isBull = c.close >= c.open;
  const bodySize = Math.abs(c.close - c.open);
  const vol = c.volume || 1000;
  const buyVolTotal = isBull
    ? vol * (0.5 + (bodySize / range) * 0.45)
    : vol * (0.5 - (bodySize / range) * 0.35);
  const buyRatio = vol > 0 ? buyVolTotal / vol : 0.5;

  const openPos = (c.open - c.low) / range;
  const closePos = (c.close - c.low) / range;
  const rowH = range / rows;

  const weights: number[] = [];
  for (let i = 0; i < rows; i++) {
    const mid = (i + 0.5) / rows;
    const wOpen = Math.exp(-((mid - openPos) ** 2) / (2 * 0.05));
    const wClose = Math.exp(-((mid - closePos) ** 2) / (2 * 0.05));
    weights.push(0.25 + wOpen * 1.5 + wClose * 1.5);
  }
  const wSum = weights.reduce((a, b) => a + b, 0) || 1;

  const out: FootprintRow[] = [];
  for (let i = 0; i < rows; i++) {
    const priceLow = c.low + i * rowH;
    const priceHigh = priceLow + rowH;
    const rowVol = vol * (weights[i] / wSum);
    const relPos = (i + 0.5) / rows;
    const skew = isBull ? (relPos - 0.5) * 0.3 : (0.5 - relPos) * 0.3;
    const rowBuyRatio = Math.min(0.92, Math.max(0.08, buyRatio + skew));
    const buyVol = rowVol * rowBuyRatio;
    const sellVol = rowVol - buyVol;
    out.push({ priceLow, priceHigh, buyVol, sellVol, totalVol: rowVol });
  }
  return out;
}

// Maps buy/sell imbalance (-1 = all sell, +1 = all buy) to a red-white-green cell color
function biasToColor(bias: number): string {
  const b = Math.max(-1, Math.min(1, bias));
  const stops: [number, [number, number, number]][] = [
    [-1, [122, 24, 24]],
    [-0.4, [176, 62, 62]],
    [0, [214, 216, 222]],
    [0.4, [58, 150, 126]],
    [1, [16, 92, 74]],
  ];
  for (let i = 0; i < stops.length - 1; i++) {
    const [p0, c0] = stops[i];
    const [p1, c1] = stops[i + 1];
    if (b >= p0 && b <= p1) {
      const t = (b - p0) / (p1 - p0 || 1);
      const r = Math.round(c0[0] + (c1[0] - c0[0]) * t);
      const g = Math.round(c0[1] + (c1[1] - c0[1]) * t);
      const bl = Math.round(c0[2] + (c1[2] - c0[2]) * t);
      return `rgb(${r},${g},${bl})`;
    }
  }
  return 'rgb(214,216,222)';
}

interface Computed {
  toY: (p: number) => number;
  toX: (i: number) => number;
  toPrice: (y: number) => number;
  step: number;
  candleW: number;
  yTicks: { price: number; y: number }[];
  xTickIndices: number[];
  minP: number;
  maxP: number;
  visibleSlice: Candle[];
  chartH: number;
}

function compute(
  candles: Candle[], W: number, H: number, offset: number, visCount: number, livePrice: number | null = null
): Computed | null {
  if (!candles.length || W <= 0 || H <= 0) return null;
  const pw = W - PAD.left - PAD.right;
  const ph = H - PAD.top - PAD.bottom;
  if (pw <= 0 || ph <= 0) return null;

  const chartH = ph;

  const count = Math.min(visCount, candles.length);
  const end = Math.min(candles.length, Math.max(count, candles.length - offset));
  const start = Math.max(0, end - count);
  const visible = candles.slice(start, end);
  if (!visible.length) return null;

  const prices = visible.flatMap(c => [c.high, c.low]);
  // Include the live tick in the scale so it's always visible, WITHOUT stretching
  // any individual candle's own high/low — mutating a candle's range to reach a
  // fast-moving live price is what previously caused one candle to balloon and
  // squash every other candle flat.
  if (end === candles.length && typeof livePrice === 'number') prices.push(livePrice);
  const rawMin = Math.min(...prices);
  const rawMax = Math.max(...prices);
  const pr = rawMax - rawMin || 1;
  const minP = rawMin - pr * 0.04;
  const maxP = rawMax + pr * 0.06;
  const pRange = maxP - minP;

  const toY = (p: number) => PAD.top + chartH - ((p - minP) / pRange) * chartH;
  const toPrice = (y: number) => minP + ((PAD.top + chartH - y) / chartH) * pRange;
  const step = pw / visible.length;
  const candleW = Math.max(1, Math.min(18, step * 0.6));
  const toX = (i: number) => PAD.left + i * step + step / 2;

  const Y_TICKS = 7;
  const yTicks = Array.from({ length: Y_TICKS }, (_, i) => {
    const price = minP + (pRange / (Y_TICKS - 1)) * i;
    return { price, y: toY(price) };
  });

  const maxXT = Math.min(8, visible.length);
  const xTickIndices = Array.from({ length: maxXT }, (_, i) =>
    Math.round((i / Math.max(1, maxXT - 1)) * (visible.length - 1))
  );

  return { toY, toX, toPrice, step, candleW, yTicks, xTickIndices, minP, maxP, visibleSlice: visible, chartH };
}

export function ChartPanel() {
  const timeframe: Timeframe = '1m';
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 0, h: 0 });
  const [crosshair, setCrosshair] = useState<CrosshairState | null>(null);
  const [visibleCount, setVisibleCount] = useState(100);
  const [panOffset, setPanOffset] = useState(0);
  const [mode, setMode] = useState<ViewMode>('line');
  const [livePrice, setLivePrice] = useState<number | null>(null);
  const [liveFlash, setLiveFlash] = useState<'up' | 'down' | null>(null);
  const [tickPulse, setTickPulse] = useState(false);
  const [marketOpen, setMarketOpen] = useState<boolean | null>(null);
  const dragRef = useRef<{ startX: number; startOff: number } | null>(null);
  const lastLiveRef = useRef<number | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pulseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { isSignedIn } = useAuth();

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setDims({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    setDims({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // Live SSE — shared free live-price feed (no auth needed).
  useEffect(() => {
    let mounted = true;
    let abortController = new AbortController();
    let retryCount = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    async function connect() {
      if (!mounted) return;
      try {
        const headers: Record<string, string> = { Accept: 'text/event-stream' };

        const response = await fetch(`${API_BASE}/api/xauusd/live-price`, {
          headers,
          credentials: 'include',
          signal: abortController.signal,
        });

        if (!response.ok || !response.body) {
          throw new Error(`SSE connect failed: ${response.status}`);
        }

        retryCount = 0;
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done, value } = await reader.read();
          if (done || !mounted) break;

          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split('\n\n');
          buffer = parts.pop() ?? '';

          for (const part of parts) {
            const dataLine = part.split('\n').find(l => l.startsWith('data:'));
            if (!dataLine) continue;
            try {
              const d = JSON.parse(dataLine.slice('data:'.length).trim());
              if (typeof d.marketOpen === 'boolean' && mounted) setMarketOpen(d.marketOpen);
              // Market closed: freeze the price/flash/pulse entirely — only
              // the status flag above is allowed to change.
              if (d.marketOpen === false) continue;
              if (typeof d.price === 'number') {
                const prev = lastLiveRef.current;
                const dir = prev !== null
                  ? (d.price > prev ? 'up' : d.price < prev ? 'down' : null)
                  : null;

                if (dir) {
                  if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
                  if (mounted) setLiveFlash(dir);
                  flashTimerRef.current = setTimeout(() => { if (mounted) setLiveFlash(null); }, 600);
                }

                if (pulseTimerRef.current) clearTimeout(pulseTimerRef.current);
                if (mounted) setTickPulse(true);
                pulseTimerRef.current = setTimeout(() => { if (mounted) setTickPulse(false); }, 400);

                lastLiveRef.current = d.price;
                if (mounted) setLivePrice(d.price);
              }
            } catch { /* ignore parse errors */ }
          }
        }

        if (mounted) retryTimer = setTimeout(connect, 1500);
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        if (mounted) {
          const delay = Math.min(2000 * 1.5 ** retryCount, 15000);
          retryCount = Math.min(retryCount + 1, 6);
          retryTimer = setTimeout(connect, delay);
        }
      }
    }

    connect();
    return () => {
      mounted = false;
      abortController.abort();
      if (retryTimer) clearTimeout(retryTimer);
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      if (pulseTimerRef.current) clearTimeout(pulseTimerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn]);

  const { data: chartData, isLoading } = useQuery({
    queryKey: ['xauusd/chart', timeframe],
    queryFn: () => fetch(`${API_BASE}/api/xauusd/chart?interval=${timeframe}&range=${getRange(timeframe)}`, { credentials: 'include' }).then(r => r.json()),
    refetchInterval: marketOpen === false ? false : 20_000,
  });

  const rawCandles: Candle[] = chartData?.candles ?? [];

  // The /xauusd/chart endpoint returns Yahoo's GC=F futures candles, which
  // trade at a different absolute price than the live spot feed shown in the
  // ticker (futures/spot basis, commonly tens of dollars apart). Without
  // correcting for this, the last candle sits at the futures price while the
  // live tick jumps to the spot price, which looked like the chart
  // "collapsing" in a straight vertical drop at the right edge. Rebase every
  // candle by a constant offset so the whole series sits on the live scale —
  // same fix already applied in TechnicalsPanel / VolumeProfilePanel / FibonacciPanel.
  //
  // Captured ONCE per backend fetch (not recomputed on every live tick), so
  // historical candles don't jitter — only the live last close tracks the tick.
  const offsetRef = useRef<number | null>(null);
  const lastCandlesRef = useRef<Candle[]>([]);
  if (rawCandles !== lastCandlesRef.current) {
    lastCandlesRef.current = rawCandles;
    offsetRef.current = null;
  }
  if (offsetRef.current === null && rawCandles.length && typeof livePrice === 'number') {
    offsetRef.current = livePrice - rawCandles[rawCandles.length - 1].close;
  }
  const priceOffset = offsetRef.current ?? 0;

  const rebasedCandles: Candle[] = rawCandles.map(c => ({
    ...c,
    open: c.open + priceOffset,
    high: c.high + priceOffset,
    low: c.low + priceOffset,
    close: c.close + priceOffset,
  }));

  // Live tick still updates the last candle's close in real time (on top of
  // the frozen offset), for continuity between backend refetches.
  const candles: Candle[] = rebasedCandles.length && livePrice !== null
    ? rebasedCandles.map((c, i) =>
        i === rebasedCandles.length - 1
          ? { ...c, close: livePrice }
          : c)
    : rebasedCandles;

  useEffect(() => {
    if (mode === 'footprint') setVisibleCount(v => Math.min(v, 30));
  }, [mode]);

  const clampedVisible = Math.min(Math.max(10, visibleCount), Math.max(10, candles.length));
  const clampedOffset = Math.max(0, Math.min(panOffset, candles.length - clampedVisible));
  const comp = compute(candles, dims.w, dims.h, clampedOffset, clampedVisible, livePrice);

  // Canvas draw
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !comp || dims.w === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = dims.w * dpr;
    canvas.height = dims.h * dpr;
    ctx.scale(dpr, dpr);

    const { toY, toX, step, yTicks, xTickIndices, visibleSlice, chartH, minP, maxP } = comp;

    // Background
    ctx.fillStyle = TV.bg;
    ctx.fillRect(0, 0, dims.w, dims.h);

    // Tick pulse glow on last candle area
    if (tickPulse && livePrice !== null && livePrice >= minP && livePrice <= maxP) {
      const lastIdx = visibleSlice.length - 1;
      const lx = toX(lastIdx);
      const ly = toY(livePrice);
      const grad = ctx.createRadialGradient(lx, ly, 0, lx, ly, step * 2);
      grad.addColorStop(0, 'rgba(240,185,11,0.18)');
      grad.addColorStop(1, 'rgba(240,185,11,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(lx - step * 2, PAD.top, step * 4, chartH);
    }

    // Horizontal grid lines
    ctx.strokeStyle = TV.grid;
    ctx.lineWidth = 0.5;
    for (const { y } of yTicks) {
      ctx.beginPath();
      ctx.moveTo(PAD.left, y);
      ctx.lineTo(dims.w - PAD.right, y);
      ctx.stroke();
    }

    // Vertical grid lines
    for (const i of xTickIndices) {
      const x = toX(i);
      ctx.strokeStyle = TV.grid;
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(x, PAD.top);
      ctx.lineTo(x, PAD.top + chartH);
      ctx.stroke();
    }

    // Volume Footprint — per-candle price-level buy/sell boxes
    if (mode === 'footprint' && visibleSlice.length > 0) {
      visibleSlice.forEach((c, i) => {
        const cx = toX(i);
        const yTop = toY(c.high);
        const yBot = toY(c.low);
        const boxH = yBot - yTop;
        const boxW = Math.max(20, Math.min(step * 0.86, 70));
        const rows = Math.max(3, Math.min(14, Math.floor(boxH / 12)));
        const footRows = computeFootprintRows(c, rows);
        const pocIdx = footRows.reduce(
          (best, r, idx, arr) => (r.totalVol > arr[best].totalVol ? idx : best), 0
        );

        footRows.forEach((r, ridx) => {
          const rowYTop = toY(r.priceHigh);
          const rowYBot = toY(r.priceLow);
          const rh = Math.max(1, rowYBot - rowYTop);
          const total = r.buyVol + r.sellVol;
          const bias = total > 0 ? (r.buyVol - r.sellVol) / total : 0;
          const cellColor = biasToColor(bias);

          ctx.fillStyle = cellColor;
          ctx.fillRect(cx - boxW / 2 + 1, rowYTop + 0.5, boxW - 2, Math.max(1, rh - 1));

          if (ridx === pocIdx) {
            ctx.strokeStyle = TV.priceLabel;
            ctx.lineWidth = 1.25;
            ctx.strokeRect(cx - boxW / 2 + 0.5, rowYTop, boxW - 1, rh);
          }

          if (rh >= 10 && boxW >= 22) {
            ctx.font = `${Math.min(9, rh - 2)}px monospace`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = Math.abs(bias) >= 0.42 ? '#f5f5f5' : '#14161c';
            ctx.fillText(Math.round(total).toString(), cx, rowYTop + rh / 2);
          }
        });

        ctx.strokeStyle = TV.border;
        ctx.lineWidth = 1;
        ctx.strokeRect(cx - boxW / 2, yTop, boxW, boxH);

        const isUp = c.close >= c.open;
        ctx.fillStyle = isUp ? TV.green : TV.red;
        ctx.fillRect(cx - boxW / 2, yTop - 3, boxW, 2);
      });

      // Dotted price path connecting each candle's close — mirrors the trace
      // seen on the reference footprint chart.
      if (visibleSlice.length > 1) {
        ctx.strokeStyle = 'rgba(240,185,11,0.85)';
        ctx.lineWidth = 1.25;
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        visibleSlice.forEach((c, i) => {
          const px = toX(i);
          const py = toY(c.close);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // Line chart — area fill below the close line
    if (mode === 'line' && visibleSlice.length > 1) {
      const areaBottom = PAD.top + chartH;

      // Gradient fill
      const grad = ctx.createLinearGradient(0, PAD.top, 0, areaBottom);
      grad.addColorStop(0,   'rgba(240,185,11,0.22)');
      grad.addColorStop(0.6, 'rgba(240,185,11,0.06)');
      grad.addColorStop(1,   'rgba(240,185,11,0.00)');

      ctx.beginPath();
      ctx.moveTo(toX(0), toY(visibleSlice[0].close));
      for (let i = 1; i < visibleSlice.length; i++) {
        ctx.lineTo(toX(i), toY(visibleSlice[i].close));
      }
      // close path down to bottom for fill
      ctx.lineTo(toX(visibleSlice.length - 1), areaBottom);
      ctx.lineTo(toX(0), areaBottom);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();

      // Line itself
      const lastC  = visibleSlice[visibleSlice.length - 1];
      const lineCol = liveFlash === 'up'   ? '#2ecc9f'
                    : liveFlash === 'down' ? '#ff6b6b'
                    : TV.liveLine;
      ctx.beginPath();
      ctx.moveTo(toX(0), toY(visibleSlice[0].close));
      for (let i = 1; i < visibleSlice.length; i++) {
        ctx.lineTo(toX(i), toY(visibleSlice[i].close));
      }
      ctx.strokeStyle = lineCol;
      ctx.lineWidth = 1.8;
      ctx.lineJoin = 'round';
      ctx.stroke();

      // Dot on last point
      const lastX = toX(visibleSlice.length - 1);
      const lastY = toY(lastC.close);
      ctx.beginPath();
      ctx.arc(lastX, lastY, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = lineCol;
      ctx.fill();
      // Outer ring (pulse)
      if (tickPulse) {
        ctx.beginPath();
        ctx.arc(lastX, lastY, 6, 0, Math.PI * 2);
        ctx.strokeStyle = lineCol;
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.45;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    // Live price dashed horizontal line
    if (livePrice !== null && livePrice >= minP && livePrice <= maxP) {
      const ly = toY(livePrice);
      ctx.strokeStyle = TV.liveLine;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(PAD.left, ly);
      ctx.lineTo(dims.w - PAD.right, ly);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Y-axis price labels
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = `11px monospace`;
    for (const { price, y } of yTicks) {
      ctx.fillStyle = TV.text;
      ctx.fillText(fmtPrice(price), dims.w - PAD.right + 4, y);
    }

    // Live price label on right axis
    if (livePrice !== null && livePrice >= minP && livePrice <= maxP) {
      const ly = toY(livePrice);
      const label = fmtPrice(livePrice);
      const boxColor = liveFlash === 'up' ? '#26a69a' : liveFlash === 'down' ? '#ef5350' : TV.liveLine;
      ctx.fillStyle = boxColor;
      ctx.fillRect(dims.w - PAD.right, ly - 9, PAD.right - 2, 18);
      ctx.fillStyle = liveFlash ? '#fff' : '#0d0d14';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.font = 'bold 11px monospace';
      ctx.fillText(label, dims.w - PAD.right + 4, ly);
    }

    // X-axis time labels
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = '10px monospace';
    ctx.fillStyle = TV.text;
    for (const i of xTickIndices) {
      const c = visibleSlice[i];
      if (!c) continue;
      const x = toX(i);
      ctx.fillText(fmtTime(c.time, timeframe), x, dims.h - PAD.bottom + 8);
    }

    // Border: right price axis separator
    ctx.strokeStyle = TV.border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(dims.w - PAD.right, PAD.top);
    ctx.lineTo(dims.w - PAD.right, dims.h - PAD.bottom);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(PAD.left, dims.h - PAD.bottom);
    ctx.lineTo(dims.w - PAD.right, dims.h - PAD.bottom);
    ctx.stroke();

    // Watermark
    ctx.save();
    ctx.globalAlpha = 0.04;
    ctx.fillStyle = '#f0b90b';
    ctx.font = 'bold 80px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('XAU/USD', dims.w / 2, (PAD.top + chartH) / 2 + PAD.top);
    ctx.restore();

    // Crosshair
    if (crosshair) {
      const { x, y, idx } = crosshair;
      const c = visibleSlice[idx];
      if (!c) return;

      ctx.strokeStyle = TV.crosshair;
      ctx.lineWidth = 0.75;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(x, PAD.top);
      ctx.lineTo(x, dims.h - PAD.bottom);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(PAD.left, y);
      ctx.lineTo(dims.w - PAD.right, y);
      ctx.stroke();
      ctx.setLineDash([]);

      const crossPrice = comp.toPrice(y);
      if (crossPrice >= minP && crossPrice <= maxP) {
        ctx.fillStyle = TV.crosshair;
        ctx.fillRect(dims.w - PAD.right, y - 9, PAD.right - 2, 18);
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.font = '10px monospace';
        ctx.fillText(fmtPrice(crossPrice), dims.w - PAD.right + 4, y);
      }

      const tlabel = fmtTime(c.time, timeframe);
      const tw = tlabel.length * 6.5 + 10;
      const tx = Math.min(Math.max(PAD.left, x - tw / 2), dims.w - PAD.right - tw);
      ctx.fillStyle = TV.crosshair;
      ctx.fillRect(tx, dims.h - PAD.bottom + 1, tw, 16);
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '10px monospace';
      ctx.fillText(tlabel, tx + tw / 2, dims.h - PAD.bottom + 9);

      const isUp = c.close >= c.open;
      const color = isUp ? TV.green : TV.red;
      // Line chart info: show Close prominently + H/L range
      const infoItems = [
        { label: 'C', val: fmtPrice(c.close), highlight: true },
        { label: 'H', val: fmtPrice(c.high),  highlight: false },
        { label: 'L', val: fmtPrice(c.low),   highlight: false },
      ];
      const bx = PAD.left + 4, by = PAD.top + 4;
      const bh2 = 20;
      infoItems.forEach(({ label, val, highlight }, i) => {
        ctx.font = highlight ? 'bold 11px monospace' : '11px monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = TV.text;
        ctx.fillText(label + ':', bx + i * 60, by + bh2 / 2);
        ctx.fillStyle = highlight ? color : TV.textBright;
        ctx.fillText(val, bx + i * 60 + 14, by + bh2 / 2);
      });
    }

  }, [comp, crosshair, livePrice, liveFlash, tickPulse, timeframe, dims, mode]);

  const onMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!comp || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const { step, visibleSlice } = comp;
    const idx = Math.round((x - PAD.left - step / 2) / step);
    if (idx >= 0 && idx < visibleSlice.length) {
      setCrosshair({ x, y, idx });
    }
  }, [comp]);

  const onMouseLeave = useCallback(() => setCrosshair(null), []);

  const onWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const delta = e.deltaY;
    setVisibleCount(v => Math.min(Math.max(10, Math.round(v * (delta > 0 ? 1.1 : 0.9))), candles.length || 200));
  }, [candles.length]);

  // Toolbar zoom buttons — same scaling factor as the wheel handler
  const zoomIn = useCallback(() => {
    setVisibleCount(v => Math.max(10, Math.round(v * 0.85)));
  }, []);
  const zoomOut = useCallback(() => {
    setVisibleCount(v => Math.min(Math.round(v * 1.18), candles.length || 200));
  }, [candles.length]);

  // Toolbar pan buttons — shift by ~20% of the visible window per click
  const panLeft = useCallback(() => {
    setPanOffset(o => Math.max(0, Math.min(o + Math.max(1, Math.round(clampedVisible * 0.2)), candles.length - clampedVisible)));
  }, [candles.length, clampedVisible]);
  const panRight = useCallback(() => {
    setPanOffset(o => Math.max(0, o - Math.max(1, Math.round(clampedVisible * 0.2))));
  }, [clampedVisible]);

  const onMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current) return;
    dragRef.current = { startX: e.clientX, startOff: clampedOffset };
  }, [clampedOffset]);

  const onMouseUp = useCallback(() => { dragRef.current = null; }, []);

  const onMouseMoveCanvas = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    onMouseMove(e);
    if (dragRef.current && comp) {
      const dx = e.clientX - dragRef.current.startX;
      const candlesDx = Math.round(-dx / comp.step);
      const newOff = Math.max(0, Math.min(dragRef.current.startOff + candlesDx, candles.length - clampedVisible));
      setPanOffset(newOff);
    }
  }, [onMouseMove, comp, candles.length, clampedVisible]);

  return (
    <div className="flex flex-col h-full w-full rounded-lg overflow-hidden border border-[#2a2a3e]" style={{ background: TV.bg, minHeight: 520 }}>
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-[#2a2a3e] flex-shrink-0">
        <span className="text-xs font-bold text-[#f0b90b] font-mono tracking-widest mr-3">XAU/USD</span>
        <div className="flex items-center rounded border border-[#2a2a3e] overflow-hidden">
          {(['line', 'footprint'] as ViewMode[]).map((m, idx) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={cn(
                'text-[10px] font-mono px-2.5 py-1 transition-colors capitalize',
                idx > 0 && 'border-l border-[#2a2a3e]',
                mode === m
                  ? 'text-[#f0b90b] bg-[#f0b90b]/10'
                  : 'text-[#758696] hover:text-[#d1d4dc]'
              )}
              title={`Switch to ${m} chart`}
            >
              {m}
            </button>
          ))}
        </div>

        {/* Zoom + pan controls */}
        <div className="flex items-center rounded border border-[#2a2a3e] overflow-hidden ml-1">
          <button
            onClick={zoomOut}
            className="p-1 text-[#758696] hover:text-[#d1d4dc] transition-colors"
            title="Zoom out"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={zoomIn}
            className="p-1 border-l border-[#2a2a3e] text-[#758696] hover:text-[#d1d4dc] transition-colors"
            title="Zoom in"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="flex items-center rounded border border-[#2a2a3e] overflow-hidden">
          <button
            onClick={panLeft}
            className="p-1 text-[#758696] hover:text-[#d1d4dc] transition-colors"
            title="Pan left (older)"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={panRight}
            className="p-1 border-l border-[#2a2a3e] text-[#758696] hover:text-[#d1d4dc] transition-colors"
            title="Pan right (newer)"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="ml-auto flex items-center gap-3 text-xs font-mono">
          {livePrice !== null && (
            <span className={cn(
              'px-2 py-0.5 rounded font-bold transition-colors duration-200',
              liveFlash === 'up'   ? 'bg-[#26a69a] text-black' :
              liveFlash === 'down' ? 'bg-[#ef5350] text-white' :
              'text-[#f0b90b]'
            )}>
              {fmtPrice(livePrice)}
            </span>
          )}
          {/* Tick indicator */}
          <span className="flex items-center gap-1 text-[10px] text-[#758696]">
            <span
              className={cn(
                'inline-block w-1.5 h-1.5 rounded-full transition-colors duration-200',
                tickPulse ? 'bg-[#f0b90b]' : 'bg-[#3a3a4e]'
              )}
            />
            TICK
          </span>
          <span className="text-[#3a3a4e]">|</span>
          <span className="text-[#758696] text-[10px]">Scroll · Drag</span>
        </div>
      </div>

      {/* Canvas */}
      <div ref={containerRef} className="flex-1 relative" style={{ minHeight: 460 }}>
        {isLoading && candles.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <div className="w-8 h-8 border-2 border-[#f0b90b] border-t-transparent rounded-full animate-spin" />
              <span className="text-xs text-[#758696] font-mono">Loading chart data...</span>
            </div>
          </div>
        )}
        <canvas
          ref={canvasRef}
          style={{ width: '100%', height: '100%', cursor: 'crosshair', display: 'block' }}
          onMouseMove={onMouseMoveCanvas}
          onMouseLeave={onMouseLeave}
          onWheel={onWheel}
          onMouseDown={onMouseDown}
          onMouseUp={onMouseUp}
        />
      </div>
    </div>
  );
}
