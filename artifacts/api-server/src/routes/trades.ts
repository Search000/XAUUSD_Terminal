import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { tradesTable } from "@workspace/db";
import { eq, and, gte, lte, desc, ne } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { requireLicense } from "../lib/licenseCheck";
import { sendRiskAlertIfNeeded } from "../lib/notifications";
import { asyncHandler } from "../lib/asyncHandler";
import { z } from "zod";

const createTradeSchema = z.object({
  tradeDate: z.string().min(1, "tradeDate is required"),
  direction: z.string().min(1, "direction is required"),
  status: z.string().optional(),
  balance: z.number().nullable().optional(),
  riskPct: z.number().nullable().optional(),
  entryPrice: z.number().nullable().optional(),
  slPrice: z.number().nullable().optional(),
  tpPrice: z.number().nullable().optional(),
  lotSize: z.number().nullable().optional(),
  closePrice: z.number().nullable().optional(),
  pips: z.number().nullable().optional(),
  pnl: z.number().nullable().optional(),
  tags: z.string().nullable().optional(),
  session: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  screenshotUrl: z.string().nullable().optional(),
  lossReason: z.string().nullable().optional(),
});

const updateTradeSchema = z.object({
  direction: z.string().optional(),
  status: z.string().optional(),
  notes: z.string().nullable().optional(),
  balance: z.number().nullable().optional(),
  riskPct: z.number().nullable().optional(),
  entryPrice: z.number().nullable().optional(),
  slPrice: z.number().nullable().optional(),
  tpPrice: z.number().nullable().optional(),
  lotSize: z.number().nullable().optional(),
  closePrice: z.number().nullable().optional(),
  pips: z.number().nullable().optional(),
  pnl: z.number().nullable().optional(),
  tags: z.string().nullable().optional(),
  session: z.string().nullable().optional(),
  lossReason: z.string().nullable().optional(),
  screenshotUrl: z.string().nullable().optional(),
});

const router = Router();

/** GET /api/trades */
router.get("/trades", requireAuth, requireLicense, asyncHandler(async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const { limit = "1000", offset = "0", startDate, endDate } = req.query as Record<string, string>;
  const { includeArchived } = req.query as Record<string, string>;

  const parsedLimit  = Math.min(Math.max(1, parseInt(limit,  10) || 1000), 1000);
  const parsedOffset = Math.max(0, parseInt(offset, 10) || 0);

  const conditions = [
    eq(tradesTable.userId, userId),
    ...(includeArchived === "true" ? [] : [ne(tradesTable.status, "Archived")]),
  ];
  if (startDate) conditions.push(gte(tradesTable.tradeDate, startDate));
  if (endDate)   conditions.push(lte(tradesTable.tradeDate, endDate));

  const trades = await db
    .select()
    .from(tradesTable)
    .where(and(...conditions))
    .orderBy(desc(tradesTable.tradeDate), desc(tradesTable.createdAt))
    .limit(parsedLimit)
    .offset(parsedOffset);

  res.json(trades.map(serializeTrade));
}));

/** POST /api/trades */
router.post("/trades", requireAuth, requireLicense, asyncHandler(async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const parsed = createTradeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid request body" });
    return;
  }
  const body = parsed.data;

  const [trade] = await db
    .insert(tradesTable)
    .values({
      userId,
      tradeDate: body.tradeDate,
      direction: body.direction,
      status: body.status ?? "Pending",
      balance: body.balance != null ? String(body.balance) : null,
      riskPct: body.riskPct != null ? String(body.riskPct) : null,
      entryPrice: body.entryPrice != null ? String(body.entryPrice) : null,
      slPrice: body.slPrice != null ? String(body.slPrice) : null,
      tpPrice: body.tpPrice != null ? String(body.tpPrice) : null,
      lotSize: body.lotSize != null ? String(body.lotSize) : null,
      closePrice: body.closePrice != null ? String(body.closePrice) : null,
      pips: body.pips != null ? String(body.pips) : null,
      pnl: body.pnl != null ? String(body.pnl) : null,
      tags: body.tags ?? null,
      session: body.session ?? null,
      notes: body.notes ?? null,
      screenshotUrl: body.screenshotUrl ?? null,
      lossReason: body.lossReason ?? null,
    })
    .returning();

  if (trade.status === "TP Hit" || trade.status === "SL Hit") {
    sendRiskAlertIfNeeded(userId, trade.id).catch(() => {});
  }

  res.status(201).json(serializeTrade(trade));
}));

