import { z } from "zod";
import { Router } from "express";

const updateAccountSettingsSchema = z.object({
  timezone: z.string().max(50).optional(),
  defaultRiskPct: z.number().min(0.01).max(100).optional(),
  dailyTargetPct: z.number().min(0.01).max(100).optional(),
  nickname: z.string().max(50).nullable().optional(),
});
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { telegramSettingsTable, accountSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { broadcastTelegramMessage } from "../lib/telegram";
import { asyncHandler } from "../lib/asyncHandler";

const router = Router();

/** GET /api/settings/telegram */
router.get("/settings/telegram", requireAuth, asyncHandler(async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const [settings] = await db.select().from(telegramSettingsTable).where(eq(telegramSettingsTable.userId, userId));
  if (!settings) {
    res.json({
      id: 0,
      botToken: "",
      chatId: "",
      groupId: "",
      dailyEnabled: false,
      weeklyEnabled: false,
      monthlyEnabled: false,
      riskAlertEnabled: false,
      winThresholdPct: 10,
      lossThresholdPct: 6,
      notifyLanguage: "bn",
    });
    return;
  }

  res.json(serializeTelegramSettings(settings));
}));

/** POST /api/settings/telegram/test */
router.post("/settings/telegram/test", requireAuth, asyncHandler(async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const [settings] = await db.select().from(telegramSettingsTable).where(eq(telegramSettingsTable.userId, userId));

  if (!settings || !settings.botToken || !settings.chatId) {
    res.status(400).json({ error: "Bot token and Chat ID must be saved before testing." });
    return;
  }

  const { botToken, chatId, groupId } = settings;
  const text =
    "✅ *XAUUSD Terminal — Test Connection*\n\n" +
    "Your Telegram notifications are configured correctly and working!" +
    (groupId ? "\n\n_(This message was sent to your Personal Chat and Investor Group)_" : "");

  try {
    await broadcastTelegramMessage(botToken, chatId, groupId, text);
    res.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to reach Telegram API.";
    res.status(400).json({ error: msg });
  }
}));

const updateTelegramSettingsSchema = z.object({
  botToken:         z.string().max(200).optional(),
  chatId:           z.string().max(100).optional(),
  groupId:          z.string().max(100).optional(),
  dailyEnabled:     z.boolean().optional(),
  weeklyEnabled:    z.boolean().optional(),
  monthlyEnabled:   z.boolean().optional(),
  riskAlertEnabled: z.boolean().optional(),
  winThresholdPct:  z.number().min(0).max(100).optional(),
  lossThresholdPct: z.number().min(0).max(100).optional(),
  notifyLanguage:   z.enum(["en", "bn"]).optional(),
});

/** PUT /api/settings/telegram */
router.put("/settings/telegram", requireAuth, asyncHandler(async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const parsedTelegram = updateTelegramSettingsSchema.safeParse(req.body);
  if (!parsedTelegram.success) {
    res.status(400).json({ error: parsedTelegram.error.errors[0]?.message ?? "Invalid request body" });
    return;
  }
  const body = parsedTelegram.data;

  const [existing] = await db.select().from(telegramSettingsTable).where(eq(telegramSettingsTable.userId, userId));

  if (existing) {
    const [updated] = await db
      .update(telegramSettingsTable)
      .set({
        botToken: body.botToken ?? existing.botToken,
        chatId: body.chatId ?? existing.chatId,
        groupId: body.groupId ?? existing.groupId,
        dailyEnabled: body.dailyEnabled ?? existing.dailyEnabled,
        weeklyEnabled: body.weeklyEnabled ?? existing.weeklyEnabled,
        monthlyEnabled: body.monthlyEnabled ?? existing.monthlyEnabled,
        riskAlertEnabled: body.riskAlertEnabled ?? existing.riskAlertEnabled,
        winThresholdPct: body.winThresholdPct != null ? String(body.winThresholdPct) : existing.winThresholdPct,
        lossThresholdPct: body.lossThresholdPct != null ? String(body.lossThresholdPct) : existing.lossThresholdPct,
        notifyLanguage: body.notifyLanguage ?? existing.notifyLanguage,
        updatedAt: new Date(),
      })
      .where(eq(telegramSettingsTable.userId, userId))
      .returning();
    res.json(serializeTelegramSettings(updated));
  } else {
    const [created] = await db
      .insert(telegramSettingsTable)
      .values({
        userId,
        botToken: body.botToken ?? "",
        chatId: body.chatId ?? "",
        groupId: body.groupId ?? "",
        dailyEnabled: body.dailyEnabled ?? false,
        weeklyEnabled: body.weeklyEnabled ?? false,
        monthlyEnabled: body.monthlyEnabled ?? false,
        riskAlertEnabled: body.riskAlertEnabled ?? false,
        winThresholdPct: body.winThresholdPct != null ? String(body.winThresholdPct) : "10",
        lossThresholdPct: body.lossThresholdPct != null ? String(body.lossThresholdPct) : "6",
        notifyLanguage: body.notifyLanguage ?? "bn",
      })
      .returning();
    res.json(serializeTelegramSettings(created));
  }
}));

