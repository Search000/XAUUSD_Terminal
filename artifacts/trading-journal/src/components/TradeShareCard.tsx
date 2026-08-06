import { useRef, useState } from "react";
import { Trade } from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Check, Copy, Download, Sparkles } from "lucide-react";
import { toPng } from "html-to-image";

interface Props {
  trade: Trade;
  open: boolean;
  onClose: () => void;
}

type CardStyle = {
  id: string;
  name: string;
  background: string;
  surface: string;
  surfaceStrong: string;
  text: string;
  muted: string;
  border: string;
  divider: string;
  radius: string;
  font: string;
  headingFont: string;
  shadow: string;
  preview: string;
  label: string;
};

const CARD_STYLES: CardStyle[] = [
  {
    id: "midnight",
    name: "Midnight Terminal",
    background: "linear-gradient(145deg, #0b0f18 0%, #151b29 100%)",
    surface: "rgba(255,255,255,0.035)",
    surfaceStrong: "rgba(255,255,255,0.06)",
    text: "#f8fafc",
    muted: "#8490a4",
    border: "#64748b33",
    divider: "#94a3b833",
    radius: "16px",
    font: "'JetBrains Mono', 'Fira Code', 'Courier New', monospace",
    headingFont: "'JetBrains Mono', 'Fira Code', 'Courier New', monospace",
    shadow: "0 24px 70px rgba(4,8,18,0.55), inset 0 1px 0 rgba(255,255,255,0.06)",
    preview: "linear-gradient(135deg, #0b0f18, #25334c)",
    label: "Signature",
  },
  {
    id: "gold",
    name: "Gold Standard",
    background: "linear-gradient(145deg, #17120b 0%, #34230d 100%)",
    surface: "rgba(255,206,94,0.08)",
    surfaceStrong: "rgba(255,206,94,0.13)",
    text: "#fff8e7",
    muted: "#c7a96d",
    border: "#f6c45355",
    divider: "#f6c45355",
    radius: "12px",
    font: "'Inter', Arial, sans-serif",
    headingFont: "Georgia, serif",
    shadow: "0 24px 70px rgba(84,46,4,0.38), inset 0 1px 0 rgba(255,225,144,0.16)",
    preview: "linear-gradient(135deg, #17120b, #8a5d16)",
    label: "Premium",
  },
  {
    id: "glass",
    name: "Glass Edge",
    background: "linear-gradient(145deg, #172032 0%, #253b51 100%)",
    surface: "rgba(226,242,255,0.1)",
    surfaceStrong: "rgba(226,242,255,0.17)",
    text: "#eff8ff",
    muted: "#9db4c8",
    border: "#c9edff55",
    divider: "#c9edff55",
    radius: "24px",
    font: "'Inter', Arial, sans-serif",
    headingFont: "'Inter', Arial, sans-serif",
    shadow: "0 24px 70px rgba(4,18,32,0.42), inset 0 1px 0 rgba(255,255,255,0.24)",
    preview: "linear-gradient(135deg, #172032, #6aa4c5)",
    label: "Glass",
  },
  {
    id: "neon",
    name: "Neon Pulse",
    background: "linear-gradient(145deg, #120c22 0%, #221042 100%)",
    surface: "rgba(232,121,249,0.08)",
    surfaceStrong: "rgba(232,121,249,0.16)",
    text: "#fff5ff",
    muted: "#c9a4d6",
    border: "#e879f955",
    divider: "#e879f955",
    radius: "8px",
    font: "'JetBrains Mono', 'Fira Code', monospace",
    headingFont: "'Inter', Arial, sans-serif",
    shadow: "0 24px 70px rgba(109,40,217,0.42), 0 0 42px rgba(232,121,249,0.12)",
    preview: "linear-gradient(135deg, #120c22, #bd5fe3)",
    label: "Pulse",
  },
  {
    id: "editorial",
    name: "Market Editorial",
    background: "linear-gradient(145deg, #f5efe3 0%, #e7dcc7 100%)",
    surface: "rgba(44,36,25,0.075)",
    surfaceStrong: "rgba(44,36,25,0.12)",
    text: "#2c2419",
    muted: "#756652",
    border: "#76614755",
    divider: "#76614755",
    radius: "4px",
    font: "Georgia, serif",
    headingFont: "Georgia, serif",
    shadow: "0 24px 70px rgba(60,42,18,0.24), inset 0 1px 0 rgba(255,255,255,0.5)",
    preview: "linear-gradient(135deg, #f5efe3, #ac9471)",
    label: "Editorial",
  },
  {
    id: "ocean",
    name: "Ocean Ledger",
    background: "linear-gradient(145deg, #071c28 0%, #0c3e4a 100%)",
    surface: "rgba(45,212,191,0.08)",
    surfaceStrong: "rgba(45,212,191,0.14)",
    text: "#e6fffb",
    muted: "#82b8b4",
    border: "#2dd4bf55",
    divider: "#2dd4bf55",
    radius: "14px",
    font: "'Inter', Arial, sans-serif",
    headingFont: "'Inter', Arial, sans-serif",
    shadow: "0 24px 70px rgba(2,44,54,0.48), inset 0 1px 0 rgba(153,246,228,0.12)",
    preview: "linear-gradient(135deg, #071c28, #2a9d97)",
    label: "Ledger",
  },
  {
    id: "crimson",
    name: "Crimson Tape",
    background: "linear-gradient(145deg, #1b0d12 0%, #35131b 100%)",
    surface: "rgba(251,113,133,0.08)",
    surfaceStrong: "rgba(251,113,133,0.15)",
    text: "#fff1f2",
    muted: "#c9949d",
    border: "#fb718555",
    divider: "#fb718555",
    radius: "10px",
    font: "'JetBrains Mono', 'Fira Code', monospace",
    headingFont: "'Inter', Arial, sans-serif",
    shadow: "0 24px 70px rgba(89,20,36,0.48), inset 0 1px 0 rgba(255,228,230,0.1)",
    preview: "linear-gradient(135deg, #1b0d12, #bd465a)",
    label: "Desk",
  },
];

