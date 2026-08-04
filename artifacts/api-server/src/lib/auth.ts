import { Request, Response, NextFunction } from "express";
import { getAuth, clerkClient } from "@clerk/express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

/**
 * In-memory throttle: track which userIds have had their lastLoginAt
 * updated recently. Clears the entry after 1 hour so the next request
 * after an hour will update the DB again.
 */
const loginTimestampCache = new Map<string, number>();
const LOGIN_THROTTLE_MS = 60 * 60 * 1000; // 1 hour

function touchLastLogin(userId: string): void {
  const now = Date.now();
  const last = loginTimestampCache.get(userId) ?? 0;
  if (now - last < LOGIN_THROTTLE_MS) return; // already updated recently

  loginTimestampCache.set(userId, now);

  // Fire-and-forget: update DB in background, never block the request
  db.update(usersTable)
    .set({ lastLoginAt: new Date(now) })
    .where(eq(usersTable.userId, userId))
    .catch(() => {});
}

/** Require a signed-in Clerk session. Returns 401 if missing.
 *  Also records last-login timestamp in the background (throttled, non-blocking).
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  // Update lastLoginAt in background — does not block the response
  touchLastLogin(userId);
  next();
}

export const ADMIN_EMAILS = (process.env.ADMIN_EMAILS ?? "searchoption00@gmail.com")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

/** Fetch email from Clerk for a userId. Returns empty string on failure. */
async function getClerkEmail(userId: string): Promise<string> {
  try {
    const clerkUser = await clerkClient.users.getUser(userId);
    return clerkUser.emailAddresses[0]?.emailAddress ?? "";
  } catch {
    return "";
  }
}

/**
 * Upsert user record from Clerk into local DB.
 * ADMIN_EMAILS always land as role "owner" (fixed, can't be reassigned — see
 * lib/permissions.ts requirePermission("manage_roles")). Everyone else keeps
 * whatever role they already have in the DB (defaults to "user" on first insert).
 */
export async function upsertUser(userId: string): Promise<void> {
  try {
    const email = await getClerkEmail(userId);
    if (!email) return;
    const isOwnerEmail = ADMIN_EMAILS.includes(email.toLowerCase());

    if (isOwnerEmail) {
      await db
        .insert(usersTable)
        .values({ userId, email, isAdmin: true, role: "owner", lastLoginAt: new Date() })
        .onConflictDoUpdate({
          target: usersTable.userId,
          set: { email, isAdmin: true, role: "owner", lastLoginAt: new Date() },
        });
    } else {
      await db
        .insert(usersTable)
        .values({ userId, email, isAdmin: false, role: "user", lastLoginAt: new Date() })
        .onConflictDoUpdate({
          // Don't touch isAdmin/role on conflict — a staff member's assigned
          // role must survive every login-triggered upsert.
          target: usersTable.userId,
          set: { email, lastLoginAt: new Date() },
        });
    }
    // Also refresh the in-memory cache so requireAuth doesn't redundantly update
    loginTimestampCache.set(userId, Date.now());
  } catch {
    // Non-critical: proceed even if upsert fails
  }
}

/**
 * Require ANY staff role (owner/admin/moderator/support/viewer) — i.e. some
 * amount of admin panel access, not necessarily permission to do anything in
 * particular. Routes that need a specific capability should use
 * requirePermission(...) from lib/permissions.ts instead.
 *
 * Two-path check so searchoption00@gmail.com ALWAYS gets through:
 *  1. Fast path  — fetch email from Clerk and check against ADMIN_EMAILS directly.
 *                  This works even when the DB has no user record yet.
 *  2. DB fallback — if Clerk API is unreachable, check role in local DB.
 *
 * Upserts the user record in the background on every admin request so the DB
 * stays in sync without blocking the response.
 */
export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  // ── Path 1: check email from Clerk directly ──────────────────────────────
  const email = await getClerkEmail(userId);
  if (email && ADMIN_EMAILS.includes(email.toLowerCase())) {
    // Upsert in background (don't await — don't block the response)
    upsertUser(userId).catch(() => {});
    next();
    return;
  }

  // ── Path 2: fallback to DB role (covers edge cases + non-owner staff) ────
  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.userId, userId));
    if (user && user.role !== "user") {
      next();
      return;
    }
  } catch {
    // DB unreachable — deny rather than allow unknown users
  }

  res.status(403).json({ error: "Forbidden – admin only" });
}
