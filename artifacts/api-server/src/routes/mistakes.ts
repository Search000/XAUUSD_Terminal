import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { tradesTable } from "@workspace/db";
import { eq, and, gte, lte } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { requireLicense } from "../lib/licenseCheck";
import { asyncHandler } from "../lib/asyncHandler";

const router = Router();

/** GET /api/mistakes/monthly */
router.get("/mistakes/monthly", requireAuth, requireLicense, asyncHandler(async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const now = new Date();
  const month = parseInt(String(req.query.month ?? now.getMonth() + 1), 10);
  const year = parseInt(String(req.query.year ?? now.getFullYear()), 10);

  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const monthEnd = new Date(year, month, 0).toISOString().slice(0, 10);

  const trades = await db
    .select()
    .from(tradesTable)
    .where(and(
      eq(tradesTable.userId, userId),
      gte(tradesTable.tradeDate, monthStart),
      lte(tradesTable.tradeDate, monthEnd),
    ));

  const losses = trades.filter((t) => t.status === "SL Hit");
  const taggedLosses = losses.filter((t) => t.lossReason);

  const reasonMap: Record<string, number> = {};
  for (const t of taggedLosses) {
    const r = t.lossReason!;
    reasonMap[r] = (reasonMap[r] ?? 0) + 1;
  }

  const reasons = Object.entries(reasonMap)
    .map(([reason, count]) => ({
      reason,
      count,
      percentage: taggedLosses.length > 0 ? parseFloat(((count / taggedLosses.length) * 100).toFixed(1)) : 0,
    }))
    .sort((a, b) => b.count - a.count);

  res.json({
    month,
    year,
    totalLosses: losses.length,
    taggedLosses: taggedLosses.length,
    reasons,
  });
}));

export default router;
