import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { assistantMessagesTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { asyncHandler } from "../lib/asyncHandler";

const router = Router();

/** GET /api/assistant/history — full conversation for the signed-in user */
router.get("/assistant/history", requireAuth, asyncHandler(async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const rows = await db
    .select()
    .from(assistantMessagesTable)
    .where(eq(assistantMessagesTable.userId, userId))
    .orderBy(asc(assistantMessagesTable.createdAt));

  res.json(rows.map((r) => ({ role: r.role, content: r.content })));
}));

/** POST /api/assistant/history — append one message (user or assistant) */
router.post("/assistant/history", requireAuth, asyncHandler(async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const { role, content } = req.body ?? {};
  if (
    (role !== "user" && role !== "assistant") ||
    typeof content !== "string" ||
    !content.trim()
  ) {
    res.status(400).json({ error: "Invalid message" });
    return;
  }

  await db.insert(assistantMessagesTable).values({ userId, role, content });
  res.json({ success: true });
}));

export default router;
