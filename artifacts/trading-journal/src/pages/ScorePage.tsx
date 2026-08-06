import { AppLayout } from "@/components/AppLayout";
import {
  useGetWeeklyScore, getGetWeeklyScoreQueryKey,
  useGetMistakesMonthly, getGetMistakesMonthlyQueryKey,
  useGetAchievements, getGetAchievementsQueryKey,
} from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, Minus, Award, Target, Zap, BarChart2, Calendar } from "lucide-react";
import { useState } from "react";
import { useUser } from "@clerk/react";

// ─── Grade config ─────────────────────────────────────────────────────────────
const GRADE_CONFIG = {
  A: { color: "text-emerald-400", border: "border-emerald-500/40", bg: "bg-emerald-500/10", glow: "shadow-[0_0_32px_rgba(52,211,153,0.2)]", label: "Elite", desc: "Outstanding trading discipline & performance" },
  B: { color: "text-blue-400", border: "border-blue-500/40", bg: "bg-blue-500/10", glow: "shadow-[0_0_32px_rgba(96,165,250,0.15)]", label: "Proficient", desc: "Above average trading performance" },
  C: { color: "text-amber-400", border: "border-amber-500/40", bg: "bg-amber-500/10", glow: "shadow-[0_0_32px_rgba(245,158,11,0.15)]", label: "Developing", desc: "Room for improvement in key areas" },
  D: { color: "text-orange-400", border: "border-orange-500/40", bg: "bg-orange-500/10", glow: "shadow-[0_0_16px_rgba(251,146,60,0.1)]", label: "Struggling", desc: "Focus on consistency and risk control" },
  F: { color: "text-red-400", border: "border-red-500/40", bg: "bg-red-500/10", glow: "shadow-[0_0_16px_rgba(239,68,68,0.1)]", label: "Critical", desc: "Review fundamentals and trading plan" },
};

// ─── Score sub-components ─────────────────────────────────────────────────────
function ScoreRing({ score, grade }: { score: number; grade: keyof typeof GRADE_CONFIG }) {
  const cfg = GRADE_CONFIG[grade];
  const radius = 52;
  const circ = 2 * Math.PI * radius;
  const dashOffset = circ - (score / 100) * circ;

  return (
    <div className={cn("relative w-40 h-40 flex items-center justify-center rounded-full border-2", cfg.border, cfg.glow)}>
      <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 120 120">
        <circle cx="60" cy="60" r={radius} fill="none" stroke="currentColor" strokeWidth="6" className="text-secondary/40" />
        <circle
          cx="60" cy="60" r={radius} fill="none" strokeWidth="6"
          strokeDasharray={circ} strokeDashoffset={dashOffset}
          strokeLinecap="round"
          className={cn("transition-all duration-1000", cfg.color)}
          stroke="currentColor"
        />
      </svg>
      <div className="text-center z-10">
        <div className={cn("text-5xl font-black font-mono tracking-tight leading-none", cfg.color)}>{grade}</div>
        <div className="text-xs font-mono text-muted-foreground mt-1">{score}/100</div>
      </div>
    </div>
  );
}

function MetricCard({ label, value, icon: Icon, subtitle }: { label: string; value: string; icon: React.ElementType; subtitle?: string }) {
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">{label}</span>
        <Icon className="w-4 h-4 text-muted-foreground" />
      </div>
      <div className="text-2xl font-bold text-white font-mono">{value}</div>
      {subtitle && <div className="text-xs text-muted-foreground mt-1">{subtitle}</div>}
    </div>
  );
}

