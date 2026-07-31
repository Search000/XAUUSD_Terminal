import { useAdminGetStats, useListLicenses, getAdminGetStatsQueryKey, getListLicensesQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LicenseStatusBadge, formatDaysLeft } from "@/components/shared/LicenseHelpers";
import { Users, UserCheck, Key, ShieldCheck, Clock, ShieldAlert } from "lucide-react";
import { format } from "date-fns";

export function DashboardPage() {
  const { data: stats, isLoading: statsLoading } = useAdminGetStats({ query: { queryKey: getAdminGetStatsQueryKey() } });
  const { data: licenses, isLoading: licensesLoading } = useListLicenses({ query: { queryKey: getListLicensesQueryKey() } });

  const sortedLicenses = licenses?.slice().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()) || [];

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">System Overview</h2>
        <p className="text-muted-foreground">Real-time metrics and recent terminal activity.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <StatCard title="Total Users" value={stats?.totalUsers} icon={Users} loading={statsLoading} />
        <StatCard title="Active Users" value={stats?.activeUsers} icon={UserCheck} loading={statsLoading} />
        <StatCard title="Total Licenses" value={stats?.totalLicenses} icon={Key} loading={statsLoading} />
        <StatCard title="Active Licenses" value={stats?.activeLicenses} icon={ShieldCheck} loading={statsLoading} />
        <StatCard title="Expired Licenses" value={stats?.expiredLicenses} icon={Clock} loading={statsLoading} />
        <StatCard title="Revoked Licenses" value={stats?.revokedLicenses} icon={ShieldAlert} loading={statsLoading} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Licenses</CardTitle>
        </CardHeader>
        <CardContent>
          {licensesLoading ? (
             <div className="flex flex-col items-center justify-center p-8 gap-2">
               <svg className="w-5 h-5 text-primary animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
               <span className="text-xs font-mono text-muted-foreground uppercase tracking-widest">Loading...</span>
             </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Transaction</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedLicenses.slice(0, 10).map((lic) => (
                  <TableRow key={lic.id}>
                    <TableCell className="font-mono">{lic.licenseCode}</TableCell>
                    <TableCell className="font-mono text-muted-foreground">{lic.transactionCode}</TableCell>
                    <TableCell><LicenseStatusBadge license={lic} /></TableCell>
                    <TableCell>{lic.usedByEmail || <span className="text-muted-foreground">-</span>}</TableCell>
                    <TableCell className="data-number">{lic.durationDays}d</TableCell>
                    <TableCell>{formatDaysLeft(lic.expiresAt)}</TableCell>
                    <TableCell className="text-muted-foreground">{format(new Date(lic.createdAt), "MMM d, yyyy")}</TableCell>
                  </TableRow>
                ))}
                {sortedLicenses.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground p-8">No licenses generated yet.</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ title, value, icon: Icon, loading }: { title: string, value?: number, icon: any, loading: boolean }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="h-7 w-16 bg-muted animate-pulse rounded" />
        ) : (
          <div className="text-2xl font-bold data-number">{value || 0}</div>
        )}
      </CardContent>
    </Card>
  );
}
