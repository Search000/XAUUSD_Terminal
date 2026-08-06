import { useState, useEffect } from "react";
import { useGetAccountSettings, getGetAccountSettingsQueryKey, useUpdateAccountSettings } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { UserCircle2, Sparkles, Loader2 } from "lucide-react";

interface NicknameModalProps {
  isSignedIn: boolean;
}

/**
 * Shown once after a user signs in if they haven't set a nickname yet.
 * They can also skip — it won't show again until they clear their settings.
 */
export function NicknameModal({ isSignedIn }: NicknameModalProps) {
  const [visible, setVisible] = useState(false);
  const [value, setValue] = useState("");
  const qc = useQueryClient();

  const { data: accountSettings, isSuccess } = useGetAccountSettings({
    query: {
      queryKey: getGetAccountSettingsQueryKey(),
      enabled: isSignedIn,
    },
  });

  const update = useUpdateAccountSettings();

  // Show modal as soon as settings load and nickname is not yet set — no delay, no skip
  useEffect(() => {
    if (isSuccess && accountSettings?.nickname == null) {
      setVisible(true);
    }
  }, [isSuccess, accountSettings?.nickname]);

  if (!visible) return null;

  async function handleSave() {
    const trimmed = value.trim();
    if (!trimmed) return;
    await update.mutateAsync({ data: { nickname: trimmed } });
    qc.invalidateQueries({ queryKey: getGetAccountSettingsQueryKey() });
    setVisible(false);
  }

  function handleKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") handleSave();
  }

  return (
    /* Backdrop */
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      {/* Card */}
      <div className="relative w-full max-w-sm mx-4 bg-card border border-border rounded-xl shadow-2xl shadow-black/60 overflow-hidden animate-in zoom-in-95 duration-200">
        {/* Amber gradient bar */}
        <div className="h-1 w-full bg-gradient-to-r from-primary/0 via-primary to-primary/0" />

        <div className="px-6 py-8 flex flex-col items-center gap-5 text-center">
          {/* Icon */}
          <div className="w-14 h-14 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center">
            <UserCircle2 className="w-7 h-7 text-primary" />
          </div>

          {/* Heading */}
          <div className="space-y-1">
            <h2 className="text-lg font-bold text-white font-mono tracking-tight flex items-center justify-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" />
              Choose Your Callsign
            </h2>
            <p className="text-xs font-mono text-muted-foreground leading-relaxed">
              Pick a nickname — it'll show in the terminal header next to your balance.
            </p>
          </div>

          {/* Input */}
          <div className="w-full space-y-2">
            <input
              autoFocus
              type="text"
              maxLength={30}
              placeholder="e.g. GoldHawk, TradeKing…"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={handleKey}
              className="w-full bg-secondary/50 border border-border rounded-md px-4 py-2.5 text-sm font-mono text-white placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/30 text-center tracking-widest"
            />
            <p className="text-[10px] font-mono text-muted-foreground/50">max 30 characters</p>
          </div>

          {/* Button */}
          <button
            type="button"
            onClick={handleSave}
            disabled={!value.trim() || update.isPending}
            className="w-full py-2.5 rounded-md text-xs font-mono font-semibold bg-primary text-black hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
          >
            {update.isPending ? (
              <><Loader2 className="w-3 h-3 animate-spin" /> Saving…</>
            ) : (
              "Confirm ✓"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