function MistakeChart({ reasons }: { reasons: { reason: string; count: number; percentage: number }[] }) {
  const maxCount = Math.max(...reasons.map((r) => r.count), 1);
  const REASON_COLORS: Record<string, string> = {
    "FOMO": "bg-orange-500",
    "Revenge Trade": "bg-red-500",
    "News": "bg-yellow-500",
    "Wrong SL Placement": "bg-purple-500",
    "Overtrading": "bg-blue-500",
    "No Trading Plan": "bg-pink-500",
    "Poor Entry Timing": "bg-teal-500",
    "Market Conditions": "bg-slate-400",
  };

  return (
    <div className="space-y-3">
      {reasons.map((r) => (
        <div key={r.reason}>
          <div className="flex justify-between text-xs font-mono mb-1.5">
            <span className="text-slate-300">{r.reason}</span>
            <span className="text-muted-foreground">{r.count}× — {r.percentage}%</span>
          </div>
          <div className="h-2 bg-secondary/60 rounded-full overflow-hidden">
            <div
              className={cn("h-full rounded-full transition-all duration-700", REASON_COLORS[r.reason] ?? "bg-primary")}
              style={{ width: `${(r.count / maxCount) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Badges sub-components ────────────────────────────────────────────────────
function ProgressBar({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cn("h-1.5 w-full rounded-full bg-secondary/60 overflow-hidden", className)}>
      <div
        className="h-full rounded-full bg-primary transition-all duration-700"
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}

// ─── Score Tab ────────────────────────────────────────────────────────────────
function ScoreTab() {
  const { isLoaded, isSignedIn } = useUser();
  const { data: score, isLoading: scoreLoading } = useGetWeeklyScore({
    query: { queryKey: getGetWeeklyScoreQueryKey(), enabled: isLoaded && !!isSignedIn },
  });

  const now = new Date();
  const { data: mistakes, isLoading: mistakesLoading } = useGetMistakesMonthly(
    { month: now.getMonth() + 1, year: now.getFullYear() },
    { query: { queryKey: getGetMistakesMonthlyQueryKey({ month: now.getMonth() + 1, year: now.getFullYear() }), enabled: isLoaded && !!isSignedIn } },
  );

  if (scoreLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="text-xs font-mono text-muted-foreground uppercase tracking-widest animate-pulse">Loading score…</div>
      </div>
    );
  }

  const grade = (score?.grade ?? "F") as keyof typeof GRADE_CONFIG;
  const cfg = GRADE_CONFIG[grade];

  const gradeChangeIcon = score?.gradeChange === "up" ? <TrendingUp className="w-4 h-4 text-green-500" /> :
    score?.gradeChange === "down" ? <TrendingDown className="w-4 h-4 text-red-500" /> :
    score?.gradeChange === "same" ? <Minus className="w-4 h-4 text-muted-foreground" /> : null;

  const winPct = score ? Math.round(score.winRate * 100) : 0;
  const rrStr = score ? score.avgRR.toFixed(2) : "0.00";
  const consPct = score ? Math.round(score.consistencyPct * 100) : 0;

  return (
    <div className="flex flex-col gap-6">
      {/* Main score card */}
      <div className={cn("bg-card border rounded-2xl p-6", cfg.border, cfg.bg, cfg.glow)}>
        <div className="flex flex-col md:flex-row items-center md:items-start gap-8">
          <ScoreRing score={score?.score ?? 0} grade={grade} />
          <div className="flex-1 text-center md:text-left">
            <div className={cn("text-xl font-bold mb-1", cfg.color)}>{cfg.label} Trader</div>
            <p className="text-sm text-muted-foreground mb-4">{cfg.desc}</p>
            {score?.previousGrade && (
              <div className="flex items-center gap-2 justify-center md:justify-start mb-4">
                <span className="text-xs font-mono text-muted-foreground">vs last week:</span>
                <span className="text-xs font-mono text-slate-300">{score.previousGrade}</span>
                {gradeChangeIcon}
              </div>
            )}
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-1">Win Rate</div>
                <div className="text-lg font-bold text-white font-mono">{winPct}%</div>
                <div className="text-[10px] text-muted-foreground">40% of score</div>
              </div>
              <div>
                <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-1">Avg R:R</div>
                <div className="text-lg font-bold text-white font-mono">{rrStr}:1</div>
                <div className="text-[10px] text-muted-foreground">30% of score</div>
              </div>
              <div>
                <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-1">Consistency</div>
                <div className="text-lg font-bold text-white font-mono">{consPct}%</div>
                <div className="text-[10px] text-muted-foreground">30% of score</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricCard label="Trades This Week" value={String(score?.totalTrades ?? 0)} icon={BarChart2} subtitle="closed trades" />
        <MetricCard label="Win Rate" value={`${winPct}%`} icon={Target} subtitle="Target: 60%+" />
        <MetricCard label="Avg Risk:Reward" value={`${rrStr}:1`} icon={Zap} subtitle="Target: 2:1+" />
        <MetricCard label="Consistency" value={`${consPct}%`} icon={Calendar} subtitle="trading days used" />
      </div>

      {/* Grade scale */}
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-3">Grade Scale</div>
        <div className="flex gap-2 flex-wrap">
          {(["A", "B", "C", "D", "F"] as const).map((g) => {
            const c = GRADE_CONFIG[g];
            const isActive = g === grade;
            return (
              <div key={g} className={cn(
                "flex-1 min-w-[60px] rounded-lg px-3 py-2 text-center border",
                isActive ? cn(c.bg, c.border) : "border-border/50 bg-secondary/20",
              )}>
                <div className={cn("text-lg font-bold font-mono", isActive ? c.color : "text-muted-foreground")}>{g}</div>
                <div className="text-[9px] font-mono text-muted-foreground">
                  {g === "A" ? "90+" : g === "B" ? "75+" : g === "C" ? "60+" : g === "D" ? "45+" : "<45"}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Mistake Journal */}
      <div className="bg-card border border-border rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <Award className="w-4 h-4 text-primary" />
          <h2 className="font-semibold text-white">Mistake Journal — This Month</h2>
        </div>
        {mistakesLoading ? (
          <div className="text-xs font-mono text-muted-foreground animate-pulse">Loading…</div>
        ) : mistakes && mistakes.reasons.length > 0 ? (
          <>
            <div className="flex gap-4 mb-4 text-xs font-mono">
              <span className="text-muted-foreground">Total losses: <span className="text-white">{mistakes.totalLosses}</span></span>
              <span className="text-muted-foreground">Tagged: <span className="text-primary">{mistakes.taggedLosses}</span></span>
            </div>
            <MistakeChart reasons={mistakes.reasons} />
          </>
        ) : (
          <div className="text-sm text-muted-foreground font-mono">
            No tagged losses this month.
            {mistakes && mistakes.totalLosses > 0 && (
              <span className="block mt-1 text-xs text-amber-500/70">
                You have {mistakes.totalLosses} SL Hit trade{mistakes.totalLosses !== 1 ? "s" : ""} — add a loss reason when editing them.
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Badges Tab ───────────────────────────────────────────────────────────────
function BadgesTab() {
  const { isLoaded, isSignedIn } = useUser();
  const { data, isLoading } = useGetAchievements({
    query: { queryKey: getGetAchievementsQueryKey(), enabled: isLoaded && !!isSignedIn },
  });

  const earned = data?.badges.filter((b) => b.earned) ?? [];
  const locked = data?.badges.filter((b) => !b.earned) ?? [];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="text-xs font-mono text-muted-foreground uppercase tracking-widest animate-pulse">Loading badges…</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Progress overview */}
      {data && (
        <div className="bg-card border border-border rounded-xl p-4 flex items-center gap-4">
          <div className="flex-1">
            <div className="flex justify-between text-xs font-mono text-muted-foreground mb-2">
              <span>OVERALL PROGRESS</span>
              <span className="text-primary">{data.totalEarned}/{data.badges.length}</span>
            </div>
            <ProgressBar value={(data.totalEarned / data.badges.length) * 100} />
          </div>
          <div className="shrink-0 text-center">
            <div className="text-3xl font-bold text-primary font-mono">
              {Math.round((data.totalEarned / data.badges.length) * 100)}%
            </div>
            <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">Complete</div>
          </div>
        </div>
      )}

      {/* Earned badges */}
      {earned.length > 0 && (
        <section>
          <h2 className="text-xs font-mono uppercase tracking-widest text-primary mb-3 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-primary inline-block" />
            Earned — {earned.length}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {earned.map((badge) => (
              <div
                key={badge.id}
                className="bg-card border border-primary/30 rounded-xl p-4 flex items-start gap-3 hover:border-primary/60 transition-colors relative overflow-hidden"
              >
                <div className="absolute inset-0 bg-primary/5 pointer-events-none" />
                <div className="text-3xl shrink-0">{badge.icon}</div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm text-white leading-snug">{badge.title}</div>
                  <div className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{badge.description}</div>
                  {badge.earnedAt && (
                    <div className="text-[10px] font-mono text-primary/70 mt-1.5">
                      ✓ {new Date(badge.earnedAt).toLocaleDateString()}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Locked badges */}
      {locked.length > 0 && (
        <section>
          <h2 className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-muted-foreground inline-block" />
            Locked — {locked.length}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {locked.map((badge) => (
              <div
                key={badge.id}
                className="bg-card border border-border rounded-xl p-4 flex items-start gap-3 opacity-60"
              >
                <div className="text-3xl shrink-0 grayscale">{badge.icon}</div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm text-slate-400 leading-snug">{badge.title}</div>
                  <div className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{badge.description}</div>
                  {badge.progress != null && (
                    <div className="mt-2">
                      <div className="flex justify-between text-[10px] font-mono text-muted-foreground mb-1">
                        <span>Progress</span>
                        <span>{Math.round(badge.progress)}%{badge.target ? ` (of ${badge.target})` : ""}</span>
                      </div>
                      <ProgressBar value={badge.progress} />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {!earned.length && !locked.length && (
        <div className="text-center text-muted-foreground py-16 font-mono text-sm">
          No badges found. Start logging trades to earn achievements!
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function ScorePage() {
  const [activeTab, setActiveTab] = useState<"score" | "badges">("score");

  return (
    <AppLayout>
      <div className="container mx-auto p-4 lg:p-8 flex-1 flex flex-col gap-6">

        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tight mb-1">
              {activeTab === "score" ? "Trading Score" : "Achievement Badges"}
            </h1>
            <p className="text-sm text-muted-foreground font-mono">
              {activeTab === "score" ? "Weekly performance rating" : "Track your trading milestones"}
            </p>
          </div>

          {/* Tab buttons */}
          <div className="flex items-center bg-secondary/40 rounded-lg p-1 border border-border">
            <button
              onClick={() => setActiveTab("score")}
              className={cn(
                "px-4 py-1.5 rounded-md text-sm font-mono font-medium transition-all",
                activeTab === "score"
                  ? "bg-primary text-black shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Score
            </button>
            <button
              onClick={() => setActiveTab("badges")}
              className={cn(
                "px-4 py-1.5 rounded-md text-sm font-mono font-medium transition-all",
                activeTab === "badges"
                  ? "bg-primary text-black shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Badges
            </button>
          </div>
        </div>

        {/* Tab content */}
        {activeTab === "score" ? <ScoreTab /> : <BadgesTab />}

      </div>
    </AppLayout>
  );
}
