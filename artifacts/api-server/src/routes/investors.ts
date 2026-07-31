import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { investorsTable, tradesTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { requireLicense } from "../lib/licenseCheck";
import { asyncHandler } from "../lib/asyncHandler";
import { z } from "zod";

const createInvestorSchema = z.object({
  name: z.string().min(1, "name is required"),
  investmentAmount: z.number({ invalid_type_error: "investmentAmount must be a number" }).positive("investmentAmount must be positive"),
});

const updateInvestorSchema = z.object({
  name: z.string().min(1).optional(),
  investmentAmount: z.number().positive().optional(),
});

const router = Router();

/** GET /api/investors */
router.get("/investors", requireAuth, requireLicense, asyncHandler(async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const [investors, allTrades] = await Promise.all([
    db.select().from(investorsTable).where(eq(investorsTable.userId, userId)).orderBy(desc(investorsTable.investmentAmount)),
    db.select().from(tradesTable).where(eq(tradesTable.userId, userId)),
  ]);

  const totalInvestment = investors.reduce((s, inv) => s + parseFloat(inv.investmentAmount), 0);
  const totalPnL = allTrades
    .filter((t) => t.status === "TP Hit" || t.status === "SL Hit")
    .reduce((s, t) => s + (t.pnl ? parseFloat(t.pnl) : 0), 0);

  res.json(investors.map((inv) => {
    const amount   = parseFloat(inv.investmentAmount);
    const sharePct = totalInvestment > 0 ? (amount / totalInvestment) * 100 : 0;
    const pnlShare = (sharePct / 100) * totalPnL;
    const growthPct = amount > 0 ? (pnlShare / amount) * 100 : 0;
    return {
      id:               inv.id,
      name:             inv.name,
      investmentAmount: amount,
      createdAt:        inv.createdAt.toISOString(),
      sharePct:         parseFloat(sharePct.toFixed(4)),
      pnlShare:         parseFloat(pnlShare.toFixed(2)),
      totalBalance:     parseFloat((amount + pnlShare).toFixed(2)),
      growthPct:        parseFloat(growthPct.toFixed(4)),
    };
  }));
}));

/** POST /api/investors */
router.post("/investors", requireAuth, requireLicense, asyncHandler(async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const parsed = createInvestorSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid request body" });
    return;
  }
  const { name, investmentAmount } = parsed.data;

  const [investor] = await db
    .insert(investorsTable)
    .values({ userId, name, investmentAmount: String(investmentAmount) })
    .returning();

  res.status(201).json(serializeBasicInvestor(investor));
}));

/** GET /api/investors/shares */
router.get("/investors/shares", requireAuth, requireLicense, asyncHandler(async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const investors = await db.select().from(investorsTable).where(eq(investorsTable.userId, userId)).orderBy(desc(investorsTable.investmentAmount));
  const allTrades = await db.select().from(tradesTable).where(eq(tradesTable.userId, userId)).orderBy(desc(tradesTable.id));

  const totalInvestment = investors.reduce((s, inv) => s + parseFloat(inv.investmentAmount), 0);

  const closedTrades = allTrades.filter(
    (t) => t.status === "TP Hit" || t.status === "SL Hit",
  );
  const totalPnL = closedTrades.reduce(
    (s, t) => s + (t.pnl ? parseFloat(t.pnl) : 0),
    0,
  );
  const currentBalance = totalInvestment + totalPnL;

  const enrichedInvestors = investors.map((inv) => {
    const amount = parseFloat(inv.investmentAmount);
    const sharePct = totalInvestment > 0 ? (amount / totalInvestment) * 100 : 0;
    const pnlShare = (sharePct / 100) * totalPnL;
    const totalBal = amount + pnlShare;
    const growthPct = amount > 0 ? (pnlShare / amount) * 100 : 0;
    return {
      id: inv.id,
      name: inv.name,
      investmentAmount: amount,
      createdAt: inv.createdAt.toISOString(),
      sharePct: parseFloat(sharePct.toFixed(4)),
      pnlShare: parseFloat(pnlShare.toFixed(2)),
      totalBalance: parseFloat(totalBal.toFixed(2)),
      growthPct: parseFloat(growthPct.toFixed(4)),
    };
  });

  res.json({
    totalInvestment: parseFloat(totalInvestment.toFixed(2)),
    currentBalance: parseFloat(currentBalance.toFixed(2)),
    totalPnL: parseFloat(totalPnL.toFixed(2)),
    investors: enrichedInvestors,
  });
}));

/** PATCH /api/investors/:id */
router.patch("/investors/:id", requireAuth, requireLicense, asyncHandler(async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid investor ID" }); return; }
  const parsedUpdate = updateInvestorSchema.safeParse(req.body);
  if (!parsedUpdate.success) {
    res.status(400).json({ error: parsedUpdate.error.errors[0]?.message ?? "Invalid request body" });
    return;
  }
  const { name, investmentAmount } = parsedUpdate.data;

  const updateData: Partial<typeof investorsTable.$inferInsert> = {};
  if (name != null) updateData.name = name;
  if (investmentAmount != null) updateData.investmentAmount = String(investmentAmount);

  const [updated] = await db
    .update(investorsTable)
    .set(updateData)
    .where(and(eq(investorsTable.id, id), eq(investorsTable.userId, userId)))
    .returning();

  if (!updated) { res.status(404).json({ error: "Investor not found" }); return; }
  res.json(serializeBasicInvestor(updated));
}));

/** DELETE /api/investors/:id */
router.delete("/investors/:id", requireAuth, requireLicense, asyncHandler(async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid investor ID" }); return; }
  await db.delete(investorsTable).where(and(eq(investorsTable.id, id), eq(investorsTable.userId, userId)));
  res.json({ success: true });
}));

/** Used by POST and PATCH — returns only the stored fields, no share
 *  calculations. Share data requires all investors + trades; callers
 *  should use GET /investors (list) or GET /investors/shares for that. */
function serializeBasicInvestor(i: typeof investorsTable.$inferSelect) {
  return {
    id:               i.id,
    name:             i.name,
    investmentAmount: parseFloat(i.investmentAmount),
    createdAt:        i.createdAt.toISOString(),
  };
}

export default router;
