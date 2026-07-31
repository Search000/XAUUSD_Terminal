import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { format, formatDistanceToNow } from "date-fns";
import { Activity, Search } from "lucide-react";
import { cn } from "@/lib/utils";

type ActivityEntry = {
  userId: string;
  email: string;
  createdAt: string;
  lastLoginAt: string | null;
  totalTrades: number;
  isLicenseActive: boolean;
  licenseExpiresAt: string | null;
  hasLicense: boolean;
};

async function getActivityLog(): Promise<ActivityEntry[]> {
  return customFetch<ActivityEntry[]>("/api/admin/activity");
}

export function ActivityLogPage() {
  const [search, setSearch] = React.useState("");

  const { data: entries = [], isLoading } = useQuery({
    queryKey: ["admin", "activity"],
    queryFn: getActivityLog,
    refetchInterval: 30_000,
  });

  const filtered = entries.filter(
    (e) =>
      e.email.toLowerCase().includes(search.toLowerCase()) ||
      e.userId.toLowerCase().includes(search.toLowerCase()),
  );

  function loginStatus(e: ActivityEntry) {
    if (!e.lastLoginAt) return { label: "Never", color: "text-muted-foreground/40" };
    const diffMs = Date.now() - new Date(e.lastLoginAt).getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    if (diffDays < 1) return { label: formatDistanceToNow(new Date(e.lastLoginAt), { addSuffix: true }), color: "text-green-400" };
    if (diffDays < 7) return { label: formatDistanceToNow(new Date(e.lastLoginAt), { addSuffix: true }), color: "text-primary" };
    return { label: formatDistanceToNow(new Date(e.lastLoginAt), { addSuffix: true }), color: "text-muted-foreground" };
  }

  const totalLogins = entries.filter((e) => !!e.lastLoginAt).length;
  const activeToday = entries.filter((e) => {
    if (!e.lastLoginAt) return false;
    const diffMs = Date.now() - new Date(e.lastLoginAt).getTime();
    return diffMs < 24 * 60 * 60 * 1000;
  }).length;

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">User Activity Log</h2>
        <p className="text-muted-foreground">Login history, trade counts and license status for every user.</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Activity className="h-5 w-5 text-primary" />
              <div>
                <p className="text-xs text-muted-foreground font-mono uppercase tracking-widest">Total Users</p>
                <p className="text-2xl font-bold font-mono">{entries.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Activity className="h-5 w-5 text-green-400" />
              <div>
                <p className="text-xs text-muted-foreground font-mono uppercase tracking-widest">Active Today</p>
                <p className="text-2xl font-bold font-mono text-green-400">{activeToday}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Activity className="h-5 w-5 text-amber-400" />
              <div>
                <p className="text-xs text-muted-foreground font-mono uppercase tracking-widest">Ever Logged In</p>
                <p className="text-2xl font-bold font-mono text-amber-400">{totalLogins}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <CardTitle>Activity Log</CardTitle>
            <div className="relative w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by email or user ID…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 h-8 text-sm font-mono"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead>Last Login</TableHead>
                <TableHead className="text-right">Trades</TableHead>
                <TableHead>License</TableHead>
                <TableHead>Expires</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground text-sm py-8 font-mono">
                    Loading…
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground text-sm py-8 font-mono">
                    No users found.
                  </TableCell>
                </TableRow>
              )}
              {filtered.map((e) => {
                const { label, color } = loginStatus(e);
                return (
                  <TableRow key={e.userId} className="font-mono text-xs">
                    <TableCell>
                      <div className="flex flex-col gap-0.5">
                        <span className="text-xs font-medium text-foreground">{e.email}</span>
                        <span className="text-[10px] text-muted-foreground/50 truncate max-w-[180px]">{e.userId}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {format(new Date(e.createdAt), "dd MMM yyyy")}
                    </TableCell>
                    <TableCell>
                      <span className={cn("text-xs", color)}>{label}</span>
                      {e.lastLoginAt && (
                        <div className="text-[10px] text-muted-foreground/50 mt-0.5">
                          {format(new Date(e.lastLoginAt), "dd MMM HH:mm")}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <span className={cn("font-mono", e.totalTrades > 0 ? "text-primary" : "text-muted-foreground/40")}>
                        {e.totalTrades}
                      </span>
                    </TableCell>
                    <TableCell>
                      {!e.hasLicense ? (
                        <Badge variant="secondary" className="text-[10px]">NO LICENSE</Badge>
                      ) : e.isLicenseActive ? (
                        <Badge className="border-green-500/30 bg-green-500/10 text-green-400 text-[10px]">ACTIVE</Badge>
                      ) : (
                        <Badge variant="destructive" className="text-[10px]">EXPIRED</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-[11px]">
                      {e.licenseExpiresAt ? format(new Date(e.licenseExpiresAt), "dd MMM yyyy") : "—"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
