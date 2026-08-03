import { useState } from "react";
import { createPortal } from "react-dom";
import { Phone, Send, Loader2, CheckCircle2, X } from "lucide-react";
import { useAuth } from "@clerk/react";
import { API_BASE } from "@/lib/api";

const MAX_ATTEMPTS = 3;
const ATTEMPTS_KEY = "license_request_attempts";

function getStoredAttempts(): number {
  return parseInt(localStorage.getItem(ATTEMPTS_KEY) ?? "0", 10);
}

interface Props {
  email?: string;
  onClose: () => void;
}

export function RequestLicenseModal({ email, onClose }: Props) {
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [attempts, setAttempts] = useState(getStoredAttempts);
  const [error, setError] = useState<string | null>(null);
  const { getToken } = useAuth();

  const limitReached = attempts >= MAX_ATTEMPTS;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone.trim() || loading || limitReached || sent) return;

    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/api/contact`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ phone: phone.trim(), email }),
      });

      const data = await res.json() as { success?: boolean; limitReached?: boolean; error?: string };

      if (data.limitReached || res.status === 429) {
        const next = MAX_ATTEMPTS;
        localStorage.setItem(ATTEMPTS_KEY, String(next));
        setAttempts(next);
        setError("Maximum requests reached. Please wait for us to contact you.");
        return;
      }
      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
        return;
      }

      // Increment persistent attempt counter
      const next = attempts + 1;
      localStorage.setItem(ATTEMPTS_KEY, String(next));
      setAttempts(next);
      setSent(true);
    } catch {
      setError("Could not send request. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return createPortal(
    <div
      style={{ position: "fixed", inset: 0, zIndex: 99999, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

      <div
        className="relative w-full max-w-sm bg-card border border-border rounded-2xl shadow-2xl p-6 flex flex-col animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-muted-foreground hover:text-white transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        {sent ? (
          /* ── Success state ── */
          <div className="flex flex-col items-center text-center">
            <div className="w-16 h-16 rounded-full bg-green-500/10 border border-green-500/30 flex items-center justify-center mb-4">
              <CheckCircle2 className="w-8 h-8 text-green-400" />
            </div>
            <h2 className="text-lg font-bold text-white mb-2">Request Sent!</h2>
            <p className="text-sm text-muted-foreground leading-relaxed mb-5">
              Your phone number has been received.<br />
              We'll reach out to you on{" "}
              <span className="text-primary font-semibold">Telegram</span> shortly.
            </p>
            {/* Telegram badge */}
            <div className="flex items-center gap-2 bg-primary/10 border border-primary/20 rounded-lg px-4 py-2.5 mb-5">
              <svg className="w-5 h-5 text-primary shrink-0" viewBox="0 0 24 24" fill="currentColor">
                <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
              </svg>
              <span className="text-sm text-primary font-mono font-semibold">Reply via Telegram</span>
            </div>
            <button
              onClick={onClose}
              className="w-full bg-primary text-black font-semibold rounded-lg py-2.5 hover:bg-amber-400 transition-colors text-sm"
            >
              Got it
            </button>
          </div>
        ) : (
          /* ── Form state ── */
          <>
            <div className="flex items-center gap-2 mb-1">
              <Phone className="w-4 h-4 text-primary shrink-0" />
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Request a License
              </p>
            </div>
            <p className="text-xs text-muted-foreground mb-4">
              Leave your phone number and we'll get back to you on Telegram.
            </p>

            {limitReached ? (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive text-center">
                You've reached the maximum of {MAX_ATTEMPTS} requests.<br />
                <span className="text-xs text-muted-foreground mt-1 block">We'll reach out to you on Telegram shortly.</span>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-3">
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input
                    type="tel"
                    inputMode="numeric"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
                    placeholder="Enter your phone number"
                    disabled={loading}
                    autoFocus
                    className="w-full pl-9 pr-4 py-2.5 bg-secondary/60 border border-border rounded-lg text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/60 transition-colors disabled:opacity-50"
                  />
                </div>

                {error && (
                  <p className="text-xs text-destructive">{error}</p>
                )}

                <button
                  type="submit"
                  disabled={!phone.trim() || loading}
                  className="w-full flex items-center justify-center gap-2 bg-secondary border border-border text-foreground font-medium rounded-lg py-2.5 hover:bg-secondary/80 transition-colors text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                  {loading ? "Sending..." : "Send Request"}
                </button>

                <p className="text-center text-xs text-muted-foreground">
                  {MAX_ATTEMPTS - attempts} request{MAX_ATTEMPTS - attempts !== 1 ? "s" : ""} remaining
                </p>
              </form>
            )}
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
