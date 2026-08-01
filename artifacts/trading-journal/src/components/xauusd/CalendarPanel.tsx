import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { Calendar, ChevronDown, ChevronLeft, ChevronRight, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { API_BASE } from '@/lib/api';
import { addDays, subDays, isToday } from 'date-fns';
import { useSystemTimezone, toZonedParts, formatDateLabel } from '@/lib/timezone';

interface CalendarEvent {
  id: string;
  country: string;
  date: string;
  time: string;
  /** UTC ISO datetime — canonical source of truth for display; date/time above are the raw ET release wall-time as a fallback. */
  datetimeUtc?: string;
  impact: 'low' | 'medium' | 'high';
  title: string;
  actual: string | null;
  forecast: string | null;
  previous: string | null;
  description: string;
  goldImpact: string;
}

function ImpactDots({ impact }: { impact: string }) {
  return (
    <div className="flex gap-[3px] items-center">
      <div className={cn('w-1.5 h-3.5 rounded-sm', ['low','medium','high'].includes(impact) ? 'bg-[#f0b90b]' : 'bg-[#2a2a3e]')} />
      <div className={cn('w-1.5 h-3.5 rounded-sm', ['medium','high'].includes(impact) ? 'bg-[#f0b90b]' : 'bg-[#2a2a3e]')} />
      <div className={cn('w-1.5 h-3.5 rounded-sm', impact === 'high' ? 'bg-[#ef5350]' : 'bg-[#2a2a3e]')} />
    </div>
  );
}

function ActualVsForecast({ actual, forecast }: { actual: string | null; forecast: string | null }) {
  if (!actual || !forecast) return null;
  const actualNum = parseFloat(actual.replace(/[^0-9.-]/g, ''));
  const forecastNum = parseFloat(forecast.replace(/[^0-9.-]/g, ''));
  if (isNaN(actualNum) || isNaN(forecastNum)) return null;
  const isBetter = actualNum > forecastNum;
  const isWorse = actualNum < forecastNum;
  return (
    <span className={cn(
      'flex items-center gap-0.5 text-[10px] font-mono font-bold px-1.5 py-0.5 rounded',
      isBetter ? 'bg-[#26a69a]/20 text-[#26a69a]' :
      isWorse ? 'bg-[#ef5350]/20 text-[#ef5350]' :
      'bg-[#2a2a3e] text-[#9598a1]'
    )}>
      {isBetter ? <TrendingUp className="w-2.5 h-2.5" /> : isWorse ? <TrendingDown className="w-2.5 h-2.5" /> : <Minus className="w-2.5 h-2.5" />}
      {isBetter ? 'BEAT' : isWorse ? 'MISS' : 'IN LINE'}
    </span>
  );
}

export function CalendarPanel() {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const { offsetMinutes, labelWithCity: tzLabelWithCity } = useSystemTimezone();

  const { data, isLoading } = useQuery<CalendarEvent[]>({
    queryKey: ['/api/xauusd/calendar'],
    queryFn: () => fetch(`${API_BASE}/api/xauusd/calendar`, { credentials: 'include' }).then(r => r.json()),
  });

  const selectedKey = `${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, '0')}-${String(selectedDate.getDate()).padStart(2, '0')}`;

  // Every event carries its own UTC instant, then gets re-grouped and
  // re-timed for the day/hour it falls on in the user's chosen System
  // Timezone (Settings → System Timezone) — instead of the old behavior of
  // just echoing the raw ET release date/time regardless of that setting.
  const zonedEvents = React.useMemo(() => {
    if (!data) return [];
    return data.map(ev => {
      const source = ev.datetimeUtc ?? `${ev.date}T${ev.time}:00Z`;
      const zoned = toZonedParts(source, offsetMinutes);
      return { ...ev, zonedDateKey: zoned.dateKey, zonedTime: zoned.timeLabel };
    });
  }, [data, offsetMinutes]);

  const eventsForSelectedDate = React.useMemo(() => {
    return zonedEvents
      .filter(ev => ev.zonedDateKey === selectedKey)
      .sort((a, b) => a.zonedTime.localeCompare(b.zonedTime));
  }, [zonedEvents, selectedKey]);

  const goToPrevDay = () => setSelectedDate(d => subDays(d, 1));
  const goToNextDay = () => setSelectedDate(d => addDays(d, 1));
  const goToToday = () => setSelectedDate(new Date());

  return (
    <div className="rounded-lg border border-[#2a2a3e] overflow-hidden" style={{ background: '#0d0d14' }}>
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[#2a2a3e]">
        <Calendar className="w-4 h-4 text-[#f0b90b]" />
        <span className="text-sm font-bold text-[#d1d4dc] tracking-wide">Economic Calendar</span>
        <span className="ml-auto text-[10px] font-mono text-[#9598a1]">GOLD-RELEVANT EVENTS · TIMES IN {tzLabelWithCity}</span>
      </div>

      {/* Date navigation */}
      <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-[#2a2a3e] bg-[#0d0d1a]">
        <button
          onClick={goToPrevDay}
          className="p-1.5 rounded hover:bg-[#1a1a2e] text-[#9598a1] hover:text-[#d1d4dc] transition-colors"
          aria-label="Previous day"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        <button
          onClick={goToToday}
          className="flex flex-col items-center gap-0.5 hover:opacity-80 transition-opacity"
        >
          <span className="text-sm font-bold text-[#d1d4dc]">
            {formatDateLabel(selectedDate)}
          </span>
          {!isToday(selectedDate) && (
            <span className="text-[9px] font-mono text-[#f0b90b] uppercase tracking-widest">
              Jump to today
            </span>
          )}
        </button>

        <button
          onClick={goToNextDay}
          className="p-1.5 rounded hover:bg-[#1a1a2e] text-[#9598a1] hover:text-[#d1d4dc] transition-colors"
          aria-label="Next day"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {isLoading ? (
        <div className="p-4 space-y-3">
          {[1,2,3,4].map(i => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-3 w-24 bg-[#1a1a2e]" />
              <Skeleton className="h-12 w-full bg-[#1a1a2e]" />
            </div>
          ))}
        </div>
      ) : (
        <div className="divide-y divide-[#1a1a2e]">
          {eventsForSelectedDate.map(event => {
                const isOpen = expanded === event.id;
                return (
                  <div key={event.id} className="border-b border-[#151520] last:border-0">
                    {/* Main row — clickable */}
                    <button
                      className="w-full text-left px-4 py-3 hover:bg-[#111120] transition-colors group"
                      onClick={() => setExpanded(isOpen ? null : event.id)}
                    >
                      <div className="flex items-center gap-3">
                        {/* Impact + country */}
                        <ImpactDots impact={event.impact} />
                        <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-[#1a1a2e] text-[#9598a1] shrink-0">
                          {event.country}
                        </span>
                        <span className="text-[11px] font-mono text-[#9598a1] shrink-0">{event.zonedTime}</span>

                        {/* Title */}
                        <span className="text-sm font-medium text-[#d1d4dc] flex-1 min-w-0 truncate">
                          {event.title}
                        </span>

                        {/* Actual vs Forecast */}
                        {event.actual && event.forecast && (
                          <ActualVsForecast actual={event.actual} forecast={event.forecast} />
                        )}

                        {/* Stats */}
                        <div className="hidden sm:flex items-center gap-3 shrink-0">
                          <StatPill label="ACT" value={event.actual} highlight />
                          <StatPill label="FCT" value={event.forecast} />
                          <StatPill label="PRV" value={event.previous} dim />
                        </div>

                        {/* Chevron */}
                        <ChevronDown className={cn(
                          'w-4 h-4 text-[#758696] shrink-0 transition-transform duration-200',
                          isOpen && 'rotate-180'
                        )} />
                      </div>

                      {/* Mobile stats */}
                      <div className="sm:hidden flex gap-3 mt-2 pl-5">
                        <StatPill label="ACT" value={event.actual} highlight />
                        <StatPill label="FCT" value={event.forecast} />
                        <StatPill label="PRV" value={event.previous} dim />
                      </div>
                    </button>

                    {/* Expanded details */}
                    {isOpen && (
                      <div className="px-4 pb-4 pt-0 bg-[#0a0a12] border-t border-[#1a1a2e] animate-in slide-in-from-top-1 duration-200">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-3">
                          {/* Description */}
                          <div className="space-y-2">
                            <h4 className="text-[10px] font-mono font-bold text-[#f0b90b] uppercase tracking-widest">About This Event</h4>
                            <p className="text-sm text-[#9598a1] leading-relaxed">{event.description}</p>
                          </div>

                          {/* Gold Impact + Numbers */}
                          <div className="space-y-3">
                            <div className="rounded-lg bg-[#111120] border border-[#2a2a3e] p-3 space-y-1">
                              <h4 className="text-[10px] font-mono font-bold text-[#f0b90b] uppercase tracking-widest mb-2">XAU/USD Impact</h4>
                              <p className="text-sm text-[#d1d4dc] leading-relaxed">{event.goldImpact}</p>
                            </div>

                            {/* Numbers breakdown */}
                            <div className="grid grid-cols-3 gap-2">
                              <DetailCell label="Actual" value={event.actual} type="actual" forecast={event.forecast} />
                              <DetailCell label="Forecast" value={event.forecast} type="forecast" />
                              <DetailCell label="Previous" value={event.previous} type="previous" />
                            </div>

                            {/* Impact badge */}
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-mono text-[#758696]">Market Impact:</span>
                              <span className={cn(
                                'text-[10px] font-mono font-bold px-2 py-0.5 rounded uppercase',
                                event.impact === 'high' ? 'bg-[#ef5350]/20 text-[#ef5350]' :
                                event.impact === 'medium' ? 'bg-[#f0b90b]/20 text-[#f0b90b]' :
                                'bg-[#2a2a3e] text-[#9598a1]'
                              )}>
                                {event.impact}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

          {eventsForSelectedDate.length === 0 && (
            <div className="p-10 text-center">
              <Calendar className="w-8 h-8 text-[#2a2a3e] mx-auto mb-3" />
              <p className="text-sm text-[#758696] font-mono">No high-impact events on this date</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatPill({ label, value, highlight, dim }: { label: string; value: string | null; highlight?: boolean; dim?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="text-[9px] font-mono text-[#758696] uppercase">{label}</span>
      <span className={cn(
        'text-xs font-mono font-bold',
        highlight && value ? 'text-[#26a69a]' :
        dim ? 'text-[#758696]' :
        'text-[#d1d4dc]'
      )}>
        {value ?? '—'}
      </span>
    </div>
  );
}

function DetailCell({
  label, value, type, forecast
}: {
  label: string; value: string | null; type: 'actual' | 'forecast' | 'previous'; forecast?: string | null;
}) {
  let accent = '#d1d4dc';
  if (type === 'actual' && value && forecast) {
    const a = parseFloat(value.replace(/[^0-9.-]/g, ''));
    const f = parseFloat(forecast.replace(/[^0-9.-]/g, ''));
    if (!isNaN(a) && !isNaN(f)) {
      accent = a > f ? '#26a69a' : a < f ? '#ef5350' : '#d1d4dc';
    }
  } else if (type === 'forecast') accent = '#f0b90b';
  else if (type === 'previous') accent = '#758696';

  return (
    <div className="flex flex-col gap-1 rounded-lg bg-[#0d0d14] border border-[#2a2a3e] p-2.5">
      <span className="text-[9px] font-mono uppercase text-[#758696]">{label}</span>
      <span className="text-base font-mono font-bold" style={{ color: accent }}>
        {value ?? '—'}
      </span>
    </div>
  );
}
