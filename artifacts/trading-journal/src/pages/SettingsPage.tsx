import { AppLayout } from "@/components/AppLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useGetTelegramSettings, getGetTelegramSettingsQueryKey, useUpdateTelegramSettings, useTestTelegramConnection, useGetAccountSettings, getGetAccountSettingsQueryKey, useUpdateAccountSettings, customFetch, getGetDailyDashboardQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { ShieldAlert, Bell, Wallet, Lock, Eye, EyeOff, MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { SupportChat } from "@/components/SupportChat";
import { ActiveOfferPopup } from "@/components/ActiveOfferPopup";
import { useUser } from "@clerk/react";

const accountSchema = z.object({
  timezone: z.string().min(1),
  defaultRiskPct: z.coerce.number().min(0.1).max(100),
  dailyTargetPct: z.coerce.number().min(0.1).max(100),
  nickname: z.string().max(30).optional(),
});

const telegramSchema = z.object({
  botToken: z.string().optional(),
  chatId: z.string().optional(),
  groupId: z.string().optional(),
  dailyEnabled: z.boolean(),
  weeklyEnabled: z.boolean(),
  monthlyEnabled: z.boolean(),
  riskAlertEnabled: z.boolean(),
  winThresholdPct: z.coerce.number(),
  lossThresholdPct: z.coerce.number(),
});

const passwordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z.string().min(8, "Password must be at least 8 characters"),
  confirmPassword: z.string().min(1, "Please confirm your new password"),
}).refine((d) => d.newPassword === d.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});

