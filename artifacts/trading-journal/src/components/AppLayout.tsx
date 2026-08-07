import {
  useGetLicenseStatus,
  getGetLicenseStatusQueryKey,
  useGetInvestorShares,
  getGetInvestorSharesQueryKey,
  useGetAccountSettings,
  getGetAccountSettingsQueryKey,
} from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { useEffect, useState, useCallback } from "react";
import { useUser, useClerk } from "@clerk/react";
import {
  Activity,
  LayoutDashboard,
  FileText,
  BarChart2,
  Users,
  Settings,
  LogOut,
  Eye,
  EyeOff,
  Star,
  Wallet,
  Zap,
  TrendingUp,
  MessageCircle,
} from "lucide-react";
import { Link } from "wouter";
import { NotificationPanel } from "./NotificationPanel";
import { NicknameModal } from "./NicknameModal";
import { TrialCountdownBanner } from "./TrialCountdownBanner";
import { FeedbackModal } from "./FeedbackModal";
import { RequestLicenseModal } from "./RequestLicenseModal";

const FEEDBACK_KEY = "trial_feedback_shown";

function shouldShowFeedback(activatedAt: string | null | undefined, durationDays: number | null | undefined): boolean {
  if (!activatedAt || !durationDays) return false;
  const activated = new Date(activatedAt).getTime();
  const midpointMs = activated + (durationDays * 24 * 60 * 60 * 1000) / 2;
  return Date.now() >= midpointMs;
}

