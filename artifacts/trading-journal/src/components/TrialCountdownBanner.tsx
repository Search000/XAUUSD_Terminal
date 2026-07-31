import { useEffect, useState } from "react";
import { Clock, Zap } from "lucide-react";
import { useLocation } from "wouter";

interface Props {
  expiresAt: string;
  onGetLicense: () => void;
}

function getTimeLeft(expiresAt: string) {
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return null;
  const totalHours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((diff % (1000 * 60)) / 1000);
  return { days, hours, minutes, seconds, diff };
}

function Seg({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-col items-center">
      <span className="font-mono text-sm font-bold text-primary leading-none">
        {String(value).padStart(2, "0")}
      </span>
      <span className="text-[9px] uppercase tracking-wider text-muted-foreground font-mono mt-0.5">{label}</span>
    </div>
  );
}

export function TrialCountdownBanner({ expiresAt, onGetLicense }: Props) {
  const [timeLeft, setTimeLeft] = useState(() => getTimeLeft(expiresAt));

  useEffect(() => {
    const id = setInterval(() => setTimeLeft(getTimeLeft(expiresAt)), 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  if (!timeLeft) return null;

  const isUrgent = timeLeft.diff < 24 * 60 * 60 * 1000;

  return (
    <div className={`flex items-center gap-3 px-4 py-2 border-b text-xs transition-colors ${
      isUrgent
        ? "bg-red-500/8 border-red-500/20"
        : "bg-primary/5 border-primary/15"
    }`}>
      <div className={`flex items-center gap-1.5 shrink-0 ${isUrgent ? "text-red-400" : "text-primary"}`}>
        <Clock className="w-3.5 h-3.5" />
        <span className="font-mono font-semibold uppercase tracking-wider text-[10px]">
          Trial {isUrgent ? "ending soon!" : "active"}
        </span>
      </div>

      {/* Countdown */}
      <div className="flex items-center gap-2 shrink-0">
        {timeLeft.days > 0 && <Seg value={timeLeft.days} label="d" />}
        <Seg value={timeLeft.hours} label="h" />
        <span className={`font-mono text-xs font-bold leading-none mb-1 ${isUrgent ? "text-red-400" : "text-primary"}`}>:</span>
        <Seg value={timeLeft.minutes} label="m" />
        <span className={`font-mono text-xs font-bold leading-none mb-1 ${isUrgent ? "text-red-400" : "text-primary"}`}>:</span>
        <Seg value={timeLeft.seconds} label="s" />
        <span className="text-muted-foreground font-mono ml-1">remaining</span>
      </div>

      <div className="flex-1" />

      <button
        onClick={onGetLicense}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[10px] font-semibold uppercase tracking-wider transition-colors shrink-0 ${
          isUrgent
            ? "bg-red-500/15 text-red-400 border border-red-500/30 hover:bg-red-500/25"
            : "bg-primary/10 text-primary border border-primary/25 hover:bg-primary/20"
        }`}
      >
        <Zap className="w-3 h-3" />
        Get License
      </button>
    </div>
  );
}
