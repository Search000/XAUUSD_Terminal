import { Router } from "express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth, upsertUser } from "../lib/auth";
import { getAuth } from "@clerk/express";
import { asyncHandler } from "../lib/asyncHandler";

const router = Router();

/** GET /api/me/is-admin — returns { isAdmin: boolean } from DB */
router.get("/me/is-admin", requireAuth, asyncHandler(async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  await upsertUser(userId);
  const [user] = await db.select().from(usersTable).where(eq(usersTable.userId, userId));
  res.json({ isAdmin: user?.isAdmin ?? false });
}));

export default router;