export function AppLayout({
  children,
  hideNav = false,
}: {
  children: React.ReactNode;
  hideNav?: boolean;
}) {
  const [location, setLocation] = useLocation();
  const { user, isLoaded, isSignedIn } = useUser();
  const { signOut } = useClerk();
  const [isBalanceVisible, setIsBalanceVisible] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [showRequestLicense, setShowRequestLicense] = useState(false);

  const handleGetLicense = useCallback(() => {
    setShowRequestLicense(true);
  }, []);

  const {
    data: license,
    isLoading: isLicenseLoading,
    isError: isLicenseError,
  } = useGetLicenseStatus({
    query: {
      queryKey: getGetLicenseStatusQueryKey(),
      enabled: isLoaded && !!isSignedIn,
      retry: 3,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
      staleTime: 30_000,
    },
  });

  const { data: shares } = useGetInvestorShares({
    query: {
      queryKey: getGetInvestorSharesQueryKey(),
      enabled: isLoaded && !!isSignedIn,
    },
  });

  const { data: accountSettings, isSuccess: isSettingsLoaded } = useGetAccountSettings({
    query: {
      queryKey: getGetAccountSettingsQueryKey(),
      enabled: isLoaded && !!isSignedIn,
    },
  });

  const liveBalance = shares?.currentBalance ?? 0;

  const nickname = accountSettings?.nickname?.trim() || null;
  const fallbackName =
    user?.fullName?.trim() ||
    [user?.firstName, user?.lastName].filter(Boolean).join(" ") ||
    user?.username ||
    user?.primaryEmailAddress?.emailAddress?.split("@")[0] ||
    "Trader";
  const displayName = nickname ?? fallbackName;

  useEffect(() => {
    if (
      isLoaded &&
      !isSignedIn &&
      location !== "/" &&
      location !== "/sign-in" &&
      location !== "/sign-up"
    ) {
      setLocation("/");
    }
  }, [isLoaded, isSignedIn, location, setLocation]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || isLicenseLoading || isLicenseError) return;
    if (!isSettingsLoaded || accountSettings?.nickname == null) return;

    if (
      license?.licenseEnforcementEnabled === false &&
      location === "/activate"
    ) {
      setLocation("/dashboard");
    } else if (
      license?.licenseEnforcementEnabled !== false &&
      license !== undefined &&
      !license?.isActive &&
      location !== "/activate"
    ) {
      setLocation("/activate");
    }
  }, [license, isLicenseLoading, isLicenseError, location, setLocation, isLoaded, isSignedIn, isSettingsLoaded, accountSettings?.nickname]);

  useEffect(() => {
    if (!license?.isTrial || !license?.isActive) return;
    if (localStorage.getItem(FEEDBACK_KEY) === "1") return;
    if (shouldShowFeedback(license.activatedAt, license.durationDays)) {
      localStorage.setItem(FEEDBACK_KEY, "1");
      setShowFeedback(true);
    }
  }, [license]);

  if (!isLoaded || (!!isSignedIn && isLicenseLoading && !isLicenseError)) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center">
        <Activity className="w-8 h-8 text-primary animate-pulse mb-4" />
        <p className="text-sm font-mono text-muted-foreground uppercase tracking-widest">
          Connecting to Terminal...
        </p>
      </div>
    );
  }

  const navLinks = [
    { href: "/execution", label: "Execution", icon: Zap, mobileOnly: true },
    { href: "/xauusd", label: "XAUUSD Monitor", icon: TrendingUp, mobileOnly: false },
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, mobileOnly: false },
    { href: "/trades", label: "Trade Log", icon: FileText, mobileOnly: false },
    { href: "/reports", label: "Reports", icon: BarChart2, mobileOnly: false },
    { href: "/investors", label: "Investors", icon: Users, mobileOnly: false },
    { href: "/score", label: "Score", icon: Star, mobileOnly: false },
    { href: "/settings", label: "Settings", icon: Settings, mobileOnly: false },
  ];

  if (hideNav) {
    return (
      <div className="min-h-screen bg-background text-foreground font-sans">
        {isSignedIn && <NicknameModal isSignedIn={!!isSignedIn} />}
        {isSignedIn && (
          <div className="absolute top-4 right-4 z-50">
            <button
              onClick={() => signOut()}
              className="text-xs font-mono uppercase tracking-wider text-red-400 border border-red-500/40 bg-red-500/10 hover:bg-red-500/20 hover:text-red-300 transition-colors px-3 py-2 rounded-md flex items-center gap-2"
            >
              <LogOut className="w-4 h-4" />
              <span>Sign out</span>
            </button>
          </div>
        )}
        <main className="flex-1">{children}</main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground font-sans flex">
      {/* Modals */}
      {isSignedIn && <NicknameModal isSignedIn={!!isSignedIn} />}
      {showFeedback && (
        <FeedbackModal
          onClose={() => setShowFeedback(false)}
          onSubmitted={() => setShowFeedback(false)}
        />
      )}
      {showRequestLicense && (
        <RequestLicenseModal
          email={user?.primaryEmailAddress?.emailAddress}
          onClose={() => setShowRequestLicense(false)}
        />
      )}

      {/* ── LEFT SIDEBAR — all screen sizes ── */}
      <aside className="flex flex-col w-14 sm:w-56 shrink-0 bg-card border-r border-border min-h-screen sticky top-0 h-screen overflow-y-auto">
        {/* Logo */}
        <div className="h-14 flex items-center justify-center sm:justify-start px-2 sm:px-4 border-b border-border shrink-0">
          <Link
            href="/dashboard"
            className="flex items-center gap-2 text-primary hover:opacity-80 transition-opacity"
          >
            <Activity className="w-4 h-4 shrink-0" />
            <span className="hidden sm:inline font-bold tracking-tight text-sm leading-none">
              XAU
            </span>
            <span className="hidden sm:inline text-xs font-bold text-muted-foreground tracking-widest uppercase">
              TERMINAL
            </span>
          </Link>
        </div>

        {/* Trial Banner */}
        {license?.isTrial && license?.isActive && license?.expiresAt && (
          <div className="hidden sm:block px-3 pt-3 shrink-0">
            <TrialCountdownBanner
              expiresAt={license.expiresAt}
              onGetLicense={handleGetLicense}
            />
          </div>
        )}

        {/* Nav Links */}
        <nav className="flex-1 px-1 sm:px-2 py-3 flex flex-col gap-0.5">
          {navLinks.map((link) => {
            const Icon = link.icon;
            const isActive = location === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={link.mobileOnly ? "xl:hidden" : ""}
              >
                <span
                  title={link.label}
                  className={`flex items-center justify-center sm:justify-start gap-3 px-0 sm:px-3 py-2.5 rounded text-sm font-medium transition-colors cursor-pointer ${
                    isActive
                      ? "bg-primary/10 text-primary border border-primary/20"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="hidden sm:inline">{link.label}</span>
                </span>
              </Link>
            );
          })}
        </nav>

        {/* Help — links to a dedicated full page */}
        <div className="px-1 sm:px-2 pb-2 shrink-0">
          <Link href="/help">
            <span
              title="Need help?"
              className="w-full text-xs font-mono uppercase tracking-wider text-primary border border-primary/30 bg-primary/10 hover:bg-primary/20 transition-colors px-1 sm:px-2.5 py-2 rounded flex items-center justify-center sm:justify-start gap-2 cursor-pointer"
            >
              <MessageCircle className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden sm:inline">Need help?</span>
            </span>
          </Link>
        </div>

        {/* Bottom user section */}
        <div className="border-t border-border p-2 sm:p-3 flex flex-col gap-2 shrink-0">
          {isSignedIn && (
            <>
              {/* Notification + STATUS */}
              <div className="flex items-center justify-center sm:justify-between px-0 sm:px-1">
                <NotificationPanel />
                <div className="hidden sm:block text-right">
                  <div className="text-[10px] text-muted-foreground font-mono uppercase">STATUS</div>
                  <div className="text-[10px] text-green-500 font-mono flex items-center gap-1 justify-end">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                    LIVE
                  </div>
                </div>
              </div>

              {/* Name + Balance (desktop only) */}
              <div className="hidden sm:flex items-center justify-between rounded border border-border bg-secondary/30 px-2.5 py-1.5">
                <span
                  className="text-xs font-mono text-slate-300 truncate max-w-[80px]"
                  title={displayName}
                >
                  {displayName}
                </span>
                <div className="flex items-center gap-1">
                  <Wallet className="w-3 h-3 text-primary shrink-0" />
                  <span className="text-xs font-mono text-primary font-semibold">
                    {isBalanceVisible
                      ? `$${liveBalance.toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}`
                      : "••••••"}
                  </span>
                  <button
                    type="button"
                    onClick={() => setIsBalanceVisible((v) => !v)}
                    className="text-muted-foreground hover:text-primary focus:outline-none"
                    aria-label={isBalanceVisible ? "Hide balance" : "Show balance"}
                  >
                    {isBalanceVisible ? (
                      <EyeOff className="h-3 w-3" />
                    ) : (
                      <Eye className="h-3 w-3" />
                    )}
                  </button>
                </div>
              </div>

              {/* Sign out */}
              <button
                onClick={() => signOut()}
                title="Sign out"
                className="w-full text-xs font-mono uppercase tracking-wider text-red-400 border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 hover:text-red-300 transition-colors px-1 sm:px-2.5 py-1.5 rounded flex items-center justify-center sm:justify-start gap-2"
              >
                <LogOut className="w-3.5 h-3.5 shrink-0" />
                <span className="hidden sm:inline">Sign out</span>
              </button>
            </>
          )}
        </div>
      </aside>

      {/* ── MAIN CONTENT ── */}
      <main className="flex-1 flex flex-col min-w-0">
        {children}
      </main>
    </div>
  );
}
