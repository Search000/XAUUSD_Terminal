import jsPDF from "jspdf";

export type SharesData = {
  totalInvestment: number;
  totalPnL: number;
  currentBalance: number;
  investors: Array<{
    id: number;
    name: string;
    investmentAmount: number;
    sharePct: number;
    pnlShare: number;
    totalBalance: number;
    growthPct: number;
  }>;
};

export function generateInvestorPDF(shares: SharesData | undefined, month: string) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();

  // ── colours ──────────────────────────────────────────────────────────
  const GOLD   = "#F59E0B";
  const DARK   = "#17181C";
  const SLATE  = "#94A3B8";
  const WHITE  = "#F1F5F9";
  const GREEN  = "#22C55E";
  const RED    = "#EF4444";
  const CARD   = "#1E1F26";

  // ── header bar ───────────────────────────────────────────────────────
  doc.setFillColor(DARK);
  doc.rect(0, 0, pageW, 42, "F");

  doc.setTextColor(GOLD);
  doc.setFontSize(20);
  doc.setFont("helvetica", "bold");
  doc.text("XAUUSD TERMINAL", 14, 17);

  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(SLATE);
  doc.text("INVESTOR MONTHLY STATEMENT", 14, 26);
  doc.text(`Period: ${month}`, 14, 33);
  doc.text(
    `Generated: ${new Date().toLocaleDateString("en-US", { dateStyle: "long" })}`,
    pageW - 14, 33, { align: "right" }
  );

  // ── summary cards ────────────────────────────────────────────────────
  const sy = 50;
  const cw = (pageW - 28) / 3;
  const pnl = shares?.totalPnL ?? 0;

  const cards = [
    { label: "TOTAL CAPITAL",  value: fmt(shares?.totalInvestment ?? 0), color: WHITE },
    { label: "TOTAL P/L",      value: `${pnl >= 0 ? "+" : ""}${fmt(pnl)}`, color: pnl >= 0 ? GREEN : RED },
    { label: "LIVE BALANCE",   value: fmt(shares?.currentBalance ?? 0), color: GOLD },
  ];

  cards.forEach((card, i) => {
    const x = 14 + i * cw;
    doc.setFillColor(CARD);
    doc.roundedRect(x, sy, cw - 4, 24, 2, 2, "F");
    doc.setFontSize(6.5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(SLATE);
    doc.text(card.label, x + 5, sy + 9);
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(card.color);
    doc.text(card.value, x + 5, sy + 20);
  });

  // ── section heading ───────────────────────────────────────────────────
  const tableTop = sy + 34;
  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(GOLD);
  doc.text("INVESTOR BREAKDOWN", 14, tableTop);

  // ── table ─────────────────────────────────────────────────────────────
  const headers = ["Investor", "Investment", "Share %", "P/L Share", "Curr. Value", "Growth"];
  const colXs   = [14, 65, 100, 125, 153, 180];
  const colW2   = [50, 33,  23,  27,   25,  17];
  const rowH    = 8;
  let   y       = tableTop + 6;

  // header row
  doc.setFillColor(DARK);
  doc.rect(14, y, pageW - 28, rowH, "F");
  doc.setFontSize(7);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(GOLD);
  headers.forEach((h, i) => {
    const align = i === 0 ? "left" : "right";
    const x = align === "right" ? colXs[i] + colW2[i] - 2 : colXs[i] + 2;
    doc.text(h, x, y + 5.5, { align });
  });
  y += rowH;

  // data rows
  const investors = shares?.investors ?? [];
  if (investors.length === 0) {
    doc.setFontSize(8);
    doc.setFont("helvetica", "italic");
    doc.setTextColor(SLATE);
    doc.text("No investors on record.", 14, y + 6);
  } else {
    investors.forEach((inv, idx) => {
      const isEven = idx % 2 === 0;
      doc.setFillColor(isEven ? "#F8F9FA" : "#FFFFFF");
      doc.rect(14, y, pageW - 28, rowH, "F");

      const growth = inv.growthPct ?? 0;
      const pnlShare = inv.pnlShare ?? 0;

      const cells = [
        { text: inv.name, color: "#1E293B", bold: true },
        { text: fmt(inv.investmentAmount), color: "#374151", bold: false },
        { text: `${(inv.sharePct ?? 0).toFixed(2)}%`, color: GOLD, bold: false },
        { text: `${pnlShare >= 0 ? "+" : ""}${fmt(pnlShare)}`, color: pnlShare >= 0 ? "#16A34A" : "#DC2626", bold: false },
        { text: fmt(inv.totalBalance ?? 0), color: "#1E293B", bold: true },
        { text: `${growth >= 0 ? "+" : ""}${growth.toFixed(2)}%`, color: growth >= 0 ? "#16A34A" : "#DC2626", bold: false },
      ];

      cells.forEach((cell, i) => {
        const align = i === 0 ? "left" : "right";
        const x = align === "right" ? colXs[i] + colW2[i] - 2 : colXs[i] + 2;
        doc.setFontSize(7.5);
        doc.setFont("helvetica", cell.bold ? "bold" : "normal");
        doc.setTextColor(cell.color);
        doc.text(cell.text, x, y + 5.5, { align });
      });

      // thin bottom border
      doc.setDrawColor("#E2E8F0");
      doc.setLineWidth(0.2);
      doc.line(14, y + rowH, pageW - 14, y + rowH);

      y += rowH;
    });
  }

  // ── footer ────────────────────────────────────────────────────────────
  const footY = y + 12;
  doc.setDrawColor(GOLD);
  doc.setLineWidth(0.4);
  doc.line(14, footY, pageW - 14, footY);
  doc.setFontSize(6.5);
  doc.setFont("helvetica", "italic");
  doc.setTextColor(SLATE);
  doc.text(
    "This statement is auto-generated by XAUUSD Terminal. For queries, contact your account manager.",
    14, footY + 6
  );

  // ── save ──────────────────────────────────────────────────────────────
  const filename = `investor-statement-${month.replace(/\s/g, "-").toLowerCase()}.pdf`;
  doc.save(filename);
}

function fmt(n: number, prefix = "$"): string {
  return `${prefix}${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
