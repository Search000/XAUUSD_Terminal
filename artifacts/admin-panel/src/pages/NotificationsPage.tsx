import { useState } from "react";
import {
  useAdminListNotifications, getAdminListNotificationsQueryKey,
  useAdminBroadcastNotification,
  useAdminSendToUsers,
  useAdminDeleteNotification,
  useAdminClearAllNotifications,
  useAdminListUsers, getAdminListUsersQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Bell, Send, Clock, Loader2, Trash2, Trash, Users, Radio } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

const TYPE_LABELS: Record<string, string> = {
  admin: "BROADCAST",
  admin_targeted: "TARGETED",
};

const TYPE_COLORS: Record<string, string> = {
  daily: "bg-blue-500/10 text-blue-400 border-blue-500/30",
  weekly: "bg-purple-500/10 text-purple-400 border-purple-500/30",
  monthly: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  win_alert: "bg-green-500/10 text-green-400 border-green-500/30",
  loss_alert: "bg-red-500/10 text-red-400 border-red-500/30",
  off_day: "bg-slate-500/10 text-slate-400 border-slate-500/30",
  admin: "bg-primary/10 text-primary border-primary/30",
  admin_targeted: "bg-teal-500/10 text-teal-400 border-teal-500/30",
};

type SendMode = "all" | "targeted";

