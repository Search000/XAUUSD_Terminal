import { z } from "zod";
import { Router } from "express";

const generateLicenseSchema = z.object({
  transactionCode: z.string().min(1, "transactionCode is required").max(100),
  durationDays: z.number({ invalid_type_error: "durationDays must be a number" }).int("durationDays must be an integer").min(1).max(3650),
  note: z.string().max(500).optional(),
});

const activateLicenseSchema = z.object({
  licenseCode: z.string().min(1, "licenseCode is required").max(100),
});
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { licensesTable, usersTable, systemSettingsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth, requireAdmin, upsertUser } from "../lib/auth";
import { randomBytes } from "crypto";
import { asyncHandler } from "../lib/asyncHandler";

const router = Router();

/** Generate a cryptographically random license code */
function generateCode(): string {
  const part1 = randomBytes(4).toString("hex").toUpperCase();
  const part2 = randomBytes(4).toString("hex").toUpperCase();
  const part3 = randomBytes(4).toString("hex").toUpperCase();
  return `${part1}-${part2}-${part3}`;
}

/** POST /api/licenses/generate — Admin only */
router.post("/licenses/generate", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const parsed = generateLicenseSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid request body" });
    return;
  }
  const { transactionCode, durationDays, note } = parsed.data;

  const licenseCode = generateCode();
  const [license] = await db
    .insert(licensesTable)
    .values({
      licenseCode,
      transactionCode: transactionCode.trim().toUpperCase(),
      durationDays: Number(durationDays),
      note: note ?? null,
      isActive: false,
      isRevoked: false,
    })
    .returning();

  res.status(201).json(serializeLicense(license));
}));

/** POST /api/licenses/activate — Authenticated user */
router.post("/licenses/activate", requireAuth, asyncHandler(async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  try {
    await upsertUser(userId);

    const parsedActivate = activateLicenseSchema.safeParse(req.body);
    if (!parsedActivate.success) {
      res.status(400).json({ error: parsedActivate.error.errors[0]?.message ?? "Invalid request body" });
      return;
    }
    const { licenseCode } = parsedActivate.data;

    const [license] = await db
      .select()
      .from(licensesTable)
      .where(eq(licensesTable.licenseCode, licenseCode.trim().toUpperCase()));

    if (!license) {
      res.status(400).json({ error: "Invalid license code" });
      return;
    }
    if (license.isRevoked) {
      res.status(400).json({ error: "This license has been revoked" });
      return;
    }
    if (license.isActive && license.usedByUserId && license.usedByUserId !== userId) {
      res.status(400).json({ error: "This license is already in use" });
      return;
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + license.durationDays * 24 * 60 * 60 * 1000);

    const [userRow] = await db.select().from(usersTable).where(eq(usersTable.userId, userId));

    await db
      .update(licensesTable)
      .set({
        isActive: true,
        activatedAt: now,
        expiresAt,
        usedByUserId: userId,
        usedByEmail: userRow?.email ?? "",
      })
      .where(eq(licensesTable.id, license.id));

    const daysRemaining = Math.ceil((expiresAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
    const [systemSettings] = await db
      .select()
      .from(systemSettingsTable)
      .where(eq(systemSettingsTable.id, 1));

    res.json({
      hasLicense: true,
      isActive: true,
      expiresAt: expiresAt.toISOString(),
      daysRemaining,
      licenseEnforcementEnabled: systemSettings?.licenseEnforcementEnabled ?? true,
    });
  } catch (err) {
    req.log.error({ err }, "License activation failed");
    res.status(500).json({ error: "License activation failed. Please try again." });
  }
}));

/** GET /api/licenses/status */
router.get("/licenses/status", requireAuth, asyncHandler(async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const [systemSettings] = await db
    .select()
    .from(systemSettingsTable)
    .where(eq(systemSettingsTable.id, 1));
  const licenseEnforcementEnabled = systemSettings?.licenseEnforcementEnabled ?? true;

  const now = new Date();
  const [license] = await db
    .select()
    .from(licensesTable)
    .where(and(eq(licensesTable.usedByUserId, userId), eq(licensesTable.isActive, true)));

  if (!license || license.isRevoked) {
    res.json({
      hasLicense: false,
      isActive: false,
      expiresAt: null,
      activatedAt: null,
      durationDays: null,
      daysRemaining: null,
      licenseEnforcementEnabled,
      trialModeEnabled: systemSettings?.trialModeEnabled ?? false,
      trialDurationDays: systemSettings?.trialDurationDays ?? 7,
      isTrial: false,
    });
    return;
  }

  const expired = license.expiresAt && license.expiresAt < now;
  const daysRemaining = license.expiresAt
    ? Math.max(0, Math.ceil((license.expiresAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)))
    : null;

  res.json({
    hasLicense: true,
    isActive: !expired,
    expiresAt: license.expiresAt?.toISOString() ?? null,
    activatedAt: license.activatedAt?.toISOString() ?? null,
    durationDays: license.durationDays,
    daysRemaining,
    licenseEnforcementEnabled,
    trialModeEnabled: systemSettings?.trialModeEnabled ?? false,
    trialDurationDays: systemSettings?.trialDurationDays ?? 7,
    isTrial: license.transactionCode === "TRIAL",
  });
}));