function fmt(v: number | null | undefined): string {
  if (v == null) return "—";
  const n = Number(v);
  return parseFloat(n.toPrecision(7)).toString();
}

function fmtDate(s: string): string {
  const [y, m, d] = s.split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d} ${months[parseInt(m, 10) - 1]} ${y}`;
}

export function TradeShareCard({ trade, open, onClose }: Props) {
  const cardRef = useRef<HTMLDivElement>(null);
  const themeLabelRef = useRef<HTMLSpanElement>(null);
  const [capturing, setCapturing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [selectedStyleId, setSelectedStyleId] = useState(CARD_STYLES[0].id);

  const selectedStyle = CARD_STYLES.find((s) => s.id === selectedStyleId) ?? CARD_STYLES[0];
  const isWin = trade.status === "TP Hit" || (trade.pnl != null && Number(trade.pnl) > 0);
  const isLoss = trade.status === "SL Hit" || (trade.pnl != null && Number(trade.pnl) < 0);
  const outcomeColor = isWin ? "#22c55e" : isLoss ? "#ef4444" : "#f59e0b";
  const pnl = trade.pnl != null ? Number(trade.pnl) : null;
  const pips = trade.pips != null ? Number(trade.pips) : null;

  async function captureDataUrl(): Promise<string | null> {
    if (!cardRef.current) return null;
    setCapturing(true);
    // Hide theme label in the captured image (it stays visible on screen)
    if (themeLabelRef.current) themeLabelRef.current.style.visibility = "hidden";
    try {
      const CARD_W = 420;
      const captureOpts = {
        pixelRatio: 2,
        width: CARD_W,
        style: {
          width: `${CARD_W}px`,
          minWidth: `${CARD_W}px`,
          maxWidth: `${CARD_W}px`,
          overflow: "hidden",
        },
      };
      // First pass warms up fonts/images, second is the clean capture
      await toPng(cardRef.current, captureOpts);
      return await toPng(cardRef.current, captureOpts);
    } catch (err) {
      console.error("capture error", err);
      return null;
    } finally {
      // Always restore theme label visibility
      if (themeLabelRef.current) themeLabelRef.current.style.visibility = "";
      setCapturing(false);
    }
  }

  async function handleDownload() {
    const dataUrl = await captureDataUrl();
    if (!dataUrl) return;
    const link = document.createElement("a");
    link.download = `xauusd-trade-${trade.id}-${selectedStyle.id}-${trade.tradeDate}.png`;
    link.href = dataUrl;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  async function handleCopyImage() {
    const dataUrl = await captureDataUrl();
    if (!dataUrl) return;
    try {
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: download if clipboard not available
      await handleDownload();
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        className="max-w-3xl w-full p-0 overflow-hidden flex flex-col border-[#1e2030]"
        style={{ maxHeight: "92vh", background: "#0a0d14" }}
      >
        {/* ── Header ── */}
        <div className="shrink-0 flex items-center justify-between px-5 py-3 border-b border-white/[0.06]">
          <div className="flex items-center gap-2">
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <DialogTitle className="text-white font-mono text-xs tracking-[0.18em] uppercase">
              Trade Share Card
            </DialogTitle>
          </div>
          <span className="text-[10px] font-mono text-amber-400/60 uppercase tracking-widest">
            {selectedStyle.name}
          </span>
        </div>

        {/* ── Body: left selectors + right preview ── */}
        <div className="flex flex-1 overflow-hidden">

          {/* Left: vertical style list */}
          <div
            className="shrink-0 w-[130px] border-r border-white/[0.06] overflow-y-auto flex flex-col gap-1.5 p-2"
            style={{ background: "#080b11" }}
          >
            {CARD_STYLES.map((style) => {
              const isSelected = style.id === selectedStyleId;
              return (
                <button
                  key={style.id}
                  type="button"
                  onClick={() => setSelectedStyleId(style.id)}
                  className="relative rounded-lg overflow-hidden transition-all duration-200 text-left w-full"
                  style={{
                    border: isSelected
                      ? "1px solid rgba(245,158,11,0.6)"
                      : "1px solid rgba(255,255,255,0.06)",
                    boxShadow: isSelected
                      ? "0 0 12px rgba(245,158,11,0.15)"
                      : "none",
                  }}
                >
                  {/* Gradient preview swatch */}
                  <div className="h-14 relative" style={{ background: style.preview }}>
                    <div className="absolute inset-x-2 top-2 flex items-center justify-between">
                      <span className="h-1 w-6 rounded-full bg-white/60" />
                      <span
                        className="h-1.5 w-1.5 rounded-full bg-emerald-300"
                        style={{ boxShadow: "0 0 6px rgba(110,231,183,0.9)" }}
                      />
                    </div>
                    <div className="absolute inset-x-2 bottom-2 flex gap-0.5">
                      <span className="h-2.5 flex-1 rounded-sm bg-white/20" />
                      <span className="h-2.5 w-4 rounded-sm bg-white/35" />
                    </div>
                    {isSelected && (
                      <span className="absolute top-1 right-1 rounded-full bg-amber-400 text-[#111] p-0.5">
                        <Check className="w-2 h-2" />
                      </span>
                    )}
                  </div>
                  <div
                    className="px-2 py-1.5"
                    style={{
                      background: isSelected
                        ? "rgba(245,158,11,0.08)"
                        : "rgba(0,0,0,0.4)",
                    }}
                  >
                    <div
                      className="text-[9px] font-mono font-semibold truncate"
                      style={{ color: isSelected ? "#fbbf24" : "#94a3b8" }}
                    >
                      {style.name}
                    </div>
                    <div
                      className="text-[8px] font-mono mt-0.5"
                      style={{ color: isSelected ? "#f59e0b80" : "#475569" }}
                    >
                      {style.label}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Right: card preview — always 420 px so screen = download */}
          <div
            className="flex-1 overflow-auto flex items-center justify-center p-6"
            style={{ background: "#0a0d14" }}
          >
            <div
              ref={cardRef}
              style={{
                width: "420px",
                minWidth: "420px",
                flexShrink: 0,
                background: selectedStyle.background,
                borderRadius: selectedStyle.radius,
                border: `1px solid ${selectedStyle.border}`,
                padding: "28px",
                fontFamily: selectedStyle.font,
                boxShadow: selectedStyle.shadow,
                position: "relative",
                overflow: "hidden",
                color: selectedStyle.text,
              }}
            >
              {/* Glow orb */}
              <div
                style={{
                  position: "absolute",
                  top: "-70px",
                  right: "-70px",
                  width: "220px",
                  height: "220px",
                  borderRadius: "50%",
                  background: `radial-gradient(circle, ${outcomeColor}22, transparent 70%)`,
                  pointerEvents: "none",
                }}
              />

              <div style={{ position: "relative", zIndex: 1 }}>
                {/* Header row */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "20px" }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: "7px", marginBottom: "5px" }}>
                      <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: outcomeColor, boxShadow: `0 0 8px ${outcomeColor}` }} />
                      <span style={{ color: selectedStyle.text, fontFamily: selectedStyle.headingFont, fontSize: "18px", fontWeight: "800", letterSpacing: "0.05em" }}>
                        XAUUSD
                      </span>
                    </div>
                    <span style={{ color: selectedStyle.muted, fontSize: "10px", letterSpacing: "0.12em", textTransform: "uppercase" }}>
                      {fmtDate(trade.tradeDate)}{trade.session ? ` · ${trade.session}` : ""}
                    </span>
                  </div>
                  <div
                    style={{
                      padding: "6px 12px",
                      borderRadius: selectedStyle.radius,
                      background: trade.direction === "Long" ? "rgba(34,197,94,0.14)" : "rgba(239,68,68,0.14)",
                      border: `1px solid ${trade.direction === "Long" ? "rgba(34,197,94,0.38)" : "rgba(239,68,68,0.38)"}`,
                      color: trade.direction === "Long" ? "#22c55e" : "#ef4444",
                      fontSize: "12px",
                      fontWeight: "700",
                      letterSpacing: "0.08em",
                    }}
                  >
                    {trade.direction === "Long" ? "▲ LONG" : "▼ SHORT"}
                  </div>
                </div>

                <div style={{ height: "1px", background: `linear-gradient(90deg, transparent, ${selectedStyle.divider}, transparent)`, marginBottom: "20px" }} />

                {/* PnL */}
                <div style={{ textAlign: "center", marginBottom: "20px" }}>
                  <div
                    style={{
                      color: pnl == null ? selectedStyle.muted : pnl >= 0 ? "#22c55e" : "#ef4444",
                      fontFamily: selectedStyle.headingFont,
                      fontSize: "42px",
                      fontWeight: "800",
                      letterSpacing: "-0.02em",
                      lineHeight: 1,
                      textShadow: `0 0 20px ${pnl == null ? "transparent" : pnl >= 0 ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)"}`,
                    }}
                  >
                    {pnl == null ? "—" : `${pnl >= 0 ? "+" : ""}$${fmt(pnl)}`}
                  </div>
                  {pips != null && (
                    <div style={{ color: selectedStyle.muted, fontSize: "13px", marginTop: "5px" }}>
                      {pips >= 0 ? "+" : ""}{fmt(pips)} pips
                    </div>
                  )}
                </div>

                {/* Status badge */}
                <div style={{ display: "flex", justifyContent: "center", marginBottom: "20px" }}>
                  <div
                    style={{
                      padding: "4px 16px",
                      borderRadius: "999px",
                      background: `${outcomeColor}18`,
                      border: `1px solid ${outcomeColor}55`,
                      color: outcomeColor,
                      fontSize: "10px",
                      fontWeight: "700",
                      letterSpacing: "0.13em",
                      textTransform: "uppercase",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {trade.status}
                  </div>
                </div>

                {/* Entry / SL / TP */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px", marginBottom: "16px" }}>
                  {[
                    { label: "Entry", value: fmt(trade.entryPrice), color: selectedStyle.text },
                    { label: "SL", value: fmt(trade.slPrice), color: "#ef4444" },
                    { label: "TP", value: fmt(trade.tpPrice), color: "#22c55e" },
                  ].map(({ label, value, color }) => (
                    <div
                      key={label}
                      style={{
                        background: selectedStyle.surface,
                        borderRadius: selectedStyle.radius === "4px" ? "3px" : "8px",
                        border: `1px solid ${selectedStyle.border}`,
                        padding: "10px 8px",
                        textAlign: "center",
                      }}
                    >
                      <div style={{ color: selectedStyle.muted, fontSize: "9px", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "4px" }}>{label}</div>
                      <div style={{ color, fontSize: "12px", fontWeight: "600" }}>{value}</div>
                    </div>
                  ))}
                </div>

                {/* Lot / Risk / Close */}
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    padding: "10px 12px",
                    background: selectedStyle.surfaceStrong,
                    borderRadius: selectedStyle.radius === "4px" ? "3px" : "8px",
                    border: `1px solid ${selectedStyle.border}`,
                    marginBottom: "16px",
                  }}
                >
                  {[
                    { label: "Lot Size", value: fmt(trade.lotSize) },
                    { label: "Risk", value: trade.riskPct != null ? `${fmt(trade.riskPct)}%` : "—" },
                    { label: "Close", value: fmt(trade.closePrice) },
                  ].map(({ label, value }) => (
                    <div key={label} style={{ textAlign: "center" }}>
                      <div style={{ color: selectedStyle.muted, fontSize: "9px", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "2px" }}>{label}</div>
                      <div style={{ color: selectedStyle.text, fontSize: "11px", fontWeight: "500" }}>{value}</div>
                    </div>
                  ))}
                </div>

                {/* Notes / tags */}
                {(trade.notes || trade.tags) && (
                  <div
                    style={{
                      padding: "8px 12px",
                      background: selectedStyle.surface,
                      borderRadius: "6px",
                      border: `1px solid ${selectedStyle.border}`,
                      marginBottom: "16px",
                      color: selectedStyle.muted,
                      fontSize: "10px",
                      lineHeight: "1.5",
                    }}
                  >
                    {trade.tags && <span style={{ color: outcomeColor, marginRight: "8px" }}>{trade.tags}</span>}
                    {trade.notes && <span>{trade.notes}</span>}
                  </div>
                )}

                {/* Footer */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: `1px solid ${selectedStyle.divider}`, paddingTop: "12px" }}>
                  <span style={{ color: selectedStyle.muted, fontSize: "9px", letterSpacing: "0.15em", textTransform: "uppercase" }}>XAUUSD Terminal</span>
                  <span
                    ref={themeLabelRef}
                    style={{ color: outcomeColor, fontSize: "9px", letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: "700" }}
                  >
                    {selectedStyle.label}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Sticky footer buttons ── */}
        <div className="shrink-0 border-t border-white/[0.06] bg-[#0f1117] px-5 py-4 flex gap-2">
          <Button
            variant="outline"
            className="flex-1 border-border text-slate-300 hover:bg-secondary gap-2"
            onClick={handleCopyImage}
            disabled={capturing}
          >
            {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
            {copied ? "Copied!" : "Copy Image"}
          </Button>
          <Button
            className="flex-1 bg-primary text-black hover:bg-primary/90 font-semibold gap-2"
            onClick={handleDownload}
            disabled={capturing}
          >
            <Download className="w-4 h-4" />
            {capturing ? "Generating…" : "Download PNG"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
