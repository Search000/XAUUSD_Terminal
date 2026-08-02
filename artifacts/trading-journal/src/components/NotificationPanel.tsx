import { useState, useRef, useEffect, useCallback, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { X, Bell } from "lucide-react";
import {
  useListNotifications, getListNotificationsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";

// ── Types ─────────────────────────────────────────────────────────────────────
type Notif = {
  id: number;
  type: string;
  title: string;
  body: string;
  createdAt: string;
};

// ── Constants ─────────────────────────────────────────────────────────────────
const TYPE_COLORS: Record<string, string> = {
  daily:      "text-blue-400 bg-blue-500/10 border-blue-500/25",
  weekly:     "text-purple-400 bg-purple-500/10 border-purple-500/25",
  monthly:    "text-amber-400 bg-amber-500/10 border-amber-500/25",
  win_alert:  "text-emerald-400 bg-emerald-500/10 border-emerald-500/25",
  loss_alert: "text-rose-400 bg-rose-500/10 border-rose-500/25",
  off_day:    "text-slate-400 bg-slate-500/10 border-slate-500/25",
  admin:      "text-amber-300 bg-amber-500/10 border-amber-500/25",
};

const TYPE_LABELS: Record<string, string> = {
  daily:      "Daily",
  weekly:     "Weekly",
  monthly:    "Monthly",
  win_alert:  "Win",
  loss_alert: "Loss",
  off_day:    "Off Day",
  admin:      "Admin",
};

// How long a popup stays on screen before auto-dismissing.
const TOAST_DURATION_MS = 6000;

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatListDate(dateStr: string) {
  // e.g. "20 Jul 2026, 04:42"
  const d = new Date(dateStr);
  const day = d.getDate();
  const month = d.toLocaleString("en-US", { month: "short" });
  const year = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${day} ${month} ${year}, ${hh}:${mm}`;
}

// ── Notification Detail Modal ─────────────────────────────────────────────────
function NotifModal({ notif, onClose }: { notif: Notif; onClose: () => void }) {
  const colorClass = TYPE_COLORS[notif.type] ?? TYPE_COLORS.admin;
  const label = TYPE_LABELS[notif.type] ?? notif.type;

  useEffect(() => {
    function handler(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  // Portal to document.body — bypasses any parent stacking context/transform
  return createPortal(
    <div
      style={{ position: "fixed", inset: 0, zIndex: 99999, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}
      onClick={onClose}
    >
      {/* backdrop with blur */}
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)" }} />

      {/* card */}
      <div
        style={{ position: "relative", zIndex: 1, width: "100%", maxWidth: "440px" }}
        className="bg-[#1a1b1f] border border-[#2a2b30] rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex items-start justify-between gap-3 px-6 pt-5 pb-3">
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-semibold text-slate-100 leading-snug">{notif.title}</h3>
            <p className="text-[11px] text-muted-foreground mt-1 font-mono">{formatDate(notif.createdAt)}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 text-muted-foreground hover:text-slate-200 transition-colors p-1 -mt-0.5 rounded hover:bg-white/5"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* type pill — hide for admin broadcasts */}
        {notif.type !== "admin" && (
          <div className="px-6 pb-3">
            <span className={`text-[10px] font-mono font-semibold px-2 py-0.5 rounded border ${colorClass}`}>
              {label}
            </span>
          </div>
        )}

        {/* body */}
        <div className="px-6 pb-6">
          <pre className="text-sm text-slate-300 whitespace-pre-wrap font-sans leading-relaxed">
            {notif.body}
          </pre>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Popup toast for brand-new notifications ────────────────────────────────────
function NotifToast({ notif, onOpen, onDismiss }: { notif: Notif; onOpen: () => void; onDismiss: () => void }) {
  const label = TYPE_LABELS[notif.type] ?? notif.type;

  useEffect(() => {
    const t = setTimeout(onDismiss, TOAST_DURATION_MS);
    return () => clearTimeout(t);
  }, [notif.id, onDismiss]);

  return createPortal(
    <div
      style={{ position: "fixed", top: 16, right: 16, zIndex: 100000, width: 340, maxWidth: "calc(100vw - 32px)" }}
      className="bg-[#1a1b1f] border border-amber-500/30 rounded-xl shadow-2xl shadow-black/40 overflow-hidden animate-in slide-in-from-top-2 fade-in duration-200"
    >
      <button type="button" onClick={onOpen} className="w-full text-left px-4 py-3.5 flex items-start gap-3 hover:bg-white/[0.04] transition-colors">
        <span className="mt-0.5 shrink-0 w-7 h-7 rounded-lg bg-amber-500/10 border border-amber-500/25 flex items-center justify-center">
          <Bell className="w-3.5 h-3.5 text-amber-400" />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-mono font-semibold text-amber-400/90 mb-0.5">{label}</p>
          <p className="text-[13px] font-semibold text-slate-100 leading-snug mb-1">{notif.title}</p>
          <p className="text-[12px] text-muted-foreground leading-relaxed line-clamp-2">{notif.body}</p>
        </div>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onDismiss(); }}
          className="shrink-0 text-muted-foreground hover:text-slate-200 transition-colors p-1 -mt-0.5 -mr-1 rounded hover:bg-white/5"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </button>
    </div>,
    document.body,
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export function NotificationPanel() {
  const [open, setOpen] = useState(false);
  const [modal, setModal] = useState<Notif | null>(null);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const qc = useQueryClient();
  const { getToken, isSignedIn, userId } = useAuth();

  const { data: notifications = [] } = useListNotifications({
    query: {
      queryKey: getListNotificationsQueryKey(),
      staleTime: 0,
      refetchInterval: 8000, // fallback polling
    },
  });

  const refresh = useCallback(() => {
    qc.invalidateQueries({ queryKey: getListNotificationsQueryKey() });
  }, [qc]);

  // ── SSE real-time (fetch-based so Bearer token can be sent) ──────────────
  useEffect(() => {
    if (!isSignedIn) return;

    let abortController = new AbortController();
    let retryTimer: ReturnType<typeof setTimeout>;
    let retryCount = 0;

    async function connect() {
      try {
        const token = await getToken();
        if (!token) {
          // Not yet authenticated — retry after a short delay
          retryTimer = setTimeout(connect, 2000);
          return;
        }

        const response = await fetch("/api/notifications/stream", {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "text/event-stream",
          },
          signal: abortController.signal,
        });

        if (!response.ok || !response.body) {
          throw new Error(`SSE connect failed: ${response.status}`);
        }

        // Reset backoff on successful connection
        retryCount = 0;

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // SSE events are separated by double-newlines
          const parts = buffer.split("\n\n");
          buffer = parts.pop() ?? "";

          for (const part of parts) {
            const eventLine = part.split("\n").find((l) => l.startsWith("event:"));
            const eventName = eventLine?.slice("event:".length).trim();
            if (eventName === "connected" || eventName === "notification") {
              refresh();
            }
          }
        }

        // Stream ended — reconnect immediately (server closed gracefully)
        retryTimer = setTimeout(connect, 1000);
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        // Exponential backoff: 2s, 4s, 8s, … capped at 30s
        const delay = Math.min(2000 * 2 ** retryCount, 30_000);
        retryCount = Math.min(retryCount + 1, 5);
        retryTimer = setTimeout(connect, delay);
      }
    }

    connect();

    return () => {
      clearTimeout(retryTimer);
      abortController.abort();
    };
  }, [refresh, getToken, isSignedIn]);

  // ── Popup queue: show a toast for every notification the user hasn't
  // seen a popup for yet — whether it arrived live (SSE) or was waiting
  // for them when they logged in. No counts, no read/unread state — this
  // is the only "new notification" signal in the UI. ───────────────────
  const [toastQueue, setToastQueue] = useState<Notif[]>([]);
  const [activeToast, setActiveToast] = useState<Notif | null>(null);
  const queuedIdsRef = useRef<Set<number>>(new Set());
  const storageKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!userId || notifications.length === 0) return;
    const key = `xauusd_last_popup_notif_id_${userId}`;
    storageKeyRef.current = key;

    const stored = localStorage.getItem(key);
    if (stored === null) {
      // First time this device has seen this user's notifications — baseline
      // to the current newest id so we don't popup the entire history at once.
      const maxId = Math.max(...notifications.map((n) => n.id));
      localStorage.setItem(key, String(maxId));
      return;
    }

    const lastPoppedId = parseInt(stored, 10);
    const unpopped = notifications
      .filter((n) => n.id > lastPoppedId && !queuedIdsRef.current.has(n.id))
      .sort((a, b) => a.id - b.id);

    if (unpopped.length > 0) {
      unpopped.forEach((n) => queuedIdsRef.current.add(n.id));
      setToastQueue((q) => [...q, ...unpopped]);
    }
  }, [notifications, userId]);

  // Pull the next toast off the queue once the current one clears.
  useEffect(() => {
    if (activeToast || toastQueue.length === 0) return;
    const [next, ...rest] = toastQueue;
    setToastQueue(rest);
    setActiveToast(next);
  }, [toastQueue, activeToast]);

  const dismissActiveToast = useCallback(() => {
    if (!activeToast) return;
    const key = storageKeyRef.current;
    if (key) {
      const current = parseInt(localStorage.getItem(key) ?? "0", 10);
      if (activeToast.id > current) localStorage.setItem(key, String(activeToast.id));
    }
    setActiveToast(null);
  }, [activeToast]);

  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close panel on outside click — must check both the bell button AND the
  // portaled dropdown content (which lives outside panelRef's DOM subtree
  // now that it's rendered via createPortal to document.body).
  useEffect(() => {
    function handler(e: MouseEvent) {
      const target = e.target as Node;
      if (
        panelRef.current && !panelRef.current.contains(target) &&
        dropdownRef.current && !dropdownRef.current.contains(target)
      ) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Keep the dropdown's position in sync with the bell button (viewport
  // coordinates, since it's portaled to document.body).
  useEffect(() => {
    if (!open) return;
    function updateRect() {
      if (buttonRef.current) setAnchorRect(buttonRef.current.getBoundingClientRect());
    }
    updateRect();
    window.addEventListener("resize", updateRect);
    window.addEventListener("scroll", updateRect, true);
    return () => {
      window.removeEventListener("resize", updateRect);
      window.removeEventListener("scroll", updateRect, true);
    };
  }, [open]);

  function openModal(notif: Notif) {
    setModal(notif);
    setOpen(false);
  }

  // Group by month-year
  const grouped: Array<{ label: string; items: typeof notifications }> = [];
  for (const n of notifications) {
    const label = new Date(n.createdAt).toLocaleString("en-US", { month: "long", year: "numeric" });
    const last = grouped[grouped.length - 1];
    if (last?.label === label) last.items.push(n);
    else grouped.push({ label, items: [n] });
  }

  return (
    <>
      <div className="relative" ref={panelRef}>
        {/* ── Bell Button — no count, no unread state ─────────── */}
        <button
          ref={buttonRef}
          type="button"
          onClick={() => setOpen(v => !v)}
          className={`relative flex items-center justify-center w-8 h-8 rounded-lg border transition-all duration-150
            ${open
              ? "bg-amber-500/10 border-amber-500/40 text-amber-400"
              : "border-border text-muted-foreground hover:border-border/80 hover:text-slate-300 hover:bg-white/5"
            }`}
          aria-label="Notifications"
        >
          <Bell className="w-4 h-4" />
        </button>

        {open && anchorRect && createPortal(
          (() => {
            const PANEL_HEIGHT_ESTIMATE = 460; // header + max-h-[420px] list, roughly
            const spaceBelow = window.innerHeight - anchorRect.bottom;
            const spaceAbove = anchorRect.top;
            const openUpward = spaceBelow < PANEL_HEIGHT_ESTIMATE && spaceAbove > spaceBelow;

            const style: CSSProperties = openUpward
              ? {
                  position: "fixed",
                  bottom: window.innerHeight - anchorRect.top + 8,
                  left: Math.max(8, Math.min(anchorRect.right - 320, window.innerWidth - 320 - 8)),
                  width: 320,
                  maxHeight: Math.max(200, spaceAbove - 16),
                  zIndex: 9999,
                }
              : {
                  position: "fixed",
                  top: anchorRect.bottom + 8,
                  left: Math.max(8, Math.min(anchorRect.right - 320, window.innerWidth - 320 - 8)),
                  width: 320,
                  maxHeight: Math.max(200, spaceBelow - 16),
                  zIndex: 9999,
                };

            return (
              <div
                ref={dropdownRef}
                style={style}
                className="bg-[#1a1b1f] border border-[#2a2b30] rounded-xl shadow-2xl overflow-hidden flex flex-col"
              >

                {/* header */}
                <div className="flex items-center px-4 py-3 border-b border-[#2a2b30] shrink-0">
                  <span className="font-semibold text-sm text-slate-100">Notifications</span>
                </div>

                {/* list */}
                <div className="overflow-y-auto flex-1">
                  {notifications.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground">
                      <Bell className="w-4 h-4" />
                      <span className="text-xs">No notifications yet</span>
                    </div>
                  ) : (
                    grouped.map(({ label, items }) => (
                      <div key={label}>
                        {/* month divider */}
                        <div className="px-4 pt-3 pb-1">
                          <span className="text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wider">
                            {label}
                          </span>
                        </div>

                        {items.map((notif) => (
                          <button
                            key={notif.id}
                            type="button"
                            onClick={() => openModal(notif as Notif)}
                            className="w-full text-left px-4 py-3.5 flex items-start gap-3 hover:bg-white/[0.04] transition-colors border-b border-[#2a2b30]/50 last:border-0"
                          >
                            <div className="flex-1 min-w-0">
                              {/* title */}
                              <p className="text-[13px] leading-snug mb-1 font-medium text-slate-300">
                                {notif.title}
                              </p>
                              {/* body preview — 2 lines max */}
                              <p className="text-[12px] text-muted-foreground leading-relaxed line-clamp-2 mb-1.5">
                                {notif.body}
                              </p>
                              {/* date */}
                              <p className="text-[11px] text-muted-foreground/55">
                                {formatListDate(notif.createdAt)}
                              </p>
                            </div>
                          </button>
                        ))}
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })(),
          document.body,
        )}
      </div>

      {/* ── Popup for a brand-new / not-yet-seen notification ──────── */}
      {activeToast && (
        <NotifToast
          notif={activeToast}
          onOpen={() => { openModal(activeToast); dismissActiveToast(); }}
          onDismiss={dismissActiveToast}
        />
      )}

      {/* ── Full detail modal ────────────────────────────── */}
      {modal && (
        <NotifModal
          notif={modal}
          onClose={() => setModal(null)}
        />
      )}
    </>
  );
}