/** PATCH /api/trades/:id */
router.patch("/trades/:id", requireAuth, requireLicense, asyncHandler(async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid trade ID" }); return; }

  const parsedUpdate = updateTradeSchema.safeParse(req.body);
  if (!parsedUpdate.success) {
    res.status(400).json({ error: parsedUpdate.error.errors[0]?.message ?? "Invalid request body" });
    return;
  }
  const body = parsedUpdate.data;

  const updateData: Partial<typeof tradesTable.$inferInsert> = {};
  if ("direction" in body) updateData.direction = body.direction;
  if ("status" in body) updateData.status = body.status ?? "Pending";
  if ("notes" in body) updateData.notes = body.notes;
  if ("balance" in body) updateData.balance = body.balance != null ? String(body.balance) : null;
  if ("riskPct" in body) updateData.riskPct = body.riskPct != null ? String(body.riskPct) : null;
  if ("entryPrice" in body) updateData.entryPrice = body.entryPrice != null ? String(body.entryPrice) : null;
  if ("slPrice" in body) updateData.slPrice = body.slPrice != null ? String(body.slPrice) : null;
  if ("tpPrice" in body) updateData.tpPrice = body.tpPrice != null ? String(body.tpPrice) : null;
  if ("lotSize" in body) updateData.lotSize = body.lotSize != null ? String(body.lotSize) : null;
  if ("closePrice" in body) updateData.closePrice = body.closePrice != null ? String(body.closePrice) : null;
  if ("pips" in body) updateData.pips = body.pips != null ? String(body.pips) : null;
  if ("pnl" in body) updateData.pnl = body.pnl != null ? String(body.pnl) : null;
  if ("tags" in body) updateData.tags = body.tags;
  if ("session" in body) updateData.session = body.session;
  if ("screenshotUrl" in body) updateData.screenshotUrl = body.screenshotUrl as string | null | undefined;
  if ("lossReason" in body) updateData.lossReason = body.lossReason;

  const [updated] = await db
    .update(tradesTable)
    .set(updateData)
    .where(and(eq(tradesTable.id, id), eq(tradesTable.userId, userId)))
    .returning();

  if (!updated) { res.status(404).json({ error: "Trade not found" }); return; }

  if (updated.status === "TP Hit" || updated.status === "SL Hit") {
    sendRiskAlertIfNeeded(userId, updated.id).catch(() => {});
  }

  res.json(serializeTrade(updated));
}));

/** DELETE /api/trades/:id */
router.delete("/trades/:id", requireAuth, requireLicense, asyncHandler(async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid trade ID" }); return; }

  await db.delete(tradesTable).where(and(eq(tradesTable.id, id), eq(tradesTable.userId, userId)));
  res.json({ success: true });
}));

function serializeTrade(t: typeof tradesTable.$inferSelect) {
  return {
    id: t.id,
    userId: t.userId,
    tradeDate: t.tradeDate,
    balance: t.balance != null ? parseFloat(t.balance) : null,
    riskPct: t.riskPct != null ? parseFloat(t.riskPct) : null,
    entryPrice: t.entryPrice != null ? parseFloat(t.entryPrice) : null,
    slPrice: t.slPrice != null ? parseFloat(t.slPrice) : null,
    tpPrice: t.tpPrice != null ? parseFloat(t.tpPrice) : null,
    lotSize: t.lotSize != null ? parseFloat(t.lotSize) : null,
    direction: t.direction,
    status: t.status,
    closePrice: t.closePrice != null ? parseFloat(t.closePrice) : null,
    pips: t.pips != null ? parseFloat(t.pips) : null,
    pnl: t.pnl != null ? parseFloat(t.pnl) : null,
    tags: t.tags,
    session: t.session,
    notes: t.notes,
    screenshotUrl: t.screenshotUrl,
    lossReason: t.lossReason,
    createdAt: t.createdAt.toISOString(),
  };
}

export default router;
