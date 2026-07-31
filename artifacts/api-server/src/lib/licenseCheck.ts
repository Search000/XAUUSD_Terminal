import { Request, Response, NextFunction } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { licensesTable, systemSettingsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";

// ─── Simple in-memory TTL cache ───────────────────────────────────────────────
// Avoids hitting the DB on every authenticated request.
// License status is cached per-user; system settings are cached globally.
// TTL is intentionally short (60 s) so revocations propagate quickly.

const LICENSE_CACHE_TTL_MS = 60_000; // 60 seconds

const licenseCache = new Map<string, { allowed: boolean; expiresAt: number }>();

let systemSettingsCache: { licenseEnforcementEnabled: boolean; expiresAt: number } | null = null;

/** Middleware: require an active (non-expired, non-revoked) license for the authed user.
 *  If global license enforcement is disabled (admin toggle), everyone passes through. */
export async function requireLicense(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const now = Date.now();

  // ── Check system settings (globally cached) ──────────────────────────────
  if (!systemSettingsCache || now >= systemSettingsCache.expiresAt) {
    const [row] = await db.select().from(systemSettingsTable).where(eq(systemSettingsTable.id, 1));
    systemSettingsCache = {
      licenseEnforcementEnabled: row?.licenseEnforcementEnabled ?? true,
      expiresAt: now + LICENSE_CACHE_TTL_MS,
    };
  }

  if (!systemSettingsCache.licenseEnforcementEnabled) {
    // Enforcement disabled globally — allow all authenticated users
    next();
    return;
  }

  // ── Check per-user license (cached) ──────────────────────────────────────
  const cached = licenseCache.get(userId);
  if (cached && now < cached.expiresAt) {
    if (cached.allowed) {
      next();
    } else {
      res.status(403).json({ error: "No active license" });
    }
    return;
  }

  const nowDate = new Date();
  const [license] = await db
    .select()
    .from(licensesTable)
    .where(
      and(
        eq(licensesTable.usedByUserId, userId),
        eq(licensesTable.isActive, true),
        eq(licensesTable.isRevoked, false),
      ),
    );

  const allowed = !!(license && (!license.expiresAt || license.expiresAt >= nowDate));
  licenseCache.set(userId, { allowed, expiresAt: now + LICENSE_CACHE_TTL_MS });

  if (allowed) {
    next();
  } else {
    res.status(403).json({ error: "No active license" });
  }
}

/** Call this after revoking or expiring a license so the cache doesn't serve stale data. */
export function invalidateLicenseCache(userId?: string): void {
  if (userId) {
    licenseCache.delete(userId);
  } else {
    licenseCache.clear();
  }
  systemSettingsCache = null;
}
