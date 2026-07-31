import * as React from "react";
import { useAdminListUsers, getAdminListUsersQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { format, formatDistanceToNow } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Copy, Check, ChevronDown, ChevronUp, Clock, Search } from "lucide-react";

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = React.useState(false);
  function handleCopy(e: React.MouseEvent) {
    e.stopPropagation();
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }
  return (
    <button
      type="button"
      onClick={handleCopy}
      className="ml-1.5 text-muted-foreground hover:text-primary transition-colors shrink-0"
      title="Copy"
    >
      {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
    </button>
  );
}

function Field({ label, value, mono = false, copyable = false }: { label: string; value?: string | number | null; mono?: boolean; copyable?: boolean }) {
  if (value === null || value === undefined || value === "") return null;
  const strVal = String(value);
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground/60">{label}</span>
      <div className="flex items-center gap-0">
        <span className={cn("text-xs text-foreground break-all", mono && "font-mono")}>{strVal}</span>
        {copyable && <CopyButton value={strVal} />}
      </div>
    </div>
  );
}

function LastLoginBadge({ lastLoginAt }: { lastLoginAt?: string | null }) {
  if (!lastLoginAt) {
    return <span className="text-muted-foreground/40 text-xs">Never</span>;
  }
  const date = new Date(lastLoginAt);
  const diffMs = Date.now() - date.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  const isInactive = diffDays > 14;
  return (
    <span
      title={format(date, "PPP p")}
      className={cn(
        "text-xs font-mono",
        isInactive ? "text-amber-400" : "text-muted-foreground"
      )}
    >
      {formatDistanceToNow(date, { addSuffix: true })}
    </span>
  );
}