function serializeAccountSettings(s: typeof accountSettingsTable.$inferSelect) {
  return {
    id: s.id,
    timezone: s.timezone,
    defaultRiskPct: s.defaultRiskPct ? parseFloat(s.defaultRiskPct) : 1,
    dailyTargetPct: s.dailyTargetPct ? parseFloat(s.dailyTargetPct) : 2,
    nickname: s.nickname ?? null,
  };
}

/** GET /api/settings/account */
router.get("/settings/account", requireAuth, asyncHandler(async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const [settings] = await db.select().from(accountSettingsTable).where(eq(accountSettingsTable.userId, userId));
  if (!settings) {
    res.json({ id: 0, timezone: "GMT+6", defaultRiskPct: 1, dailyTargetPct: 2, nickname: null });
    return;
  }
  res.json(serializeAccountSettings(settings));
}));

/** PUT /api/settings/account */
router.put("/settings/account", requireAuth, asyncHandler(async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const parsed = updateAccountSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid request body" });
    return;
  }
  const { timezone, defaultRiskPct, dailyTargetPct, nickname } = parsed.data;

  const [existing] = await db.select().from(accountSettingsTable).where(eq(accountSettingsTable.userId, userId));

  if (existing) {
    const [updated] = await db
      .update(accountSettingsTable)
      .set({
        timezone: timezone ?? existing.timezone,
        defaultRiskPct: defaultRiskPct != null ? String(defaultRiskPct) : existing.defaultRiskPct,
        dailyTargetPct: dailyTargetPct != null ? String(dailyTargetPct) : existing.dailyTargetPct,
        nickname: nickname !== undefined ? (nickname?.trim() || null) : existing.nickname,
        updatedAt: new Date(),
      })
      .where(eq(accountSettingsTable.userId, userId))
      .returning();
    res.json(serializeAccountSettings(updated));
  } else {
    const [created] = await db
      .insert(accountSettingsTable)
      .values({
        userId,
        timezone: timezone ?? "GMT+6",
        defaultRiskPct: defaultRiskPct != null ? String(defaultRiskPct) : "1",
        dailyTargetPct: dailyTargetPct != null ? String(dailyTargetPct) : "2",
        nickname: nickname?.trim() || null,
      })
      .returning();
    res.json(serializeAccountSettings(created));
  }
}));

function serializeTelegramSettings(s: typeof telegramSettingsTable.$inferSelect) {
  return {
    id: s.id,
    botToken: s.botToken,
    chatId: s.chatId,
    groupId: s.groupId,
    dailyEnabled: s.dailyEnabled,
    weeklyEnabled: s.weeklyEnabled,
    monthlyEnabled: s.monthlyEnabled,
    riskAlertEnabled: s.riskAlertEnabled,
    winThresholdPct: s.winThresholdPct ? parseFloat(s.winThresholdPct) : 10,
    lossThresholdPct: s.lossThresholdPct ? parseFloat(s.lossThresholdPct) : 6,
    notifyLanguage: s.notifyLanguage ?? "bn",
  };
}

export default router;