function PasswordTab() {
  const { user } = useUser();
  const { toast } = useToast();
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);

  const form = useForm<z.infer<typeof passwordSchema>>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" },
  });

  const onSubmit = async (values: z.infer<typeof passwordSchema>) => {
    if (!user) return;
    setLoading(true);
    try {
      await user.updatePassword({
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
      form.reset();
      toast({ title: "Password Updated", description: "Your password has been changed successfully.", className: "bg-green-500/10 text-green-500 border-green-500/20" });
    } catch (err: any) {
      const msg = err?.errors?.[0]?.longMessage ?? err?.message ?? "Failed to update password. Check your current password.";
      toast({ title: "Update Failed", description: msg, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="border border-border rounded-lg bg-card p-6 space-y-6">
      <div className="flex items-start gap-4 p-4 bg-secondary/50 border border-primary/20 rounded">
        <Lock className="w-6 h-6 text-primary shrink-0 mt-0.5" />
        <div className="text-sm text-slate-300">
          <strong className="text-primary block mb-1">Change Password</strong>
          Use a strong password with at least 8 characters. You will stay logged in after changing your password.
        </div>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5 max-w-md">
          <FormField control={form.control} name="currentPassword" render={({ field }) => (
            <FormItem>
              <FormLabel className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Current Password</FormLabel>
              <FormControl>
                <div className="relative">
                  <Input
                    type={showCurrent ? "text" : "password"}
                    placeholder="Enter current password"
                    className="font-mono bg-input pr-10"
                    {...field}
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrent((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-primary"
                  >
                    {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </FormControl>
              <FormMessage />
            </FormItem>
          )} />

          <FormField control={form.control} name="newPassword" render={({ field }) => (
            <FormItem>
              <FormLabel className="font-mono text-xs uppercase tracking-widest text-muted-foreground">New Password</FormLabel>
              <FormControl>
                <div className="relative">
                  <Input
                    type={showNew ? "text" : "password"}
                    placeholder="Min 8 characters"
                    className="font-mono bg-input pr-10"
                    {...field}
                  />
                  <button
                    type="button"
                    onClick={() => setShowNew((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-primary"
                  >
                    {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </FormControl>
              <FormMessage />
            </FormItem>
          )} />

          <FormField control={form.control} name="confirmPassword" render={({ field }) => (
            <FormItem>
              <FormLabel className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Confirm New Password</FormLabel>
              <FormControl>
                <div className="relative">
                  <Input
                    type={showConfirm ? "text" : "password"}
                    placeholder="Repeat new password"
                    className="font-mono bg-input pr-10"
                    {...field}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirm((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-primary"
                  >
                    {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </FormControl>
              <FormMessage />
            </FormItem>
          )} />

          <Button
            type="submit"
            disabled={loading}
            className="bg-primary text-black hover:bg-amber-400 font-semibold"
          >
            {loading ? "Updating…" : "Update Password"}
          </Button>
        </form>
      </Form>
    </div>
  );
}

function SupportTab() {
  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex items-start gap-4 p-4 bg-secondary/50 border border-primary/20 rounded-lg">
        <MessageCircle className="w-6 h-6 text-primary shrink-0 mt-0.5" />
        <div className="text-sm text-slate-300">
          <strong className="text-primary block mb-1">Direct Support Chat</strong>
          Chat directly with admin in real-time. Messages are encrypted end-to-end.
        </div>
      </div>
      <SupportChat />
    </div>
  );
}



export default function SettingsPage() {
  const { isLoaded, isSignedIn } = useUser();
  const { data: accountSettings } = useGetAccountSettings({ query: { queryKey: getGetAccountSettingsQueryKey(), enabled: isLoaded && !!isSignedIn } });
  const { data: tgSettings } = useGetTelegramSettings({ query: { queryKey: getGetTelegramSettingsQueryKey(), enabled: isLoaded && !!isSignedIn } });
  
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const updateAccount = useUpdateAccountSettings({
    mutation: {
      onSuccess: () => {
        toast({ title: "Account Settings Saved", className: "bg-green-500/10 text-green-500 border-green-500/20" });
        queryClient.invalidateQueries({ queryKey: getGetAccountSettingsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetDailyDashboardQueryKey() });
      }
    }
  });

  const updateTelegram = useUpdateTelegramSettings({
    mutation: {
      onSuccess: () => {
        toast({ title: "Telegram Configuration Updated", className: "bg-green-500/10 text-green-500 border-green-500/20" });
        queryClient.invalidateQueries({ queryKey: getGetTelegramSettingsQueryKey() });
      }
    }
  });

  const testTelegram = useTestTelegramConnection({
    mutation: {
      onSuccess: () => {
        toast({ title: "✅ Test Message Sent!", description: "Check your Telegram — the bot should have sent you a message.", className: "bg-green-500/10 text-green-500 border-green-500/20" });
      },
      onError: (err: { message?: string } & Error) => {
        toast({ title: "❌ Test Failed", description: err?.message ?? "Could not send test message. Check your Bot Token and Chat ID.", variant: "destructive" });
      }
    }
  });

  const accountForm = useForm<z.infer<typeof accountSchema>>({
    resolver: zodResolver(accountSchema),
    defaultValues: { timezone: "UTC", defaultRiskPct: 1.0, dailyTargetPct: 2.0, nickname: "" }
  });

  const tgForm = useForm<z.infer<typeof telegramSchema>>({
    resolver: zodResolver(telegramSchema),
    defaultValues: { 
      botToken: "", chatId: "", groupId: "", 
      dailyEnabled: false, weeklyEnabled: false, monthlyEnabled: false, riskAlertEnabled: false,
      winThresholdPct: 10, lossThresholdPct: 6
    }
  });

  // Init refs
  const accInit = useRef(false);
  useEffect(() => {
    if (accountSettings && !accInit.current) {
      accountForm.reset({
        timezone: accountSettings.timezone,
        defaultRiskPct: accountSettings.defaultRiskPct || 1.0,
        dailyTargetPct: accountSettings.dailyTargetPct || 2.0,
        nickname: accountSettings.nickname ?? "",
      });
      accInit.current = true;
    }
  }, [accountSettings, accountForm]);

  const tgInit = useRef(false);
  useEffect(() => {
    if (tgSettings && !tgInit.current) {
      tgForm.reset({
        botToken: tgSettings.botToken,
        chatId: tgSettings.chatId,
        groupId: tgSettings.groupId,
        dailyEnabled: tgSettings.dailyEnabled,
        weeklyEnabled: tgSettings.weeklyEnabled,
        monthlyEnabled: tgSettings.monthlyEnabled,
        riskAlertEnabled: tgSettings.riskAlertEnabled || false,
        winThresholdPct: tgSettings.winThresholdPct || 10,
        lossThresholdPct: tgSettings.lossThresholdPct || 6,
      });
      tgInit.current = true;
    }
  }, [tgSettings, tgForm]);

  return (
    <AppLayout>
      <div className="container mx-auto p-4 lg:p-8 max-w-4xl flex-1 flex flex-col">
        <h1 className="text-2xl font-bold text-white tracking-tight mb-8">System Configuration</h1>

        <Tabs defaultValue="account" className="flex-1">
          <TabsList className="bg-card border border-border flex-wrap h-auto gap-1">
            <TabsTrigger value="account" className="data-[state=active]:bg-secondary font-mono text-xs uppercase tracking-widest"><Wallet className="w-4 h-4 mr-2" /> Account parameters</TabsTrigger>
            <TabsTrigger value="telegram" className="data-[state=active]:bg-secondary font-mono text-xs uppercase tracking-widest"><Bell className="w-4 h-4 mr-2" /> Telegram</TabsTrigger>
            <TabsTrigger value="security" className="data-[state=active]:bg-secondary font-mono text-xs uppercase tracking-widest"><Lock className="w-4 h-4 mr-2" /> Security</TabsTrigger>
            <TabsTrigger value="support" className="data-[state=active]:bg-secondary font-mono text-xs uppercase tracking-widest"><MessageCircle className="w-4 h-4 mr-2" /> Support</TabsTrigger>
          </TabsList>

          <TabsContent value="account" className="mt-6">
            <div className="border border-border rounded-lg bg-card p-6">
              <Form {...accountForm}>
                <form onSubmit={accountForm.handleSubmit((d) => updateAccount.mutate({ data: d }))} className="space-y-6">
                  <div className="grid md:grid-cols-2 gap-6">
                    <FormField control={accountForm.control} name="nickname" render={({ field }) => (
                      <FormItem className="col-span-2">
                        <FormLabel className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Callsign / Nickname</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="e.g. GoldHawk, TradeKing… (shown in header)"
                            maxLength={30}
                            className="font-mono bg-input"
                            {...field}
                          />
                        </FormControl>
                        <p className="text-[11px] text-muted-foreground/60 font-mono">Displayed next to your balance in the terminal header. Max 30 chars.</p>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={accountForm.control} name="defaultRiskPct" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Default Risk %</FormLabel>
                        <FormControl><Input type="number" step="0.1" className="font-mono bg-input" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={accountForm.control} name="dailyTargetPct" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Daily Target %</FormLabel>
                        <FormControl><Input type="number" step="0.1" className="font-mono bg-input" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={accountForm.control} name="timezone" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="font-mono text-xs uppercase tracking-widest text-muted-foreground">System Timezone</FormLabel>
                        <FormControl><Input className="font-mono bg-input" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                  <Button type="submit" disabled={updateAccount.isPending} className="bg-primary text-black hover:bg-amber-400 font-semibold">
                    Save Parameters
                  </Button>
                </form>
              </Form>
            </div>
          </TabsContent>

          <TabsContent value="telegram" className="mt-6">
            <div className="border border-border rounded-lg bg-card p-6">
              <div className="flex items-start gap-4 p-4 bg-secondary/50 border border-primary/20 rounded mb-8">
                <ShieldAlert className="w-6 h-6 text-primary shrink-0 mt-0.5" />
                <div className="text-sm text-slate-300">
                  <strong className="text-primary block mb-1">Secure Credential Storage</strong>
                  Bot tokens and Chat IDs are encrypted at rest. The application backend bridges messages securely. Do not share your bot token with anyone.
                </div>
              </div>

              <Form {...tgForm}>
                <form onSubmit={tgForm.handleSubmit((d) => updateTelegram.mutate({ data: d }))} className="space-y-8">
                  
                  <div className="space-y-4 border-b border-border pb-8">
                    <h3 className="font-semibold text-white">Bot Credentials</h3>
                    <div className="grid md:grid-cols-2 gap-6">
                      <FormField control={tgForm.control} name="botToken" render={({ field }) => (
                        <FormItem className="col-span-2">
                          <FormLabel className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Bot API Token</FormLabel>
                          <FormControl><Input type="password" placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11" className="font-mono bg-input" {...field} /></FormControl>
                        </FormItem>
                      )} />
                      <FormField control={tgForm.control} name="chatId" render={({ field }) => (
                        <FormItem>
                          <FormLabel className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Personal Chat ID</FormLabel>
                          <FormControl><Input placeholder="123456789" className="font-mono bg-input" {...field} /></FormControl>
                        </FormItem>
                      )} />
                      <FormField control={tgForm.control} name="groupId" render={({ field }) => (
                        <FormItem>
                          <FormLabel className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Investor Group ID</FormLabel>
                          <FormControl><Input placeholder="-100123456789" className="font-mono bg-input" {...field} /></FormControl>
                        </FormItem>
                      )} />
                    </div>
                  </div>

                  <div className="space-y-4">
                    <h3 className="font-semibold text-white">Event Triggers</h3>
                    
                    <div className="grid md:grid-cols-2 gap-6">
                      <FormField control={tgForm.control} name="dailyEnabled" render={({ field }) => (
                        <FormItem className="flex flex-row items-center justify-between rounded-lg border border-border p-4">
                          <div className="space-y-0.5">
                            <FormLabel className="text-base text-white">Daily Recap</FormLabel>
                            <p className="text-sm text-muted-foreground">End of day PnL summary.</p>
                          </div>
                          <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                        </FormItem>
                      )} />
                      
                      <FormField control={tgForm.control} name="weeklyEnabled" render={({ field }) => (
                        <FormItem className="flex flex-row items-center justify-between rounded-lg border border-border p-4">
                          <div className="space-y-0.5">
                            <FormLabel className="text-base text-white">Weekly Report</FormLabel>
                            <p className="text-sm text-muted-foreground">End of week aggregate stats.</p>
                          </div>
                          <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                        </FormItem>
                      )} />

                      <FormField control={tgForm.control} name="monthlyEnabled" render={({ field }) => (
                        <FormItem className="flex flex-row items-center justify-between rounded-lg border border-border p-4">
                          <div className="space-y-0.5">
                            <FormLabel className="text-base text-white">Monthly Report</FormLabel>
                            <p className="text-sm text-muted-foreground">Investor-ready monthly statement.</p>
                          </div>
                          <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                        </FormItem>
                      )} />

                      <FormField control={tgForm.control} name="riskAlertEnabled" render={({ field }) => (
                        <FormItem className="flex flex-row items-center justify-between rounded-lg border border-border p-4">
                          <div className="space-y-0.5">
                            <FormLabel className="text-base text-white">Risk/Drawdown Alerts</FormLabel>
                            <p className="text-sm text-muted-foreground">Threshold breached notifications.</p>
                          </div>
                          <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                        </FormItem>
                      )} />
                    </div>

                    <div className="grid md:grid-cols-2 gap-6 pt-4">
                      <FormField control={tgForm.control} name="winThresholdPct" render={({ field }) => (
                        <FormItem>
                          <FormLabel className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Win Alert Threshold (%)</FormLabel>
                          <FormControl><Input type="number" className="font-mono bg-input" {...field} /></FormControl>
                        </FormItem>
                      )} />
                      <FormField control={tgForm.control} name="lossThresholdPct" render={({ field }) => (
                        <FormItem>
                          <FormLabel className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Drawdown Alert Threshold (%)</FormLabel>
                          <FormControl><Input type="number" className="font-mono bg-input" {...field} /></FormControl>
                        </FormItem>
                      )} />
                    </div>
                  </div>

                  <div className="flex gap-3 flex-wrap">
                    <Button type="submit" disabled={updateTelegram.isPending} className="bg-primary text-black hover:bg-amber-400 font-semibold">
                      Deploy Bridge Rules
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={testTelegram.isPending}
                      onClick={() => testTelegram.mutate()}
                      className="border-primary/40 text-primary hover:bg-primary/10 font-semibold"
                    >
                      {testTelegram.isPending ? "Sending…" : "Test Connection"}
                    </Button>
                  </div>
                </form>
              </Form>
            </div>
          </TabsContent>

          <TabsContent value="security" className="mt-6">
            <PasswordTab />
          </TabsContent>

          <TabsContent value="support" className="mt-6">
            <SupportTab />
          </TabsContent>
        </Tabs>
      </div>
      <ActiveOfferPopup />
    </AppLayout>
  );
}