export function NotificationsPage() {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [sendMode, setSendMode] = useState<SendMode>("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [success, setSuccess] = useState(false);
  const [clearConfirm, setClearConfirm] = useState(false);
  const qc = useQueryClient();

  const { data: notifications = [], isLoading } = useAdminListNotifications({
    query: { queryKey: getAdminListNotificationsQueryKey() },
  });
  const { data: users = [] } = useAdminListUsers({
    query: { queryKey: getAdminListUsersQueryKey() },
  });

  const broadcast = useAdminBroadcastNotification({
    mutation: {
      onSuccess: () => {
        setTitle(""); setBody("");
        setSuccess(true);
        setTimeout(() => setSuccess(false), 3000);
        qc.invalidateQueries({ queryKey: getAdminListNotificationsQueryKey() });
      },
    },
  });

  const sendToUsers = useAdminSendToUsers({
    mutation: {
      onSuccess: () => {
        setTitle(""); setBody(""); setSelectedIds(new Set());
        setSuccess(true);
        setTimeout(() => setSuccess(false), 3000);
        qc.invalidateQueries({ queryKey: getAdminListNotificationsQueryKey() });
      },
    },
  });

  const deleteOne = useAdminDeleteNotification({
    mutation: {
      onSuccess: () => qc.invalidateQueries({ queryKey: getAdminListNotificationsQueryKey() }),
    },
  });

  const clearAll = useAdminClearAllNotifications({
    mutation: {
      onSuccess: () => {
        setClearConfirm(false);
        qc.invalidateQueries({ queryKey: getAdminListNotificationsQueryKey() });
      },
    },
  });

  const handleSend = () => {
    if (!title.trim() || !body.trim()) return;
    if (sendMode === "all") {
      broadcast.mutate({ data: { title: title.trim(), body: body.trim() } });
    } else {
      if (selectedIds.size === 0) return;
      sendToUsers.mutate({ data: { title: title.trim(), body: body.trim(), userIds: Array.from(selectedIds) } });
    }
  };

  const toggleUser = (userId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(userId) ? next.delete(userId) : next.add(userId);
      return next;
    });
  };

  const isPending = broadcast.isPending || sendToUsers.isPending;
  const canSend = title.trim() && body.trim() && (sendMode === "all" || selectedIds.size > 0);

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Notifications</h2>
        <p className="text-muted-foreground">Send notifications to all users or specific individuals.</p>
      </div>

      {/* ── Compose ─────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Send className="h-4 w-4 text-primary" />
            Send Notification
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">

          {/* Mode toggle */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setSendMode("all")}
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 rounded-md text-sm border transition-colors",
                sendMode === "all"
                  ? "bg-primary/10 border-primary/40 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              <Radio className="h-3.5 w-3.5" />
              Broadcast to All
            </button>
            <button
              type="button"
              onClick={() => setSendMode("targeted")}
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 rounded-md text-sm border transition-colors",
                sendMode === "targeted"
                  ? "bg-primary/10 border-primary/40 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              <Users className="h-3.5 w-3.5" />
              Specific Users
            </button>
          </div>

          {/* User picker (targeted mode) */}
          {sendMode === "targeted" && (
            <div className="border border-border rounded-md overflow-hidden">
              <div className="px-3 py-2 bg-muted/30 border-b border-border flex items-center justify-between">
                <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                  Select Recipients
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedIds(new Set(users.map(u => u.userId)))}
                    className="text-[11px] text-primary hover:underline"
                  >Select all</button>
                  <span className="text-muted-foreground/40">·</span>
                  <button
                    type="button"
                    onClick={() => setSelectedIds(new Set())}
                    className="text-[11px] text-muted-foreground hover:text-foreground hover:underline"
                  >Clear</button>
                </div>
              </div>
              <div className="max-h-52 overflow-y-auto divide-y divide-border">
                {users.length === 0 ? (
                  <p className="text-xs text-muted-foreground p-4 text-center">No users found.</p>
                ) : (
                  users.map(user => {
                    const checked = selectedIds.has(user.userId);
                    return (
                      <label
                        key={user.userId}
                        className={cn(
                          "flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors select-none",
                          checked ? "bg-primary/5" : "hover:bg-muted/30",
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleUser(user.userId)}
                          className="accent-primary h-3.5 w-3.5 rounded"
                        />
                        <div className="flex-1 min-w-0">
                          <span className="text-sm text-foreground truncate block">{user.email}</span>
                          {user.investorName && (
                            <span className="text-[11px] text-muted-foreground">{user.investorName}</span>
                          )}
                        </div>
                        {user.isLicenseActive ? (
                          <span className="text-[10px] text-green-400 font-mono">ACTIVE</span>
                        ) : (
                          <span className="text-[10px] text-muted-foreground/50 font-mono">—</span>
                        )}
                      </label>
                    );
                  })
                )}
              </div>
              {selectedIds.size > 0 && (
                <div className="px-3 py-2 bg-muted/30 border-t border-border text-xs text-muted-foreground font-mono">
                  {selectedIds.size} user{selectedIds.size !== 1 ? "s" : ""} selected
                </div>
              )}
            </div>
          )}

          {/* Title + body */}
          <div className="space-y-1.5">
            <Label htmlFor="notif-title">Title</Label>
            <Input
              id="notif-title"
              placeholder="e.g. System Maintenance Tonight"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={120}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="notif-body">Message Body</Label>
            <textarea
              id="notif-body"
              className="w-full min-h-[100px] rounded-md border border-input bg-background px-3 py-2 text-sm font-mono resize-y focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              placeholder="Write your message here..."
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={handleSend} disabled={!canSend || isPending} className="gap-2">
              {isPending ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Sending…</>
              ) : success ? (
                "✅ Sent!"
              ) : sendMode === "all" ? (
                <><Send className="h-4 w-4" /> Send to All Users</>
              ) : (
                <><Send className="h-4 w-4" /> Send to {selectedIds.size} User{selectedIds.size !== 1 ? "s" : ""}</>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── Notification History ──────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <Bell className="h-4 w-4 text-primary" />
              Notification History
              {notifications.length > 0 && (
                <span className="text-xs font-normal text-muted-foreground font-mono">
                  ({notifications.length})
                </span>
              )}
            </CardTitle>
            {notifications.length > 0 && (
              clearConfirm ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-destructive">Delete all {notifications.length} records?</span>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => clearAll.mutate()}
                    disabled={clearAll.isPending}
                    className="h-7 text-xs gap-1"
                  >
                    {clearAll.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash className="h-3 w-3" />}
                    Confirm
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setClearConfirm(false)} className="h-7 text-xs">
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setClearConfirm(true)}
                  className="h-7 text-xs text-muted-foreground hover:text-destructive gap-1"
                >
                  <Trash className="h-3 w-3" />
                  Clear All
                </Button>
              )
            )}
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center gap-2 py-4 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : notifications.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No notifications sent yet.</p>
          ) : (
            <div className="space-y-2">
              {notifications.map((n) => (
                <div
                  key={n.id}
                  className="border border-border rounded-md p-4 group relative"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2 flex-wrap min-w-0">
                      <Badge className={`text-[10px] font-mono border shrink-0 ${TYPE_COLORS[n.type] ?? "bg-muted text-foreground border-border"}`}>
                        {TYPE_LABELS[n.type] ?? n.type}
                      </Badge>
                      <span className="font-semibold text-sm truncate">{n.title}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs text-muted-foreground font-mono">
                        {format(new Date(n.createdAt), "MMM d, HH:mm")}
                      </span>
                      <button
                        type="button"
                        onClick={() => deleteOne.mutate({ id: n.id })}
                        disabled={deleteOne.isPending}
                        className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive p-1 rounded hover:bg-destructive/10"
                        title="Delete"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  <pre className="mt-2 text-xs text-muted-foreground font-mono whitespace-pre-wrap leading-relaxed bg-secondary/20 rounded p-2 max-h-32 overflow-y-auto">
                    {n.body}
                  </pre>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