export function UsersPage() {
  const { data: users, isLoading } = useAdminListUsers({ query: { queryKey: getAdminListUsersQueryKey() } });
  const [expandedId, setExpandedId] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState("");

  const filteredUsers = (users ?? []).filter((u) => {
    const q = search.toLowerCase();
    return (
      u.email?.toLowerCase().includes(q) ||
      u.firstName?.toLowerCase().includes(q) ||
      u.lastName?.toLowerCase().includes(q) ||
      u.userId?.toLowerCase().includes(q) ||
      u.licenseCode?.toLowerCase().includes(q)
    );
  });

  const statusBadge = (user: NonNullable<typeof users>[number]) => {
    if (!user.hasLicense) return <Badge variant="secondary" className="text-[10px]">NO LICENSE</Badge>;
    if (user.isLicenseActive) return <Badge className="border-green-500/30 bg-green-500/10 text-green-400 text-[10px]">ACTIVE</Badge>;
    return <Badge variant="destructive" className="text-[10px]">EXPIRED</Badge>;
  };

  const rowAccent = (user: NonNullable<typeof users>[number]) => {
    if (!user.hasLicense) return "";
    if (user.isLicenseActive) return "border-l-2 border-l-green-500/40";
    return "border-l-2 border-l-destructive/40";
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">User Management</h2>
        <p className="text-muted-foreground">Full overview — subscription key, balance, name and all details per user.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>All Users</span>
            {users && <span className="text-sm font-normal text-muted-foreground font-mono">{filteredUsers.length} / {users.length} total</span>}
          </CardTitle>
          <div className="relative mt-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by email, name, user ID or license…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9 text-sm"
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="text-[11px] uppercase tracking-wider">
                <TableHead className="w-8"></TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Subscription Key</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Balance</TableHead>
                <TableHead>Investment</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>Days Left</TableHead>
                <TableHead><span className="flex items-center gap-1"><Clock className="w-3 h-3" />Last Login</span></TableHead>
                <TableHead className="text-right">Trades</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={11} className="h-32 text-center">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <svg className="w-5 h-5 text-primary animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                      <span className="text-xs font-mono text-muted-foreground uppercase tracking-widest">Loading Users...</span>
                    </div>
                  </TableCell>
                </TableRow>
              )}

              {filteredUsers.map((user) => {
                const isExpanded = expandedId === user.userId;
                return (
                  <React.Fragment key={user.userId}>
                    {/* ── Main row ── */}
                    <TableRow
                      className={cn("cursor-pointer transition-colors", rowAccent(user), isExpanded && "bg-muted/20")}
                      onClick={() => setExpandedId(isExpanded ? null : user.userId)}
                    >
                      {/* expand toggle */}
                      <TableCell className="pr-0">
                        {isExpanded
                          ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
                          : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                        }
                      </TableCell>

                      {/* email */}
                      <TableCell className="font-medium text-foreground text-xs max-w-[180px] truncate">
                        {user.email}
                      </TableCell>

                      {/* investor name */}
                      <TableCell className="text-xs text-muted-foreground">
                        {user.investorName ?? <span className="text-muted-foreground/40">—</span>}
                      </TableCell>

                      {/* subscription key */}
                      <TableCell>
                        {user.licenseCode ? (
                          <div className="flex items-center gap-1">
                            <span className="font-mono text-[11px] text-primary tracking-wide">{user.licenseCode}</span>
                            <CopyButton value={user.licenseCode} />
                          </div>
                        ) : (
                          <span className="text-muted-foreground/40 text-xs">—</span>
                        )}
                      </TableCell>

                      {/* status badge */}
                      <TableCell>{statusBadge(user)}</TableCell>

                      {/* latest balance */}
                      <TableCell className="font-mono text-xs">
                        {user.latestBalance
                          ? <span className="text-amber-400">${Number(user.latestBalance).toLocaleString("en-US", { minimumFractionDigits: 2 })}</span>
                          : <span className="text-muted-foreground/40">—</span>
                        }
                      </TableCell>

                      {/* total investment */}
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {user.totalInvestment
                          ? `$${Number(user.totalInvestment).toLocaleString("en-US", { minimumFractionDigits: 2 })}`
                          : <span className="text-muted-foreground/40">—</span>
                        }
                      </TableCell>

                      {/* expires */}
                      <TableCell className="text-xs text-muted-foreground">
                        {user.licenseExpiresAt ? format(new Date(user.licenseExpiresAt), "MMM d, yyyy") : "—"}
                      </TableCell>

                      {/* days remaining */}
                      <TableCell className="font-mono text-xs">
                        {user.daysRemaining !== null && user.daysRemaining !== undefined ? (
                          <span className={cn(user.daysRemaining <= 7 ? "text-destructive" : user.daysRemaining <= 30 ? "text-amber-400" : "text-foreground")}>
                            {user.daysRemaining}d
                          </span>
                        ) : "—"}
                      </TableCell>

                      {/* last login */}
                      <TableCell>
                        <LastLoginBadge lastLoginAt={user.lastLoginAt} />
                      </TableCell>

                      {/* total trades */}
                      <TableCell className="text-right font-mono text-xs">{user.totalTrades}</TableCell>
                    </TableRow>

                    {/* ── Expanded detail panel ── */}
                    {isExpanded && (
                      <TableRow className="bg-muted/10 hover:bg-muted/10">
                        <TableCell colSpan={11} className="p-0 border-b border-border">
                          <div className="px-6 py-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">

                            {/* Account */}
                            <div className="space-y-3">
                              <p className="text-[10px] font-mono font-semibold uppercase tracking-widest text-primary/70 border-b border-border pb-1">Account</p>
                              <Field label="User ID" value={user.userId} mono copyable />
                              <Field label="Email" value={user.email} copyable />
                              <Field label="Joined" value={format(new Date(user.createdAt), "PPP")} />
                              <Field label="Investor Name" value={user.investorName} />
                            </div>

                            {/* Subscription */}
                            <div className="space-y-3">
                              <p className="text-[10px] font-mono font-semibold uppercase tracking-widest text-primary/70 border-b border-border pb-1">Subscription</p>
                              <Field label="License Key" value={user.licenseCode} mono copyable />
                              <Field label="Transaction Code" value={user.licenseTransactionCode} mono copyable />
                              <Field label="Duration" value={user.licenseDurationDays ? `${user.licenseDurationDays} days` : null} />
                              <Field label="Expires" value={user.licenseExpiresAt ? format(new Date(user.licenseExpiresAt), "PPP") : null} />
                              <Field label="Days Remaining" value={user.daysRemaining !== null && user.daysRemaining !== undefined ? `${user.daysRemaining} days` : null} />
                            </div>

                            {/* Financials */}
                            <div className="space-y-3">
                              <p className="text-[10px] font-mono font-semibold uppercase tracking-widest text-primary/70 border-b border-border pb-1">Financials</p>
                              <Field label="Latest Balance (BL)" value={user.latestBalance ? `$${Number(user.latestBalance).toLocaleString("en-US", { minimumFractionDigits: 2 })}` : null} mono />
                              <Field label="Total Investment" value={user.totalInvestment ? `$${Number(user.totalInvestment).toLocaleString("en-US", { minimumFractionDigits: 2 })}` : null} mono />
                            </div>

                            {/* Activity */}
                            <div className="space-y-3">
                              <p className="text-[10px] font-mono font-semibold uppercase tracking-widest text-primary/70 border-b border-border pb-1">Activity</p>
                              <Field label="Total Trades" value={user.totalTrades} mono />
                              <div className="flex flex-col gap-0.5">
                                <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground/60">Last Login</span>
                                {user.lastLoginAt ? (
                                  <div className="flex flex-col gap-0.5">
                                    <span className="text-xs text-foreground font-mono">{format(new Date(user.lastLoginAt), "PPP p")}</span>
                                    <span className="text-[10px] text-muted-foreground">{formatDistanceToNow(new Date(user.lastLoginAt), { addSuffix: true })}</span>
                                  </div>
                                ) : (
                                  <span className="text-xs text-muted-foreground/40">Never recorded</span>
                                )}
                              </div>
                              <div className="pt-1">
                                {statusBadge(user)}
                              </div>
                            </div>

                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                );
              })}

              {!isLoading && filteredUsers.length === 0 && (
                <TableRow>
                  <TableCell colSpan={11} className="text-center text-muted-foreground p-8 text-sm font-mono">
                    No users found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
