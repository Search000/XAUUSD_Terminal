import React, { useState, useEffect } from 'react';
import { AppLayout } from '@/components/AppLayout';
import { LiveTicker } from '@/components/xauusd/LiveTicker';
import { ChartPanel } from '@/components/xauusd/ChartPanel';
import { CorrelationsPanel } from '@/components/xauusd/CorrelationsPanel';
import { TechnicalsPanel } from '@/components/xauusd/TechnicalsPanel';
import { NewsPanel } from '@/components/xauusd/NewsPanel';
import { SessionsPanel } from '@/components/xauusd/SessionsPanel';
import { CalendarPanel } from '@/components/xauusd/CalendarPanel';
import { SummaryPanel } from '@/components/xauusd/SummaryPanel';
import { HeatmapPanel } from '@/components/xauusd/HeatmapPanel';
import { VolatilityMeter } from '@/components/xauusd/VolatilityMeter';
import { OrderFlowPanel } from '@/components/xauusd/OrderFlowPanel';
import { FibonacciPanel } from '@/components/xauusd/FibonacciPanel';
import { SeasonalityChart } from '@/components/xauusd/SeasonalityChart';
import { InflationVsGold } from '@/components/xauusd/InflationVsGold';
import { FedRateTracker } from '@/components/xauusd/FedRateTracker';
import { CentralBankHoldings } from '@/components/xauusd/CentralBankHoldings';
import { MiningStocks } from '@/components/xauusd/MiningStocks';
import { HistoricalEvents } from '@/components/xauusd/HistoricalEvents';
import { VolumeProfilePanel } from '@/components/xauusd/VolumeProfilePanel';
import { FuturesCurvePanel } from '@/components/xauusd/FuturesCurvePanel';
import { CotHistoryPanel } from '@/components/xauusd/CotHistoryPanel';
import { GoldSilverRatioPanel } from '@/components/xauusd/GoldSilverRatioPanel';
import { VixPanel } from '@/components/xauusd/VixPanel';
import { VarStressPanel } from '@/components/xauusd/VarStressPanel';
import { OptionsFlowPanel } from '@/components/xauusd/OptionsFlowPanel';

/**
 * Panels are mounted in 4 progressive batches to avoid firing 20+ API
 * requests simultaneously on Render cold-start, which causes
 * ERR_HTTP2_SERVER_REFUSED_STREAM across all connections.
 *
 * Batch 1 (0 ms)   – critical above-the-fold: LiveTicker, Chart, Technicals
 * Batch 2 (600 ms) – sidebar + chart extras: Volatility, Sessions, Summary,
 *                    Heatmap, OrderFlow
 * Batch 3 (1 400 ms) – secondary content: News, Calendar, Fibonacci,
 *                    Correlations, FuturesCurve, VolumeProfile
 * Batch 4 (2 400 ms) – macro / historical: Seasonality, Inflation, FedRate,
 *                    CentralBank, Mining, HistoricalEvents
 * Batch 5 (3 600 ms) – lowest-priority extras: OptionsFlow (also has the
 *                    heaviest single request — a full options chain fetch —
 *                    so it's kept isolated from the batch 4 burst)
 */
const BATCH_DELAYS = [0, 600, 1400, 2400, 3600];

export function XauusdMonitorPage() {
  // batch goes 1 → 2 → 3 → 4 as timers fire
  const [batch, setBatch] = useState(1);

  /* progressive batch activation */
  useEffect(() => {
    const timers = BATCH_DELAYS.slice(1).map((delay, i) =>
      window.setTimeout(() => setBatch(i + 2), delay),
    );
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <AppLayout>
      <div className="min-h-screen bg-background text-foreground p-2 md:p-3 font-sans selection:bg-primary/30">
        <div className="max-w-[1800px] mx-auto flex flex-col gap-3">

          {/* ── Header row: LiveTicker ─────────────── */}
          <div className="flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <LiveTicker />
            </div>
          </div>

          {/* ── Row 1: Chart (big) + Right sidebar ───────────────────── */}
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-3 items-start">

            {/* Chart — dominant left */}
            <div className="xl:col-span-9 flex flex-col gap-3">
              {/* BATCH 1 – above the fold */}
              <div style={{ height: 520, overflow: 'hidden' }}>
                <ChartPanel />
              </div>

              {/* BATCH 2 – heatmap + order flow */}
              {batch >= 2 && <HeatmapPanel />}

              {/* BATCH 3 – calendar */}
              {batch >= 3 && <CalendarPanel />}

              {/* BATCH 2 – order flow */}
              {batch >= 2 && <OrderFlowPanel />}

              {/* BATCH 3 – fibonacci + seasonality */}
              {batch >= 3 && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <FibonacciPanel />
                  <SeasonalityChart />
                </div>
              )}

              {/* BATCH 3 – futures curve + volume profile */}
              {batch >= 3 && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <FuturesCurvePanel />
                  <VolumeProfilePanel />
                </div>
              )}

              {/* BATCH 3 – gold/silver ratio + VIX risk sentiment */}
              {batch >= 3 && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <GoldSilverRatioPanel />
                  <VixPanel />
                </div>
              )}

              {/* BATCH 4 – macro panels */}
              {batch >= 4 && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <InflationVsGold />
                  <FedRateTracker />
                </div>
              )}

              {batch >= 4 && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <CotHistoryPanel />
                  <VarStressPanel />
                </div>
              )}

              {batch >= 4 && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <CentralBankHoldings />
                  <MiningStocks />
                </div>
              )}

              {batch >= 5 && (
                <div style={{ minHeight: 320 }}>
                  <OptionsFlowPanel />
                </div>
              )}

              {batch >= 4 && (
                <div style={{ minHeight: 520 }}>
                  <HistoricalEvents />
                </div>
              )}

            </div>

            {/* ── Right sidebar ────────────────────────────────────── */}
            <div className="xl:col-span-3 flex flex-col gap-3">
              {/* BATCH 1 */}
              <TechnicalsPanel />
              {/* BATCH 2 */}
              {batch >= 2 && <VolatilityMeter />}
              {batch >= 2 && <SessionsPanel />}
              {batch >= 2 && <SummaryPanel />}
              {/* BATCH 3 – moved here from the left column to fill sidebar height */}
              {batch >= 3 && <NewsPanel />}
              {batch >= 3 && <CorrelationsPanel />}
            </div>
          </div>

        </div>
      </div>
    </AppLayout>
  );
}