/** POST /api/licenses/trial — Authenticated user: self-activate free trial */
router.post("/licenses/trial", requireAuth, asyncHandler(async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  try {
    await upsertUser(userId);

    const [systemSettings] = await db
      .select()
      .from(systemSettingsTable)
      .where(eq(systemSettingsTable.id, 1));

    if (!systemSettings?.trialModeEnabled) {
      res.status(403).json({ error: "Trial mode is currently disabled by admin." });
      return;
    }

    const existingTrials = await db
      .select()
      .from(licensesTable)
      .where(and(eq(licensesTable.usedByUserId, userId), eq(licensesTable.transactionCode, "TRIAL")));

    if (existingTrials.length > 0) {
      res.status(400).json({ error: "You have already used your free trial." });
      return;
    }

    const now = new Date();
    const trialDays = systemSettings?.trialDurationDays ?? 7;
    const expiresAt = new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1000);
    const licenseCode = `TRIAL-${randomBytes(4).toString("hex").toUpperCase()}-${randomBytes(4).toString("hex").toUpperCase()}`;
    const [userRow] = await db.select().from(usersTable).where(eq(usersTable.userId, userId));

    const [trialLicense] = await db
      .insert(licensesTable)
      .values({
        licenseCode,
        transactionCode: "TRIAL",
        durationDays: trialDays,
        note: `${trialDays}-day free trial (self-activated)`,
        isActive: true,
        isRevoked: false,
        activatedAt: now,
        expiresAt,
        usedByUserId: userId,
        usedByEmail: userRow?.email ?? "",
      })
      .returning();

    res.status(201).json({
      hasLicense: true,
      isActive: true,
      expiresAt: trialLicense.expiresAt!.toISOString(),
      activatedAt: trialLicense.activatedAt!.toISOString(),
      durationDays: trialLicense.durationDays,
      daysRemaining: trialDays,
      licenseEnforcementEnabled: systemSettings.licenseEnforcementEnabled,
      isTrial: true,
    });
  } catch (err) {
    req.log.error({ err }, "Trial activation failed");
    res.status(500).json({ error: "Trial activation failed. Please try again." });
  }
}));

/** GET /api/licenses — Admin only */
router.get("/licenses", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const licenses = await db.select().from(licensesTable).orderBy(licensesTable.createdAt);
  res.json(licenses.map(serializeLicense));
}));

/** PATCH /api/licenses/:id/revoke — Admin only */
router.patch("/licenses/:id/revoke", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid license ID" }); return; }
  const [updated] = await db
    .update(licensesTable)
    .set({ isRevoked: true, isActive: false })
    .where(eq(licensesTable.id, id))
    .returning();
  if (!updated) { res.status(404).json({ error: "License not found" }); return; }
  res.json(serializeLicense(updated));
}));

/** DELETE /api/licenses/:id — Admin only */
router.delete("/licenses/:id", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid license ID" }); return; }
  const [deleted] = await db
    .delete(licensesTable)
    .where(eq(licensesTable.id, id))
    .returning({ id: licensesTable.id });

  if (!deleted) { res.status(404).json({ error: "License not found" }); return; }
  res.status(204).send();
}));

function serializeLicense(l: typeof licensesTable.$inferSelect) {
  return {
    id: l.id,
    licenseCode: l.licenseCode,
    transactionCode: l.transactionCode,
    durationDays: l.durationDays,
    activatedAt: l.activatedAt?.toISOString() ?? null,
    expiresAt: l.expiresAt?.toISOString() ?? null,
    isActive: l.isActive,
    isRevoked: l.isRevoked,
    usedByUserId: l.usedByUserId ?? null,
    usedByEmail: l.usedByEmail ?? null,
    note: l.note ?? null,
    createdAt: l.createdAt.toISOString(),
  };
}

export default router;
