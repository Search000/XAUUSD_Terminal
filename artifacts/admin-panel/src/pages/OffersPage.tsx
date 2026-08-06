import * as React from "react";
import { useState, useCallback } from "react";
import { useAuth } from "@clerk/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, Trash2, Tag } from "lucide-react";
import { cn } from "@/lib/utils";

interface Offer {
  id: number;
  title: string;
  description: string;
  isOn: boolean;
  discountPct: string | null;
  price: string | null;
  validity: string | null;
  createdAt: string;
  updatedAt: string;
}

const OFFERS_KEY = ["admin-offers"];

function useApiUrl() {
  return (import.meta.env.VITE_API_URL as string) ?? "";
}

function useAuthFetch() {
  const { getToken } = useAuth();
  const apiUrl = useApiUrl();

  return useCallback(async (path: string, opts: RequestInit = {}) => {
    const token = await getToken();
    const res = await fetch(`${apiUrl}${path}`, {
      ...opts,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(opts.headers ?? {}),
      },
    });
    if (res.status === 204) return null;
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error ?? "Request failed");
    return data;
  }, [getToken, apiUrl]);
}

const emptyForm = { title: "", description: "", discountPct: "", price: "", validity: "" };

export function OffersPage() {
  const qc = useQueryClient();
  const authFetch = useAuthFetch();

  const { data: offers = [], isLoading } = useQuery<Offer[]>({
    queryKey: OFFERS_KEY,
    queryFn: () => authFetch("/api/admin/offers"),
  });

  const createMutation = useMutation({
    mutationFn: (data: typeof emptyForm) => authFetch("/api/admin/offers", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: OFFERS_KEY }); setShowForm(false); setForm(emptyForm); },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: typeof emptyForm }) =>
      authFetch(`/api/admin/offers/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: OFFERS_KEY }); setShowForm(false); setEditingId(null); setForm(emptyForm); },
  });

  const toggleMutation = useMutation({
    mutationFn: (id: number) => authFetch(`/api/admin/offers/${id}/toggle`, { method: "PATCH" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: OFFERS_KEY }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => authFetch(`/api/admin/offers/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: OFFERS_KEY });
      setConfirmingDeleteId(null);
    },
  });

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<number | null>(null);
  const [form, setForm] = useState(emptyForm);

  const openNew = () => { setEditingId(null); setForm(emptyForm); setShowForm(true); };
  const openEdit = (o: Offer) => {
    setEditingId(o.id);
    setForm({ title: o.title, description: o.description, discountPct: o.discountPct ?? "", price: o.price ?? "", validity: o.validity ?? "" });
    setShowForm(true);
  };
  const cancelForm = () => { setShowForm(false); setEditingId(null); setForm(emptyForm); };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    if (editingId !== null) {
      updateMutation.mutate({ id: editingId, data: form });
    } else {
      createMutation.mutate(form);
    }
  };

  const handleDelete = (o: Offer) => {
    setConfirmingDeleteId(currentId => currentId === o.id ? null : o.id);
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Offers Management</h2>
          <p className="text-muted-foreground">Create and manage promotional offers shown to users.</p>
        </div>
        <Button onClick={openNew} className="gap-2">
          <Plus className="h-4 w-4" /> New Offer
        </Button>
      </div>

      {/* ── Add / Edit Form ── */}
      {showForm && (
        <Card className="border-primary/20 bg-primary/5">
          <CardHeader>
            <CardTitle className="text-primary text-xl">
              {editingId !== null ? "Edit Offer" : "Create New Offer"}
            </CardTitle>
            <CardDescription>
              {editingId !== null ? "Update the offer details below." : "Fill in the details to create a new promotional offer."}
            </CardDescription>
          </CardHeader>
          <form onSubmit={handleSubmit}>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="offer-title">Title *</Label>
                  <Input
                    id="offer-title"
                    value={form.title}
                    onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                    placeholder="e.g. Launch Week Special"
                    required
                    className="bg-background"
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="offer-desc">Description</Label>
                  <Input
                    id="offer-desc"
                    value={form.description}
                    onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                    placeholder="e.g. Get 20% off your first license renewal"
                    className="bg-background"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="offer-discount">Discount %</Label>
                  <Input
                    id="offer-discount"
                    value={form.discountPct}
                    onChange={e => setForm(f => ({ ...f, discountPct: e.target.value }))}
                    placeholder="e.g. 20"
                    className="bg-background font-mono"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="offer-price">Price ($)</Label>
                  <Input
                    id="offer-price"
                    value={form.price}
                    onChange={e => setForm(f => ({ ...f, price: e.target.value }))}
                    placeholder="e.g. 39.99"
                    className="bg-background font-mono"
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="offer-validity">Validity (days)</Label>
                  <Input
                    id="offer-validity"
                    type="number"
                    min="1"
                    value={form.validity}
                    onChange={e => setForm(f => ({ ...f, validity: e.target.value }))}
                    placeholder="e.g. 30"
                    className="bg-background font-mono"
                  />
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <Button type="submit" disabled={isSaving}>
                  {isSaving ? "Saving…" : editingId !== null ? "Save Changes" : "Create Offer"}
                </Button>
                <Button type="button" variant="outline" onClick={cancelForm}>
                  Cancel
                </Button>
              </div>
            </CardContent>
          </form>
        </Card>
      )}

      {/* ── Offers Table ── */}
      <Card>
        <CardHeader>
          <CardTitle>All Offers</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-center">Discount</TableHead>
                <TableHead className="text-center">Price</TableHead>
                <TableHead>Validity (days)</TableHead>
                <TableHead className="text-center">Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={7} className="h-32 text-center">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <Tag className="w-5 h-5 text-primary animate-pulse" />
                      <span className="text-xs font-mono text-muted-foreground uppercase tracking-widest">Loading Offers…</span>
                    </div>
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && offers.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground p-8">
                    No offers yet. Click "New Offer" to create one.
                  </TableCell>
                </TableRow>
              )}
              {offers.map((o) => (
                <TableRow key={o.id} className={cn(o.isOn && "bg-green-500/5")}>
                  <TableCell className="font-medium">{o.title}</TableCell>
                  <TableCell className="text-muted-foreground text-sm max-w-xs truncate">{o.description || "—"}</TableCell>
                  <TableCell className="text-center font-mono">
                    {o.discountPct ? <span className="text-primary font-bold">{o.discountPct}%</span> : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-center font-mono">
                    {o.price ? <span>${o.price}</span> : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-sm">{o.validity ? `${o.validity} ${o.validity === "1" ? "day" : "days"}` : "—"}</TableCell>
                  <TableCell className="text-center">
                    <button
                      onClick={() => toggleMutation.mutate(o.id)}
                      disabled={toggleMutation.isPending}
                      className={cn(
                        "relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none",
                        o.isOn ? "bg-green-500" : "bg-muted"
                      )}
                      aria-label={o.isOn ? "Turn off" : "Turn on"}
                    >
                      <span className={cn(
                        "inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform",
                        o.isOn ? "translate-x-6" : "translate-x-1"
                      )} />
                    </button>
                  </TableCell>
                  <TableCell className="text-right">
                      {confirmingDeleteId === o.id ? (
                        <div className="flex items-center justify-end gap-2">
                          <span className="text-xs text-destructive whitespace-nowrap">Delete?</span>
                          <Button
                            variant="destructive"
                            size="sm"
                            className="h-8 px-2"
                            onClick={() => deleteMutation.mutate(o.id)}
                            disabled={deleteMutation.isPending}
                          >
                            {deleteMutation.isPending ? "Deleting…" : "Confirm"}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 px-2"
                            onClick={() => setConfirmingDeleteId(null)}
                            disabled={deleteMutation.isPending}
                          >
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => openEdit(o)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                            onClick={() => handleDelete(o)}
                            disabled={deleteMutation.isPending}
                            aria-label={`Delete offer ${o.title}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
