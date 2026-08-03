import { useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import {
  useActivateLicense,
  useActivateTrial,
  useGetLicenseStatus,
  getGetLicenseStatusQueryKey,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { useUser, useAuth } from "@clerk/react";
import { API_BASE } from "@/lib/api";
import { useQueryClient } from "@tanstack/react-query";
import { KeyRound, Shield, Activity, Loader2, Phone, Send, CheckCircle2, X, Zap } from "lucide-react";

export default function ActivatePage() {
  const [code, setCode] = useState("");
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const { user } = useUser();
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const email = user?.primaryEmailAddress?.emailAddress ?? "";

  // Contact form state
  const [phone, setPhone] = useState("");
  const [contactLoading, setContactLoading] = useState(false);
  const [contactSent, setContactSent] = useState(false);
  const [limitReached, setLimitReached] = useState(false);
  const [showPopup, setShowPopup] = useState(false);

  // Get license status to check if trial is available
  const { data: licenseStatus } = useGetLicenseStatus({
    query: { queryKey: getGetLicenseStatusQueryKey(), staleTime: 30_000 },
  });

  const trialModeEnabled = licenseStatus?.trialModeEnabled ?? false;
  const hasExistingLicense = licenseStatus?.hasLicense ?? false;
  const trialDurationDays = licenseStatus?.trialDurationDays ?? 7;

  const activate = useActivateLicense({
    mutation: {
      onSuccess: async () => {
        toast({
          title: "Access Granted",
          description: "Terminal unlocked successfully.",
          className: "bg-green-500/10 text-green-500 border-green-500/20",
        });
        await queryClient.invalidateQueries({ queryKey: getGetLicenseStatusQueryKey() });
        setLocation("/dashboard");
      },
      onError: (err) => {
        toast({
          title: "Access Denied",
          description: err.message || "Invalid or expired license code.",
          variant: "destructive",
        });
      }
    }
  });

  const activateTrial = useActivateTrial({
    mutation: {
      onSuccess: async () => {
        toast({
          title: "Free Trial Activated!",
          description: "Your 7-day free trial has started. Welcome!",
          className: "bg-green-500/10 text-green-500 border-green-500/20",
        });
        await queryClient.invalidateQueries({ queryKey: getGetLicenseStatusQueryKey() });
        setLocation("/dashboard");
      },
      onError: (err) => {
        toast({
          title: "Trial Failed",
          description: err.message || "Could not activate trial. You may have already used it.",
          variant: "destructive",
        });
      }
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    activate.mutate({ data: { licenseCode: code.trim() } });
  };

  const handleTrialActivate = () => {
    activateTrial.mutate();
  };

  const handleContact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone.trim() || limitReached || contactLoading) return;

    setContactLoading(true);
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

      if (res.status === 429) {
        setLimitReached(true);
        toast({ title: "Blocked", description: "Too many attempts from your IP. Please try later.", variant: "destructive" });
        return;
      }

      if (!res.ok) {
        const data = await res.json() as { error?: string };
        toast({ title: "Error", description: data.error ?? "Something went wrong.", variant: "destructive" });
        return;
      }

      const data = await res.json() as { success: boolean; limitReached?: boolean; attemptsLeft?: number };

      if (data.limitReached) {
        setLimitReached(true);
        toast({ title: "Limit Reached", description: "You've already sent the maximum number of requests.", variant: "destructive" });
        return;
      }

      setContactSent(true);
      setPhone("");
      setShowPopup(true);
    } catch {
      toast({ title: "Error", description: "Could not send request. Try again.", variant: "destructive" });
    } finally {
      setContactLoading(false);
    }
  };

  const blocked = limitReached;

  return (
    <AppLayout hideNav>
      <div className="flex-1 flex items-center justify-center p-4 relative overflow-hidden">
        {/* Decorative background grid */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px] pointer-events-none" />

        <div className="w-full max-w-md relative z-10 space-y-4">
          {/* User email pill */}
          {email && (
            <div className="text-center">
              <span className="inline-block bg-secondary/60 border border-border rounded-full px-4 py-1.5 text-xs font-mono text-slate-300 tracking-wide">
                {email}
              </span>
            </div>
          )}

          {/* ── Free Trial Banner (only when trial is available and no existing license) ── */}
          {trialModeEnabled && !hasExistingLicense && (
            <div className="p-5 bg-primary/5 border border-primary/30 rounded-lg shadow-lg">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-9 h-9 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
                  <Zap className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white">{trialDurationDays}-Day Free Trial Available</h3>
                  <p className="text-xs text-muted-foreground">No code required — start instantly</p>
                </div>
              </div>
              <button
                onClick={handleTrialActivate}
                disabled={activateTrial.isPending}
                className="w-full flex items-center justify-center gap-2 bg-primary text-black font-semibold rounded-lg py-2.5 hover:bg-amber-400 transition-colors text-sm disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {activateTrial.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Zap className="w-4 h-4" />
                )}
                {activateTrial.isPending ? "Activating..." : "Start Free Trial"}
              </button>
              <p className="text-center text-xs text-muted-foreground mt-2">
                Each account can only activate one free trial.
              </p>
            </div>
          )}

          {/* ── License Card ── */}
          <div className="p-6 bg-card border border-border rounded-lg shadow-2xl">
            <div className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center mx-auto mb-6">
              <Shield className="w-6 h-6" />
            </div>

            <h1 className="text-xl font-bold text-center tracking-tight mb-1">
              Initialize Terminal
            </h1>
            <p className="text-center text-sm text-muted-foreground mb-6">
              Enter your provisioning code to grant access.
            </p>

            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="relative">
                <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="XXXX-XXXX-XXXX"
                  className="w-full pl-9 pr-4 py-2.5 bg-secondary/60 border border-border rounded-lg text-sm font-mono tracking-widest placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/60 transition-colors"
                />
              </div>

              <button
                type="submit"
                disabled={activate.isPending || !code.trim()}
                className="w-full flex items-center justify-center gap-2 bg-primary text-black font-semibold rounded-lg py-2.5 hover:bg-amber-400 transition-colors text-sm disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {activate.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Activity className="w-4 h-4" />
                )}
                {activate.isPending ? "Authenticating..." : "Authenticate"}
              </button>
            </form>

            <p className="text-center text-xs text-muted-foreground mt-4">
              Don't have a code? Contact your administrator or purchase a license to continue.
            </p>
          </div>

          {/* ── Contact Card ── */}
          <div className="p-5 bg-card border border-border rounded-lg shadow-lg">
            <div className="flex items-center gap-2 mb-1">
              <Phone className="w-4 h-4 text-primary shrink-0" />
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Request a License
              </p>
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              Leave your phone number and we'll get back to you on Telegram.
            </p>

            <form onSubmit={handleContact} className="space-y-2">
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type="tel"
                  inputMode="numeric"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
                  placeholder="Enter your phone number"
                  disabled={contactSent || blocked}
                  className="w-full pl-9 pr-4 py-2.5 bg-secondary/60 border border-border rounded-lg text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/60 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                />
              </div>

              <button
                type="submit"
                disabled={contactSent || blocked || contactLoading || !phone.trim()}
                className="w-full flex items-center justify-center gap-2 bg-secondary border border-border text-foreground font-medium rounded-lg py-2.5 hover:bg-secondary/80 transition-colors text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {contactLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : contactSent ? (
                  <CheckCircle2 className="w-4 h-4 text-green-500" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
                {contactSent ? "Request Sent" : contactLoading ? "Sending..." : "Send Request"}
              </button>
            </form>
          </div>
        </div>
      </div>

      {/* ── Success popup ── */}
      {showPopup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setShowPopup(false)}
          />

          {/* Modal */}
          <div className="relative w-full max-w-sm bg-card border border-border rounded-2xl shadow-2xl p-6 flex flex-col items-center text-center animate-in fade-in zoom-in-95 duration-200">
            {/* Close */}
            <button
              onClick={() => setShowPopup(false)}
              className="absolute top-4 right-4 text-muted-foreground hover:text-white transition-colors"
            >
              <X className="w-4 h-4" />
            </button>

            {/* Icon */}
            <div className="w-16 h-16 rounded-full bg-green-500/10 border border-green-500/30 flex items-center justify-center mb-5">
              <CheckCircle2 className="w-8 h-8 text-green-400" />
            </div>

            {/* Title */}
            <h2 className="text-xl font-bold text-white mb-2">Request Sent!</h2>

            {/* Body */}
            <p className="text-sm text-muted-foreground leading-relaxed mb-6">
              Your phone number has been received.<br />
              We'll reach out to you on <span className="text-primary font-semibold">Telegram</span> shortly.
            </p>

            {/* Telegram badge */}
            <div className="flex items-center gap-2 bg-primary/10 border border-primary/20 rounded-lg px-4 py-2.5 mb-6">
              <svg className="w-5 h-5 text-primary shrink-0" viewBox="0 0 24 24" fill="currentColor">
                <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
              </svg>
              <span className="text-sm text-primary font-mono font-semibold">Reply via Telegram</span>
            </div>

            <button
              onClick={() => setShowPopup(false)}
              className="w-full bg-primary text-black font-semibold rounded-lg py-2.5 hover:bg-amber-400 transition-colors text-sm"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
