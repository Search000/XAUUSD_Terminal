import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";

// ─── Types ───────────────────────────────────────────────────────────────────

type SystemSettings = {
  licenseEnforcementEnabled: boolean;
  trialModeEnabled: boolean;
  trialDurationDays: number;
};

type TelegramSettings = {
  botToken: string;
  chatId: string;
};

// ─── API helpers ─────────────────────────────────────────────────────────────

async function getSystemSettings(): Promise<SystemSettings> {
  return customFetch<SystemSettings>("/api/admin/system-settings");
}

async function updateSystemSettings(payload: Partial<SystemSettings>): Promise<SystemSettings> {
  return customFetch<SystemSettings>("/api/admin/system-settings", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

async function getTelegramSettings(): Promise<TelegramSettings> {
  return customFetch<TelegramSettings>("/api/settings/telegram");
}

async function saveTelegramSettings(payload: TelegramSettings): Promise<TelegramSettings> {
  return customFetch<TelegramSettings>("/api/settings/telegram", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

async function testTelegramConnection(): Promise<{ success: boolean }> {
  return customFetch<{ success: boolean }>("/api/settings/telegram/test", { method: "POST" });
}

// ─── ToggleRow ────────────────────────────────────────────────────────────────

function ToggleRow({
  title,
  description,
  checked,
  onToggle,
  disabled,
  checkedColor = "bg-primary border-primary",
  badge,
  warning,
  children,
}: {
  title: string;
  description: string;
  checked: boolean;
  onToggle: () => void;
  disabled: boolean;
  checkedColor?: string;
  badge?: { text: string; active: string; inactive: string };
  warning?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="border border-border rounded-lg bg-card p-6 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-semibold text-base">{title}</h2>
          <p
            className="text-sm text-muted-foreground mt-1"
            dangerouslySetInnerHTML={{ __html: description }}
          />
        </div>
        <button
          disabled={disabled}
          onClick={onToggle}
          aria-label={`Toggle ${title}`}
          className={`relative inline-flex h-7 w-14 flex-shrink-0 cursor-pointer rounded-full border-2 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background disabled:opacity-50 ${
            checked ? checkedColor : "bg-muted border-muted"
          }`}
        >
          <span
            className={`pointer-events-none inline-block h-5 w-5 mt-[1px] rounded-full bg-white shadow ring-0 transition-transform duration-200 ${
              checked ? "translate-x-7" : "translate-x-0"
            }`}
          />
        </button>
      </div>

      {badge && (
        <div className="flex items-center gap-2 pt-2">
          <span
            className={`inline-flex items-center gap-1.5 text-xs font-mono px-2.5 py-1 rounded-full border ${
              checked ? badge.active : badge.inactive
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                checked ? "bg-green-400" : "bg-amber-400"
              }`}
            />
            {disabled ? "Loading…" : checked ? badge.text.split("|")[0] : badge.text.split("|")[1]}
          </span>
        </div>
      )}

      {warning && !disabled && !checked && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
          {warning}
        </div>
      )}

      {children}
    </div>
  );
}

// ─── TelegramSection ──────────────────────────────────────────────────────────

function TelegramSection() {
  const qc = useQueryClient();
  const [botToken, setBotToken] = useState("");
  const [chatId, setChatId] = useState("");
  const [tgToast, setTgToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [testing, setTesting] = useState(false);

  const showTgToast = (msg: string, ok: boolean) => {
    setTgToast({ msg, ok });
    setTimeout(() => setTgToast(null), 3500);
  };

  const { data: tgData, isLoading: tgLoading } = useQuery({
    queryKey: ["admin", "telegram-settings"],
    queryFn: getTelegramSettings,
  });

  useEffect(() => {
    if (tgData) {
      setBotToken(tgData.botToken ?? "");
      setChatId(tgData.chatId ?? "");
    }
  }, [tgData]);

  const saveMutation = useMutation({
    mutationFn: saveTelegramSettings,
    onSuccess: (updated) => {
      qc.setQueryData(["admin", "telegram-settings"], updated);
      showTgToast("Telegram settings saved.", true);
    },
    onError: () => showTgToast("Save failed. Check token format.", false),
  });

  const handleSave = () => {
    if (!botToken.trim() || !chatId.trim()) {
      showTgToast("Bot Token and Chat ID are required.", false);
      return;
    }
    saveMutation.mutate({ botToken: botToken.trim(), chatId: chatId.trim() });
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      await testTelegramConnection();
      showTgToast("Test message sent! Check your Telegram.", true);
    } catch (e: unknown) {
      const msg = (e as { message?: string })?.message ?? "Test failed.";
      showTgToast(msg, false);
    } finally {
      setTesting(false);
    }
  };

  const isConfigured = !!(tgData?.botToken && tgData?.chatId);
  const isSaving = saveMutation.isPending;
  const disabled = tgLoading || isSaving;

  return (
    <div className="border border-border rounded-lg bg-card p-6 space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-semibold text-base">Telegram Notifications</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Customer messages (license requests, contact, feedback) will be sent to your Telegram.
            Always uses the admin account only.
          </p>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 text-xs font-mono px-2.5 py-1 rounded-full border flex-shrink-0 ${
            isConfigured
              ? "border-green-500/30 bg-green-500/10 text-green-400"
              : "border-amber-500/30 bg-amber-500/10 text-amber-400"
          }`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${isConfigured ? "bg-green-400" : "bg-amber-400"}`} />
          {tgLoading ? "Loading…" : isConfigured ? "CONNECTED" : "NOT SET"}
        </span>
      </div>

      {/* Fields */}
      <div className="space-y-4">
        {/* Bot Token */}
        <div className="space-y-1.5">
          <label className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
            Bot Token
          </label>
          <input
            type="password"
            value={botToken}
            onChange={(e) => setBotToken(e.target.value)}
            disabled={disabled}
            placeholder="1234567890:AAGzSIEPVuSjyz1j_36ER40BLpR71nJXUl"
            className="w-full px-3 py-2.5 bg-secondary/60 border border-border rounded-lg text-sm font-mono focus:outline-none focus:border-primary/60 transition-colors disabled:opacity-50 placeholder:text-muted-foreground/40"
          />
          <p className="text-xs text-muted-foreground">
            Get this from <span className="text-primary font-mono">@BotFather</span> on Telegram.
          </p>
        </div>

        {/* Chat ID */}
        <div className="space-y-1.5">
          <label className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
            Your Chat ID
          </label>
          <input
            type="text"
            value={chatId}
            onChange={(e) => setChatId(e.target.value)}
            disabled={disabled}
            placeholder="123456789"
            className="w-full px-3 py-2.5 bg-secondary/60 border border-border rounded-lg text-sm font-mono focus:outline-none focus:border-primary/60 transition-colors disabled:opacity-50 placeholder:text-muted-foreground/40"
          />
          <p className="text-xs text-muted-foreground">
            Find your Chat ID using <span className="text-primary font-mono">@userinfobot</span> on Telegram.
          </p>
        </div>
      </div>

      {/* What gets sent */}
      <div className="rounded-md border border-border bg-secondary/30 px-4 py-3 space-y-1.5">
        <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-2">What you will receive</p>
        {[
          { icon: "🔑", label: "License requests — email, phone, IP" },
          { icon: "📞", label: "Contact messages — phone, email" },
          { icon: "💬", label: "Feedback — rating and comment" },
        ].map(({ icon, label }) => (
          <div key={label} className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>{icon}</span>
            <span>{label}</span>
          </div>
        ))}
      </div>

      {/* Buttons */}
      <div className="flex items-center gap-3 pt-1">
        <button
          onClick={handleSave}
          disabled={disabled}
          className="px-5 py-2 bg-primary text-black text-xs font-semibold rounded-lg hover:bg-amber-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isSaving ? "Saving…" : "Save"}
        </button>
        <button
          onClick={handleTest}
          disabled={disabled || testing || !isConfigured}
          className="px-5 py-2 bg-secondary border border-border text-xs font-semibold rounded-lg hover:bg-secondary/80 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {testing ? "Sending…" : "Test Connection"}
        </button>
      </div>

      {/* Inline toast */}
      {tgToast && (
        <div
          className={`rounded-md border px-4 py-3 text-sm font-mono ${
            tgToast.ok
              ? "border-green-500/30 bg-green-500/10 text-green-300"
              : "border-red-500/30 bg-red-500/10 text-red-300"
          }`}
        >
          {tgToast.msg}
        </div>
      )}
    </div>
  );
}

// ─── SettingsPage ─────────────────────────────────────────────────────────────

export function SettingsPage() {
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [trialDaysInput, setTrialDaysInput] = useState<string>("");
  const [trialDaysDirty, setTrialDaysDirty] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "system-settings"],
    queryFn: getSystemSettings,
  });

  useEffect(() => {
    if (data && !trialDaysDirty) setTrialDaysInput(String(data.trialDurationDays ?? 7));
  }, [data, trialDaysDirty]);

  const mutation = useMutation({
    mutationFn: updateSystemSettings,
    onMutate: () => setSaving(true),
    onSuccess: (updated) => {
      qc.setQueryData(["admin", "system-settings"], updated);
      setTrialDaysInput(String(updated.trialDurationDays ?? 7));
      setTrialDaysDirty(false);
      setSaving(false);
      setToast({ msg: "Settings saved.", ok: true });
      setTimeout(() => setToast(null), 3000);
    },
    onError: () => {
      setSaving(false);
      setToast({ msg: "Save failed.", ok: false });
      setTimeout(() => setToast(null), 3000);
    },
  });

  const toggleLicenseEnforcement = () => {
    if (!data) return;
    mutation.mutate({ licenseEnforcementEnabled: !data.licenseEnforcementEnabled });
  };

  const toggleTrialMode = () => {
    if (!data) return;
    mutation.mutate({ trialModeEnabled: !data.trialModeEnabled });
  };

  const saveTrialDays = () => {
    const days = parseInt(trialDaysInput, 10);
    if (isNaN(days) || days < 1 || days > 365) {
      setToast({ msg: "Trial days must be between 1 and 365.", ok: false });
      setTimeout(() => setToast(null), 3000);
      return;
    }
    mutation.mutate({ trialDurationDays: days });
  };

  const displayDays = trialDaysDirty ? trialDaysInput : (data?.trialDurationDays ?? 7).toString();
  const disabled = isLoading || saving;

  return (
    <div className="p-6 space-y-8 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold font-mono tracking-tight">System Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">Global platform configuration.</p>
      </div>

      {/* License Enforcement */}
      <ToggleRow
        title="License Enforcement"
        description="When <strong>ON</strong>, all users must have a valid active license to access the terminal.<br />When <strong>OFF</strong>, license checks are bypassed globally — everyone can log in."
        checked={data?.licenseEnforcementEnabled ?? true}
        onToggle={toggleLicenseEnforcement}
        disabled={disabled}
        badge={{
          text: "ENFORCED — License required|OPEN — No license required",
          active: "border-green-500/30 bg-green-500/10 text-green-400",
          inactive: "border-amber-500/30 bg-amber-500/10 text-amber-400",
        }}
        warning="⚠️ License enforcement is currently OFF. Any authenticated user can access the terminal without a license. Turn this back ON when your license campaign is ready."
      />

      {/* Trial Mode */}
      <ToggleRow
        title="Free Trial Mode"
        description="When <strong>ON</strong>, any user can self-activate a free trial directly from the app — no admin approval needed. Each user can only activate one trial.<br />When <strong>OFF</strong>, trial activation is blocked for all users."
        checked={data?.trialModeEnabled ?? false}
        onToggle={toggleTrialMode}
        disabled={disabled}
        checkedColor="bg-green-600 border-green-600"
        badge={{
          text: "TRIAL ENABLED — Users can self-activate|TRIAL DISABLED — Trial blocked",
          active: "border-green-500/30 bg-green-500/10 text-green-400",
          inactive: "border-slate-500/30 bg-slate-500/10 text-slate-400",
        }}
        warning="ℹ️ Trial mode is OFF. Users will not be able to activate a free trial. Enable this when you want to offer a trial period."
      >
        <div className="pt-2 border-t border-border mt-2">
          <p className="text-xs text-muted-foreground mb-3 font-mono uppercase tracking-wider">Trial Duration</p>
          <div className="flex items-center gap-3">
            <div className="relative flex items-center">
              <input
                type="number"
                min={1}
                max={365}
                value={displayDays}
                onChange={(e) => { setTrialDaysInput(e.target.value); setTrialDaysDirty(true); }}
                disabled={disabled}
                className="w-24 px-3 py-2 bg-secondary/60 border border-border rounded-lg text-sm font-mono text-center focus:outline-none focus:border-primary/60 transition-colors disabled:opacity-50"
              />
              <span className="ml-2 text-sm text-muted-foreground">days</span>
            </div>
            <button
              onClick={saveTrialDays}
              disabled={disabled || !trialDaysDirty}
              className="px-4 py-2 bg-primary text-black text-xs font-semibold rounded-lg hover:bg-amber-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Save
            </button>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Current: <span className="text-foreground font-mono font-semibold">{data?.trialDurationDays ?? 7} days</span>. New trial activations will use this duration.
          </p>
        </div>
      </ToggleRow>

      {/* Telegram Notifications */}
      <TelegramSection />

      {saving && (
        <p className="text-xs text-muted-foreground font-mono">Saving…</p>
      )}

      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 rounded-md border px-4 py-3 text-sm font-mono shadow-lg ${
            toast.ok
              ? "border-green-500/30 bg-green-500/10 text-green-300"
              : "border-red-500/30 bg-red-500/10 text-red-300"
          }`}
        >
          {toast.msg}
        </div>
      )}
    </div>
  );
}
