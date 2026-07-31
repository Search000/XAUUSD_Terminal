import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDistanceToNow } from 'date-fns';
import { ExternalLink, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { API_BASE } from '@/lib/api';

/* ── Sentiment keyword scorer ─────────────────────────────────────────── */
const BULLISH_WORDS = [
  'surge', 'surges', 'surged', 'rally', 'rallies', 'rallied', 'rise', 'rises', 'rose',
  'gain', 'gains', 'gained', 'soar', 'soars', 'soared', 'jump', 'jumps', 'jumped',
  'climb', 'climbs', 'climbed', 'high', 'record', 'breakout', 'demand', 'buying',
  'bull', 'bullish', 'upside', 'positive', 'strong', 'strength', 'support', 'boost',
  'inflow', 'safe haven', 'haven', 'hedge', 'inflation', 'rate cut', 'dovish',
];
const BEARISH_WORDS = [
  'fall', 'falls', 'fell', 'drop', 'drops', 'dropped', 'decline', 'declines', 'declined',
  'slip', 'slips', 'slipped', 'plunge', 'plunges', 'plunged', 'sink', 'sinks', 'sank',
  'low', 'weak', 'weakness', 'selling', 'bear', 'bearish', 'downside', 'negative',
  'pressure', 'resistance', 'outflow', 'rate hike', 'hawkish', 'tighten', 'strong dollar',
];

function scoreText(text: string): { bullish: number; bearish: number; label: 'bullish' | 'bearish' | 'neutral'; score: number } {
  const lower = text.toLowerCase();
  const bull = BULLISH_WORDS.filter(w => lower.includes(w)).length;
  const bear = BEARISH_WORDS.filter(w => lower.includes(w)).length;
  const total = bull + bear;
  const score = total === 0 ? 0 : Math.round(((bull - bear) / total) * 100);
  const label = score > 15 ? 'bullish' : score < -15 ? 'bearish' : 'neutral';
  return { bullish: bull, bearish: bear, label, score };
}

/* ── Types ─────────────────────────────────────────────────────────────── */
interface NewsItem {
  id: string;
  url: string;
  source: string;
  sentiment?: string;
  title: string;
  publishedAt: string;
}

interface ScoredItem extends NewsItem {
  computed: ReturnType<typeof scoreText>;
}

/* ── Sentiment Badge ────────────────────────────────────────────────────── */
function SentimentBadge({ label, score }: { label: string; score: number }) {
  if (label === 'bullish') {
    return (
      <span className="flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded"
        style={{ background: 'rgba(38,166,154,0.18)', color: '#26a69a', border: '1px solid rgba(38,166,154,0.4)' }}>
        <TrendingUp className="w-2.5 h-2.5" />
        +{score}
      </span>
    );
  }
  if (label === 'bearish') {
    return (
      <span className="flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded"
        style={{ background: 'rgba(239,83,80,0.18)', color: '#ef5350', border: '1px solid rgba(239,83,80,0.4)' }}>
        <TrendingDown className="w-2.5 h-2.5" />
        {score}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded"
      style={{ background: 'rgba(120,120,140,0.15)', color: '#888', border: '1px solid rgba(120,120,140,0.25)' }}>
      <Minus className="w-2.5 h-2.5" />
      NEU
    </span>
  );
}

/* ── Sentiment Summary Bar ──────────────────────────────────────────────── */
function SentimentBar({ items }: { items: ScoredItem[] }) {
  const bullCount = items.filter(i => i.computed.label === 'bullish').length;
  const bearCount = items.filter(i => i.computed.label === 'bearish').length;
  const neuCount  = items.filter(i => i.computed.label === 'neutral').length;
  const total = items.length || 1;
  const bullPct = Math.round((bullCount / total) * 100);
  const bearPct = Math.round((bearCount / total) * 100);
  const neuPct  = 100 - bullPct - bearPct;

  const overallScore = items.reduce((acc, i) => acc + i.computed.score, 0);
  const avgScore = Math.round(overallScore / total);
  const overall = avgScore > 10 ? 'bullish' : avgScore < -10 ? 'bearish' : 'neutral';

  return (
    <div className="px-4 pt-3 pb-2 border-b border-border/50">
      {/* Overall label */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">Sentiment</span>
        <span className="text-[10px] font-bold font-mono"
          style={{ color: overall === 'bullish' ? '#26a69a' : overall === 'bearish' ? '#ef5350' : '#888' }}>
          {overall === 'bullish' ? '▲ BULLISH' : overall === 'bearish' ? '▼ BEARISH' : '— NEUTRAL'}
          <span className="ml-1 opacity-60">({avgScore > 0 ? '+' : ''}{avgScore})</span>
        </span>
      </div>

      {/* Stacked bar */}
      <div className="h-2 rounded-full overflow-hidden flex gap-px bg-muted/30">
        {bullPct > 0 && (
          <div style={{ width: `${bullPct}%`, background: '#26a69a' }} className="h-full rounded-l-full transition-all" />
        )}
        {neuPct > 0 && (
          <div style={{ width: `${neuPct}%`, background: '#444' }} className="h-full transition-all" />
        )}
        {bearPct > 0 && (
          <div style={{ width: `${bearPct}%`, background: '#ef5350' }} className="h-full rounded-r-full transition-all" />
        )}
      </div>

      {/* Counts */}
      <div className="flex items-center gap-3 mt-1.5">
        <span className="text-[10px] font-mono" style={{ color: '#26a69a' }}>
          ▲ {bullCount} ({bullPct}%)
        </span>
        <span className="text-[10px] font-mono text-muted-foreground">
          — {neuCount} ({neuPct}%)
        </span>
        <span className="text-[10px] font-mono" style={{ color: '#ef5350' }}>
          ▼ {bearCount} ({bearPct}%)
        </span>
      </div>
    </div>
  );
}

/* ── Filter tabs ────────────────────────────────────────────────────────── */
type Filter = 'all' | 'bullish' | 'bearish';

/* ── Main Component ─────────────────────────────────────────────────────── */
export function NewsPanel() {
  const [filter, setFilter] = useState<Filter>('all');

  const { data, isLoading } = useQuery<NewsItem[]>({
    queryKey: ['/api/xauusd/news'],
    queryFn: () => fetch(`${API_BASE}/api/xauusd/news`, { credentials: 'include' }).then(r => r.json()),
    refetchInterval: 5 * 60 * 1000,
  });

  const scored: ScoredItem[] = useMemo(() => {
    if (!data) return [];
    return data.map(item => {
      // Use API sentiment if available, otherwise compute from title
      let computed = scoreText(item.title);
      if (item.sentiment === 'bullish') computed = { ...computed, label: 'bullish', score: Math.max(computed.score, 20) };
      if (item.sentiment === 'bearish') computed = { ...computed, label: 'bearish', score: Math.min(computed.score, -20) };
      return { ...item, computed };
    });
  }, [data]);

  const filtered = filter === 'all' ? scored : scored.filter(i => i.computed.label === filter);

  const tabs: { key: Filter; label: string }[] = [
    { key: 'all',     label: 'All' },
    { key: 'bullish', label: '▲ Bull' },
    { key: 'bearish', label: '▼ Bear' },
  ];

  return (
    <Card className="flex flex-col h-full">
      <CardHeader className="pb-0">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">News Sentiment</CardTitle>
          <div className="flex items-center gap-1">
            {tabs.map(t => (
              <button
                key={t.key}
                onClick={() => setFilter(t.key)}
                className="text-[10px] font-mono px-2 py-0.5 rounded transition-all"
                style={{
                  background: filter === t.key ? (t.key === 'bullish' ? 'rgba(38,166,154,0.25)' : t.key === 'bearish' ? 'rgba(239,83,80,0.25)' : 'rgba(255,255,255,0.1)') : 'transparent',
                  color: filter === t.key ? (t.key === 'bullish' ? '#26a69a' : t.key === 'bearish' ? '#ef5350' : '#ccc') : '#666',
                  border: `1px solid ${filter === t.key ? (t.key === 'bullish' ? 'rgba(38,166,154,0.5)' : t.key === 'bearish' ? 'rgba(239,83,80,0.5)' : 'rgba(255,255,255,0.2)') : 'transparent'}`,
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>

      {/* Sentiment summary bar */}
      {!isLoading && scored.length > 0 && <SentimentBar items={scored} />}

      <CardContent className="p-0 overflow-y-auto flex-1">
        {isLoading || !data ? (
          <div className="p-4 space-y-4">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="space-y-2 border-b border-border/50 pb-4 last:border-0">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/4" />
              </div>
            ))}
          </div>
        ) : (
          <div className="divide-y divide-border/50">
            {filtered.map(item => (
              <a
                key={item.id}
                href={item.url}
                target="_blank"
                rel="noreferrer"
                className="block p-3.5 hover:bg-muted/20 transition-colors group"
              >
                <div className="flex gap-2 items-center mb-1.5">
                  <span className="text-[10px] font-mono px-1.5 py-0.5 bg-muted/50 rounded text-muted-foreground shrink-0">
                    {item.source}
                  </span>
                  <SentimentBadge label={item.computed.label} score={item.computed.score} />
                </div>
                <h4 className="text-sm font-medium leading-snug mb-1 group-hover:text-primary transition-colors pr-5 relative">
                  {item.title}
                  <ExternalLink className="w-3 h-3 absolute right-0 top-0.5 opacity-0 group-hover:opacity-70 transition-opacity text-primary" />
                </h4>
                <div className="text-[11px] text-muted-foreground">
                  {formatDistanceToNow(new Date(item.publishedAt), { addSuffix: true })}
                </div>
              </a>
            ))}
            {filtered.length === 0 && (
              <div className="p-8 text-center text-xs text-muted-foreground">
                {scored.length === 0 ? "No news available right now" : `No ${filter} news found`}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
