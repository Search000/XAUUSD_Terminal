import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { X, Check, CheckCheck } from "lucide-react";
import {
  useListNotifications, getListNotificationsQueryKey,
  useMarkAllNotificationsRead, useMarkNotificationRead,
  getGetNotificationsUnreadCountQueryKey, useGetNotificationsUnreadCount,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";

// ── Types ─────────────────────────────────────────────────────────────────────
type Notif = {
  id: number;
  type: string;
  title: string;
  body: string;
  isRead: boolean;
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

// ── Premium Bell SVG icon ─────────────────────────────────────────────────────
function BellIcon({ hasUnread }: { hasUnread: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="transition-all">
      {/* bell body */}
      <path
        d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"
        stroke={hasUnread ? "rgb(251 191 36)" : "currentColor"}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill={hasUnread ? "rgba(251,191,36,0.08)" : "none"}
      />
      {/* clapper */}
      <path
        d="M13.73 21a2 2 0 0 1-3.46 0"
        stroke={hasUnread ? "rgb(251 191 36)" : "currentColor"}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ── Notification Detail Modal ─────────────────────────────────────────────────
function NotifModal({ notif, onClose, onMarkRead }: { notif: Notif; onClose: () => void; onMarkRead: (id: number) => void }) {
  const colorClass = TYPE_COLORS[notif.type] ?? TYPE_COLORS.admin;
  const label = TYPE_LABELS[notif.type] ?? notif.type;

  useEffect(() => {
    function handler(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  useEffect(() => {
    if (!notif.isRead) onMarkRead(notif.id);
  }, [notif.id, notif.isRead, onMarkRead]);

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

// ── Main Component ────────────────────────────────────────────────────────────
export function NotificationPanel() {
  const [open, setOpen] = useState(false);
  const [modal, setModal] = useState<Notif | null>(null);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const qc = useQueryClient();
  const { getToken, isSignedIn } = useAuth();

  const { data: notifications = [] } = useListNotifications({
    query: {
      queryKey: getListNotificationsQueryKey(),
      staleTime: 0,
      refetchInterval: 8000, // fallback polling
    },
  });
  const { data: countData } = useGetNotificationsUnreadCount({
    query: {
      queryKey: getGetNotificationsUnreadCountQueryKey(),
      staleTime: 0,
      refetchInterval: 8000,
    },
  });

  const markAll = useMarkAllNotificationsRead();
  const markOne = useMarkNotificationRead();

  const refresh = useCallback(() => {
    qc.invalidateQueries({ queryKey: getListNotificationsQueryKey() });
    qc.invalidateQueries({ queryKey: getGetNotificationsUnreadCountQueryKey() });
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

  const unreadCount = countData?.count ?? 0;

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

  async function handleMarkAll() {
    await markAll.mutateAsync(undefined as unknown as void);
    refresh();
  }

  async function handleMarkOne(id: number) {
    await markOne.mutateAsync({ id });
    refresh();
  }

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
        {/* ── Bell Button ──────────────────────────────────── */}
        <button
          ref={buttonRef}
          type="button"
          onClick={() => setOpen(v => !v)}
          className={`relative flex items-center justify-center w-8 h-8 rounded-lg border transition-all duration-150
            ${open
              ? "bg-amber-500/10 border-amber-500/40 text-amber-400"
              : unreadCount > 0
                ? "border-amber-500/30 text-amber-400 hover:bg-amber-500/10 hover:border-amber-500/40"
                : "border-border text-muted-foreground hover:border-border/80 hover:text-slate-300 hover:bg-white/5"
            }`}
          aria-label="Notifications"
        >
          <BellIcon hasUnread={unreadCount > 0} />
          {unreadCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 flex items-center justify-center bg-amber-500 text-black text-[9px] font-bold font-mono rounded-full px-0.5 shadow-md shadow-amber-500/30">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>

        {/* ── Dropdown Panel — portaled to document.body so it isn't
             clipped/scrolled by the sidebar's own overflow-y-auto ──────── */}
        {open && anchorRect && createPortal(
          <div
            ref={dropdownRef}
            style={{
              position: "fixed",
              top: anchorRect.bottom + 8,
              left: Math.max(8, Math.min(anchorRect.right - 320, window.innerWidth - 320 - 8)),
              width: 320,
              zIndex: 9999,
            }}
            className="bg-[#1a1b1f] border border-[#2a2b30] rounded-xl shadow-2xl overflow-hidden"
          >

            {/* header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#2a2b30]">
              <span className="font-semibold text-sm text-slate-100">Notifications</span>
              <button
                type="button"
                onClick={handleMarkAll}
                disabled={markAll.isPending || unreadCount === 0}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-slate-300 transition-colors disabled:opacity-40"
              >
                <CheckCheck className="w-3.5 h-3.5" />
                Mark as read
              </button>
            </div>

            {/* list */}
            <div className="max-h-[420px] overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground">
                  <BellIcon hasUnread={false} />
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

                    {items.map((notif) => {
                      const isUnread = !notif.isRead;

                      return (
                        <button
                          key={notif.id}
                          type="button"
                          onClick={() => openModal(notif as Notif)}
                          className={`w-full text-left px-4 py-3.5 flex items-start gap-3 hover:bg-white/[0.04] transition-colors border-b border-[#2a2b30]/50 last:border-0 ${isUnread ? "bg-white/[0.02]" : ""}`}
                        >
                          {/* unread dot */}
                          <span className={`mt-[5px] shrink-0 w-1.5 h-1.5 rounded-full ${isUnread ? "bg-amber-400" : "bg-transparent"}`} />

                          <div className="flex-1 min-w-0">
                            {/* title */}
                            <p className={`text-[13px] leading-snug mb-1 ${isUnread ? "font-semibold text-slate-100" : "font-medium text-slate-300"}`}>
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
                      );
                    })}
                  </div>
                ))
              )}
            </div>
          </div>,
          document.body,
        )}
      </div>

      {/* ── Full detail modal ────────────────────────────── */}
      {modal && (
        <NotifModal
          notif={modal}
          onClose={() => setModal(null)}
          onMarkRead={handleMarkOne}
        />
      )}
    </>
  );
}
