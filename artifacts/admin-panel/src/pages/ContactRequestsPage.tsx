import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@clerk/react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Phone, Trash2, RefreshCw, ShieldCheck, Minus, Plus } from "lucide-react";

interface AttemptRow {
  id: number;
  ip: string;
  attempts: number;
  lastEmail: string | null;
  lastPhone: string | null;
  lastAt: string;
}

const API_BASE = ((import.meta.env.VITE_API_URL as string) ?? "").replace(/\/+$/, "");

export function ContactRequestsPage() {
  const { getToken } = useAuth();
  const [rows, setRows] = useState<AttemptRow[]>([]);
  const [limit, setLimit] = useState(3);
  const [limitInput, setLimitInput] = useState("3");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const authHeaders = useCallback(async () => {
    const token = await getToken();
    return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
  }, [getToken]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const headers = await authHeaders();
      const res = await fetch(`${API_BASE}/api/admin/contact-attempts`, { headers });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const data = await res.json() as { limit: number; rows: AttemptRow[] };
      setRows(data.rows ?? []);
      setLimit(data.limit ?? 3);
      setLimitInput(String(data.limit ?? 3));
    } catch (e) {
      toast.error("Failed to load contact requests", {
        description: (e as Error).message ?? "Please try again.",
      });
    } finally {
      setLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  async function saveLimit(newLimit: number) {
    if (newLimit < 1) return;
    setSaving(true);
    try {
      const headers = await authHeaders();
      const res = await fetch(`${API_BASE}/api/admin/contact-config`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ limit: newLimit }),
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      setLimit(newLimit);
      setLimitInput(String(newLimit));
      toast.success("Limit updated", { description: `Max attempts per IP set to ${newLimit}.` });
    } catch (e) {
      toast.error("Failed to save limit", {
        description: (e as Error).message ?? "Please try again.",
      });
      setLimitInput(String(limit));
    } finally {
      setSaving(false);
    }
  }

  async function resetIp(ip: string) {
    try {
      const headers = await authHeaders();
      const res = await fetch(`${API_BASE}/api/admin/contact-attempts/${encodeURIComponent(ip)}`, { method: "DELETE", headers });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      setRows((prev) => prev.filter((r) => r.ip !== ip));
      toast.success("IP reset", { description: `Attempts cleared for ${ip}.` });
    } catch (e) {
      toast.error("Failed to reset IP", { description: (e as Error).message ?? "Please try again." });
    }
  }

  async function resetAll() {
    if (!confirm("Reset ALL contact attempts?")) return;
    try {
      const headers = await authHeaders();
      const res = await fetch(`${API_BASE}/api/admin/contact-attempts`, { method: "DELETE", headers });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      setRows([]);
      toast.success("All attempts cleared");
    } catch (e) {
      toast.error("Failed to reset all", { description: (e as Error).message ?? "Please try again." });
    }
  }

  const fmt = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Contact Requests</h2>
        <p className="text-muted-foreground">License inquiries submitted from the activation page.</p>
      </div>

      {/* Limit control */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4 text-primary" />
            Global Attempt Limit
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="icon"
              disabled={saving || limit <= 1}
              onClick={() => { const n = limit - 1; setLimitInput(String(n)); void saveLimit(n); }}
            >
              <Minus className="h-4 w-4" />
            </Button>
            <Input
              type="number"
              min={1}
              value={limitInput}
              onChange={(e) => setLimitInput(e.target.value)}
              onBlur={() => {
                const n = parseInt(limitInput, 10);
                if (!isNaN(n) && n >= 1 && n !== limit) void saveLimit(n);
                else setLimitInput(String(limit));
              }}
              className="w-20 text-center font-mono text-lg font-bold"
            />
            <Button
              variant="outline"
              size="icon"
              disabled={saving}
              onClick={() => { const n = limit + 1; setLimitInput(String(n)); void saveLimit(n); }}
            >
              <Plus className="h-4 w-4" />
            </Button>
            <span className="text-sm text-muted-foreground">attempts per IP</span>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Each IP can submit the contact form this many times. Change takes effect immediately for new attempts.
          </p>
        </CardContent>
      </Card>

      {/* Attempts table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Phone className="h-4 w-4 text-primary" />
            Attempt Log
            <Badge variant="secondary" className="ml-1">{rows.length}</Badge>
          </CardTitle>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={fetchData} disabled={loading}>
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} /> Refresh
            </Button>
            {rows.length > 0 && (
              <Button variant="destructive" size="sm" onClick={resetAll}>
                <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Reset All
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center p-8">
              <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : rows.length === 0 ? (
            <div className="text-center text-muted-foreground p-8 text-sm">No contact requests yet.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>IP Address</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead className="text-center">Attempts</TableHead>
                  <TableHead>Last Seen</TableHead>
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...rows].reverse().map((row) => (
                  <TableRow key={row.ip}>
                    <TableCell className="font-mono text-xs">{row.ip}</TableCell>
                    <TableCell className="text-sm">{row.lastEmail ?? <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="font-mono text-sm">{row.lastPhone ?? <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="text-center">
                      <Badge variant={row.attempts >= limit ? "destructive" : "secondary"}>
                        {row.attempts} / {limit}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{fmt(row.lastAt)}</TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                        onClick={() => void resetIp(row.ip)}
                      >
                        <Trash2 className="h-3 w-3 mr-1" /> Reset
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
