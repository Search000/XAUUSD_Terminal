/**
 * Offers routes
 *
 * Admin CRUD:
 *   GET    /api/admin/offers          — list all
 *   POST   /api/admin/offers          — create
 *   PATCH  /api/admin/offers/:id      — update fields
 *   PATCH  /api/admin/offers/:id/toggle — toggle isOn
 *   DELETE /api/admin/offers/:id      — delete
 *
 * Public (auth required):
 *   GET    /api/offers                — list active (isOn=true) offers
 */
import { Router } from "express";
import { db } from "@workspace/db";
import { offersTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../lib/auth";
import { asyncHandler } from "../lib/asyncHandler";
import { z } from "zod";

const createOfferSchema = z.object({
  title: z.string().min(1, "title is required").max(200),
  description: z.string().max(1000).optional(),
  discountPct: z.string().max(50).optional(),
  price: z.string().max(100).optional(),
  validity: z.string().max(100).optional(),
});

const updateOfferSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  discountPct: z.string().max(50).optional(),
  price: z.string().max(100).optional(),
  validity: z.string().max(100).optional(),
});

const router = Router();

function serializeOffer(o: typeof offersTable.$inferSelect) {
  return {
    id: o.id,
    title: o.title,
    description: o.description,
    isOn: o.isOn,
    discountPct: o.discountPct ?? null,
    price: o.price ?? null,
    validity: o.validity ?? null,
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
  };
}

/** GET /api/offers — public landing-page feed, returns only active offers */
router.get("/offers", asyncHandler(async (_req, res) => {
  const offers = await db
    .select()
    .from(offersTable)
    .where(eq(offersTable.isOn, true))
    .orderBy(desc(offersTable.createdAt));
  res.json(offers.map(serializeOffer));
}));

/** GET /api/admin/offers — admin: all offers */
router.get("/admin/offers", requireAuth, requireAdmin, asyncHandler(async (_req, res) => {
  const offers = await db.select().from(offersTable).orderBy(desc(offersTable.createdAt));
  res.json(offers.map(serializeOffer));
}));

/** POST /api/admin/offers — create offer */
router.post("/admin/offers", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const parsed = createOfferSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid request body" });
    return;
  }
  const { title, description, discountPct, price, validity } = parsed.data;

  const [offer] = await db
    .insert(offersTable)
    .values({
      title: title.trim(),
      description: description?.trim() ?? "",
      isOn: false,
      discountPct: discountPct?.trim() || null,
      price: price?.trim() || null,
      validity: validity?.trim() || null,
    })
    .returning();

  res.status(201).json(serializeOffer(offer));
}));

/** PATCH /api/admin/offers/:id — update offer fields */
router.patch("/admin/offers/:id", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid offer ID" }); return; }
  const parsed = updateOfferSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid request body" });
    return;
  }
  const { title, description, discountPct, price, validity } = parsed.data;

  const [existing] = await db.select().from(offersTable).where(eq(offersTable.id, id));
  if (!existing) { res.status(404).json({ error: "Offer not found" }); return; }

  const [updated] = await db
    .update(offersTable)
    .set({
      title: title?.trim() ?? existing.title,
      description: description?.trim() ?? existing.description,
      discountPct: discountPct !== undefined ? (discountPct.trim() || null) : existing.discountPct,
      price: price !== undefined ? (price.trim() || null) : existing.price,
      validity: validity !== undefined ? (validity.trim() || null) : existing.validity,
      updatedAt: new Date(),
    })
    .where(eq(offersTable.id, id))
    .returning();

  res.json(serializeOffer(updated));
}));

/** PATCH /api/admin/offers/:id/toggle — flip isOn */
router.patch("/admin/offers/:id/toggle", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid offer ID" }); return; }

  const [existing] = await db.select().from(offersTable).where(eq(offersTable.id, id));
  if (!existing) { res.status(404).json({ error: "Offer not found" }); return; }

  const [updated] = await db
    .update(offersTable)
    .set({ isOn: !existing.isOn, updatedAt: new Date() })
    .where(eq(offersTable.id, id))
    .returning();

  res.json(serializeOffer(updated));
}));

/** DELETE /api/admin/offers/:id */
router.delete("/admin/offers/:id", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid offer ID" }); return; }

  const [deleted] = await db.delete(offersTable).where(eq(offersTable.id, id)).returning();
  if (!deleted) { res.status(404).json({ error: "Offer not found" }); return; }

  res.status(204).send();
}));

export default router;
