import * as React from "react";
import { useState } from "react";
import { toast } from "sonner";
import { useListLicenses, getListLicensesQueryKey, useGenerateLicense, useDeleteLicense } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LicenseStatusBadge, formatDaysLeft } from "@/components/shared/LicenseHelpers";
import { format } from "date-fns";
import { Copy, CheckCircle, Trash2, Zap, Users, Search } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

export function LicensesPage() {
  const queryClient = useQueryClient();
  const { data: licenses, isLoading } = useListLicenses({ query: { queryKey: getListLicensesQueryKey() } });
  
  const generate = useGenerateLicense({ 
    mutation: { 
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListLicensesQueryKey() });
        toast.success("License generated");
      },
      onError: (err: unknown) => {
        const msg = (err as { message?: string })?.message ?? "Failed to generate license.";
        toast.error("Generation failed", { description: msg });
      },
    } 
  });
  
  const deleteLicense = useDeleteLicense({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListLicensesQueryKey() });
        setConfirmingDeleteId(null);
        toast.success("License deleted");
      },
      onError: (err: unknown) => {
        const msg = (err as { message?: string })?.message ?? "Failed to delete license.";
        toast.error("Delete failed", { description: msg });
        setConfirmingDeleteId(null);
      },
    }
  });

  const [transactionCode, setTransactionCode] = useState("");
  const [durationDays, setDurationDays] = useState("30");
  const [note, setNote] = useState("");
  const [generatedCode, setGeneratedCode] = useState("");
  const [copied, setCopied] = useState(false);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<number | null>(null);
  const [search, setSearch] = useState("");

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!transactionCode || !durationDays) return;
    try {
      const res = await generate.mutateAsync({
        data: {
          transactionCode,
          durationDays: parseInt(durationDays, 10),
          note: note || undefined
        }
      });
      setGeneratedCode(res.licenseCode);
      setTransactionCode("");
      setNote("");
    } catch {
      // onError handler above shows the toast
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(generatedCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDelete = (id: number) => {
    setConfirmingDeleteId(currentId => currentId === id ? null : id);
  };

  const allLicensesRaw = licenses?.slice().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()) || [];
  const allLicenses = search
    ? allLicensesRaw.filter((l) => {
        const q = search.toLowerCase();
        return (
          l.licenseCode?.toLowerCase().includes(q) ||
          l.transactionCode?.toLowerCase().includes(q) ||
          l.note?.toLowerCase().includes(q) ||
          (l.usedByUserId ?? "").toLowerCase().includes(q)
        );
      })
    : allLicensesRaw;

  // Separate trial vs paid licenses
  const trialLicenses = allLicenses.filter(l => l.transactionCode === "TRIAL");
  const paidLicenses = allLicenses.filter(l => l.transactionCode !== "TRIAL");

  // Trial stats
  const activeTrials = trialLicenses.filter(l => l.isActive && !l.isRevoked && (l.expiresAt ? new Date(l.expiresAt) > new Date() : true));
  const expiredTrials = trialLicenses.filter(l => l.isActive && !l.isRevoked && l.expiresAt && new Date(l.expiresAt) <= new Date());

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">License Management</h2>
        <p className="text-muted-foreground">Generate, view, and delete access licenses.</p>
      </div>

      {/* ── Trial Overview ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-card border border-primary/20 rounded-lg p-4 flex items-center gap-4">
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <Zap className="w-5 h-5 text-primary" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground font-mono uppercase tracking-wider">Total Trial Users</p>
            <p className="text-2xl font-bold font-mono">{isLoading ? "—" : trialLicenses.length}</p>
          </div>
        </div>
        <div className="bg-card border border-green-500/20 rounded-lg p-4 flex items-center gap-4">
          <div className="w-10 h-10 rounded-full bg-green-500/10 flex items-center justify-center shrink-0">
            <Users className="w-5 h-5 text-green-400" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground font-mono uppercase tracking-wider">Active Trials</p>
            <p className="text-2xl font-bold font-mono text-green-400">{isLoading ? "—" : activeTrials.length}</p>
          </div>
        </div>
        <div className="bg-card border border-slate-500/20 rounded-lg p-4 flex items-center gap-4">
          <div className="w-10 h-10 rounded-full bg-slate-500/10 flex items-center justify-center shrink-0">
            <Users className="w-5 h-5 text-slate-400" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground font-mono uppercase tracking-wider">Expired Trials</p>
            <p className="text-2xl font-bold font-mono text-slate-400">{isLoading ? "—" : expiredTrials.length}</p>
          </div>
        </div>
      </div>

      {/* ── Trial Users Table ── */}
      <Card className="border-primary/10">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-primary" />
            <CardTitle className="text-lg">Trial Users</CardTitle>
          </div>
          <CardDescription>Users who self-activated a free trial.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Activated</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Days Left</TableHead>
                <TableHead className="w-[80px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {trialLicenses.map((lic) => (
                <TableRow key={lic.id}>
                  <TableCell className="font-mono text-sm">
                    {lic.usedByEmail || <span className="text-muted-foreground italic">Not activated</span>}
                  </TableCell>
                  <TableCell className="font-mono">{lic.durationDays}d</TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {lic.activatedAt ? format(new Date(lic.activatedAt), "dd MMM yyyy") : "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {lic.expiresAt ? format(new Date(lic.expiresAt), "dd MMM yyyy") : "—"}
                  </TableCell>
                  <TableCell>
                    <LicenseStatusBadge license={lic} />
                  </TableCell>
                  <TableCell className="font-mono text-sm">
                    {lic.expiresAt ? formatDaysLeft(lic.expiresAt) : "—"}
                  </TableCell>
                  <TableCell>
                    {confirmingDeleteId === lic.id ? (
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-destructive whitespace-nowrap">Delete?</span>
                        <Button
                          variant="destructive"
                          size="sm"
                          className="h-8 px-2"
                          onClick={async () => { await deleteLicense.mutateAsync({ id: lic.id }); }}
                          disabled={deleteLicense.isPending}
                        >
                          {deleteLicense.isPending ? "Deleting…" : "Confirm"}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 px-2"
                          onClick={() => setConfirmingDeleteId(null)}
                          disabled={deleteLicense.isPending}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive h-8 px-2"
                        onClick={() => setConfirmingDeleteId(currentId => currentId === lic.id ? null : lic.id)}
                        disabled={deleteLicense.isPending}
                      >
                        <Trash2 className="h-4 w-4 mr-1" />
                        Delete
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {!isLoading && trialLicenses.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground p-8">
                    No trial users yet. Enable Trial Mode in Settings to let users self-activate.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* ── Generate New License ── */}
      <Card className="border-primary/20 bg-primary/5">
        <CardHeader>
          <CardTitle className="text-primary text-xl">Generate New License</CardTitle>
          <CardDescription>Issue a new license code for a customer based on their payment transaction.</CardDescription>
        </CardHeader>
        <form onSubmit={handleGenerate}>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="space-y-2">
                <Label htmlFor="txCode">Transaction Ref / Order ID</Label>
                <Input 
                  id="txCode" 
                  value={transactionCode} 
                  onChange={(e) => setTransactionCode(e.target.value)} 
                  placeholder="e.g. pi_3M..."
                  required
                  className="font-mono bg-background"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="duration">Duration (Days)</Label>
                <Input 
                  id="duration" 
                  type="number" 
                  min="1"
                  value={durationDays} 
                  onChange={(e) => setDurationDays(e.target.value)} 
                  required
                  className="data-number bg-background"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="note">Admin Note (Optional)</Label>
                <Input 
                  id="note" 
                  value={note} 
                  onChange={(e) => setNote(e.target.value)} 
                  placeholder="e.g. VIP Customer"
                  className="bg-background"
                />
              </div>
            </div>
            
            {generatedCode && (
              <div className="mt-6 p-4 bg-background border border-primary/30 rounded-lg flex items-center justify-between animate-in fade-in zoom-in-95 duration-300">
                <div className="space-y-1">
                  <p className="text-sm font-medium text-muted-foreground">Generated License Code</p>
                  <p className="text-2xl font-mono tracking-wider text-primary">{generatedCode}</p>
                </div>
                <Button type="button" variant="secondary" onClick={handleCopy} className="gap-2">
                  {copied ? <CheckCircle className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                  {copied ? "Copied" : "Copy Code"}
                </Button>
              </div>
            )}
          </CardContent>
          <CardFooter>
            <Button type="submit" disabled={generate.isPending} className="w-full md:w-auto">
              {generate.isPending ? "Generating..." : "Generate License"}
            </Button>
          </CardFooter>
        </form>
      </Card>

      {/* ── Paid License Registry ── */}
      <Card>
        <CardHeader>
          <CardTitle>Paid License Registry</CardTitle>
          <CardDescription>All non-trial licenses generated for customers.</CardDescription>
          <div className="relative mt-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by license code, transaction, note or user ID…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9 text-sm"
            />
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Transaction</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Used By</TableHead>
                <TableHead>Activated</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Days Left</TableHead>
                <TableHead className="w-[80px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paidLicenses.map((lic) => (
                <TableRow key={lic.id}>
                  <TableCell className="font-mono text-primary text-sm tracking-wider">{lic.licenseCode}</TableCell>
                  <TableCell className="font-mono text-muted-foreground">{lic.transactionCode}</TableCell>
                  <TableCell className="font-mono">{lic.durationDays}d</TableCell>
                  <TableCell className="text-sm">
                    {lic.usedByEmail || <span className="text-muted-foreground italic">Unused</span>}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {lic.activatedAt ? format(new Date(lic.activatedAt), "dd MMM yyyy") : "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {lic.expiresAt ? format(new Date(lic.expiresAt), "dd MMM yyyy") : "—"}
                  </TableCell>
                  <TableCell>
                    <LicenseStatusBadge license={lic} />
                  </TableCell>
                  <TableCell className="font-mono text-sm">
                    {lic.expiresAt ? formatDaysLeft(lic.expiresAt) : "—"}
                  </TableCell>
                  <TableCell>
                    {confirmingDeleteId === lic.id ? (
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-destructive whitespace-nowrap">Delete?</span>
                        <Button
                          variant="destructive"
                          size="sm"
                          className="h-8 px-2"
                          onClick={async () => {
                            await deleteLicense.mutateAsync({ id: lic.id });
                          }}
                          disabled={deleteLicense.isPending}
                        >
                          {deleteLicense.isPending ? "Deleting…" : "Confirm"}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 px-2"
                          onClick={() => setConfirmingDeleteId(null)}
                          disabled={deleteLicense.isPending}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive h-8 px-2"
                        onClick={() => handleDelete(lic.id)}
                        disabled={deleteLicense.isPending}
                        aria-label={`Delete license ${lic.licenseCode}`}
                      >
                        <Trash2 className="h-4 w-4 mr-1" />
                        Delete
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {!isLoading && paidLicenses.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground p-8">No paid licenses generated yet.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
