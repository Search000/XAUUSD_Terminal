import { AppLayout } from "@/components/AppLayout";
import { useUser } from "@clerk/react";
import { useListInvestors, getListInvestorsQueryKey, useGetInvestorShares, getGetInvestorSharesQueryKey, useCreateInvestor, useUpdateInvestor, useDeleteInvestor, Investor } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Plus, Pencil, Trash2, Users as UsersIcon, PieChart, Wallet, FileDown, Loader2 } from "lucide-react";
import { TableLoader } from "@/components/PageLoader";
import { useToast } from "@/hooks/use-toast";
import { generateInvestorPDF, type SharesData } from "@/lib/investorPdf";

const investorSchema = z.object({
  name: z.string().min(1, "Name is required"),
  investmentAmount: z.coerce.number().min(1, "Amount must be > 0"),
});

function fmt(n: number, prefix = "$"): string {
  return `${prefix}${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function InvestorsPage() {
  const { isLoaded, isSignedIn } = useUser();
  const { data: investors, isLoading: investorsLoading } = useListInvestors({ query: { queryKey: getListInvestorsQueryKey(), enabled: isLoaded && !!isSignedIn } });
  const { data: shares, isLoading: sharesLoading } = useGetInvestorShares({ query: { queryKey: getGetInvestorSharesQueryKey(), enabled: isLoaded && !!isSignedIn } });

  const [editingInvestor, setEditingInvestor] = useState<Investor | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<number | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const pdfMonth = new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" });

  const createInvestor = useCreateInvestor({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListInvestorsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetInvestorSharesQueryKey() });
        setIsDialogOpen(false);
      }
    }
  });

  const updateInvestor = useUpdateInvestor({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListInvestorsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetInvestorSharesQueryKey() });
        setIsDialogOpen(false);
        setEditingInvestor(null);
      }
    }
  });

  const deleteInvestor = useDeleteInvestor({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListInvestorsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetInvestorSharesQueryKey() });
        setConfirmingDeleteId(null);
      }
    }
  });

  const form = useForm<z.infer<typeof investorSchema>>({
    resolver: zodResolver(investorSchema),
    defaultValues: { name: "", investmentAmount: 1000 }
  });

  const onSubmit = (values: z.infer<typeof investorSchema>) => {
    if (editingInvestor) {
      updateInvestor.mutate({ id: editingInvestor.id, data: values });
    } else {
      createInvestor.mutate({ data: values });
    }
  };

  const openNewInvestor = () => {
    setEditingInvestor(null);
    form.reset({ name: "", investmentAmount: 1000 });
    setIsDialogOpen(true);
  };

  const openEditInvestor = (inv: Investor) => {
    setEditingInvestor(inv);
    form.reset({ name: inv.name, investmentAmount: inv.investmentAmount });
    setIsDialogOpen(true);
  };

  const handleDownloadPDF = () => {
    setPdfLoading(true);
    try {
      generateInvestorPDF(shares as SharesData | undefined, pdfMonth);
    } catch {
      toast({
        title: "PDF Failed",
        description: "Could not generate the PDF. Please try again.",
        variant: "destructive",
      });
    } finally {
      setPdfLoading(false);
    }
  };

  return (
    <AppLayout>
      <div className="container mx-auto p-4 lg:p-8 flex-1 flex flex-col gap-8">

        <div className="flex items-center justify-between flex-wrap gap-3">
          <h1 className="text-2xl font-bold text-white tracking-tight">Investor Management</h1>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={handleDownloadPDF}
              disabled={!shares?.investors?.length || pdfLoading}
              className="border-border text-slate-300 gap-2"
            >
              {pdfLoading
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating…</>
                : <><FileDown className="w-4 h-4" /> Download PDF</>
              }
            </Button>
            <Button onClick={openNewInvestor} className="bg-primary text-black hover:bg-amber-400 font-semibold gap-2">
              <Plus className="w-4 h-4" /> Add Investor
            </Button>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-6">
          <div className="border border-border rounded-lg bg-card p-6 relative overflow-hidden">
            <div className="absolute top-0 right-0 p-4 opacity-10"><UsersIcon className="w-24 h-24" /></div>
            <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground mb-4">Total Capital Invested</div>
            <div className="text-3xl font-mono font-bold text-white">
              ${shares?.totalInvestment?.toLocaleString(undefined, { minimumFractionDigits: 2 }) || "0.00"}
            </div>
          </div>
          <div className="border border-border rounded-lg bg-card p-6 relative overflow-hidden">
            <div className="absolute top-0 right-0 p-4 opacity-10"><PieChart className="w-24 h-24" /></div>
            <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground mb-4">Total PnL Generated</div>
            <div className={`text-3xl font-mono font-bold ${(shares?.totalPnL || 0) >= 0 ? "text-green-500" : "text-red-500"}`}>
              {(shares?.totalPnL || 0) >= 0 ? '+' : ''}${(shares?.totalPnL || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </div>
          </div>
          <div className="border border-border rounded-lg bg-card p-6 relative overflow-hidden">
            <div className="absolute top-0 right-0 p-4 opacity-10"><Wallet className="w-24 h-24" /></div>
            <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground mb-4">Live Balance</div>
            <div className="text-3xl font-mono font-bold text-amber-400">
              ${shares?.currentBalance?.toLocaleString(undefined, { minimumFractionDigits: 2 }) || "0.00"}
            </div>
          </div>
          <div className="border border-border rounded-lg bg-card p-6 bg-secondary/30">
            <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground mb-4">Active Backers</div>
            <div className="text-3xl font-mono font-bold text-primary">
              {investors?.length || 0}
            </div>
          </div>
        </div>

        {/* Investors Table */}
        <div className="border border-border rounded-lg bg-card overflow-hidden flex-1">
          <Table>
            <TableHeader className="bg-secondary/50">
              <TableRow>
                <TableHead className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Investor</TableHead>
                <TableHead className="font-mono text-xs uppercase tracking-widest text-muted-foreground text-right">Investment</TableHead>
                <TableHead className="font-mono text-xs uppercase tracking-widest text-muted-foreground text-right">Share %</TableHead>
                <TableHead className="font-mono text-xs uppercase tracking-widest text-muted-foreground text-right">PnL Share</TableHead>
                <TableHead className="font-mono text-xs uppercase tracking-widest text-muted-foreground text-right">Current Value</TableHead>
                <TableHead className="font-mono text-xs uppercase tracking-widest text-muted-foreground text-right">Growth</TableHead>
                <TableHead className="w-16"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {investorsLoading || sharesLoading ? <TableLoader colSpan={7} /> : shares?.investors?.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="h-32 text-center text-muted-foreground">No investors added yet.</TableCell></TableRow>
              ) : (
                shares?.investors?.map((inv) => (
                  <TableRow key={inv.id} className="group hover:bg-secondary/20">
                    <TableCell className="font-medium text-slate-200">{inv.name}</TableCell>
                    <TableCell className="font-mono text-sm text-slate-300 text-right">${inv.investmentAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</TableCell>
                    <TableCell className="font-mono text-sm text-primary text-right">{(inv.sharePct || 0).toFixed(2)}%</TableCell>
                    <TableCell className={`font-mono text-sm font-medium text-right ${(inv.pnlShare || 0) >= 0 ? "text-green-500" : "text-red-500"}`}>
                      {(inv.pnlShare || 0) >= 0 ? '+' : ''}${(inv.pnlShare || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className="font-mono text-sm font-bold text-slate-200 text-right">${(inv.totalBalance || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</TableCell>
                    <TableCell className={`font-mono text-sm font-medium text-right ${(inv.growthPct || 0) >= 0 ? "text-green-500" : "text-red-500"}`}>
                      {(inv.growthPct || 0) >= 0 ? '+' : ''}{(inv.growthPct || 0).toFixed(2)}%
                    </TableCell>
                    <TableCell className="text-right">
                      {confirmingDeleteId === inv.id ? (
                        <div className="flex items-center justify-end gap-2">
                          <span className="text-xs text-red-500 whitespace-nowrap">Delete?</span>
                          <Button variant="destructive" size="sm" className="h-8 px-2"
                            onClick={() => deleteInvestor.mutate({ id: inv.id })}
                            disabled={deleteInvestor.isPending}>
                            {deleteInvestor.isPending ? "Deleting…" : "Confirm"}
                          </Button>
                          <Button variant="ghost" size="sm" className="h-8 px-2"
                            onClick={() => setConfirmingDeleteId(null)}
                            disabled={deleteInvestor.isPending}>
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => openEditInvestor(investors?.find(i => i.id === inv.id) as Investor)} className="text-muted-foreground hover:text-white transition-colors">
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setConfirmingDeleteId(currentId => currentId === inv.id ? null : inv.id)}
                            className="text-muted-foreground hover:text-red-500 transition-colors"
                            aria-label={`Delete investor ${inv.name}`}>
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-[425px] border-border bg-card">
          <DialogHeader>
            <DialogTitle className="text-white font-mono tracking-tight uppercase">
              {editingInvestor ? 'Edit Investor' : 'Add Investor'}
            </DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem>
                  <FormLabel className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Investor Name</FormLabel>
                  <FormControl><Input className="bg-input" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="investmentAmount" render={({ field }) => (
                <FormItem>
                  <FormLabel className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Capital Input ($)</FormLabel>
                  <FormControl><Input type="number" step="0.01" className="font-mono bg-input" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <DialogFooter className="mt-6 pt-4 border-t border-border">
                <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)} className="border-border text-slate-300">
                  Cancel
                </Button>
                <Button type="submit" disabled={createInvestor.isPending || updateInvestor.isPending} className="bg-primary text-black hover:bg-amber-400 font-semibold">
                  {editingInvestor ? 'Save Changes' : 'Add Investor'}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
