import { pgTable, serial, integer, text, numeric, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const telegramSettingsTable = pgTable("telegram_settings", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull().unique(),
  // NOTE: In production, store TELEGRAM_BOT_TOKEN in server env var.
  // This table stores user-provided tokens securely server-side.
  // Example token format: 1234567890:AAGzSIEPVuSjyz1j_36ER40BLpR71nJXUl
  botToken: text("bot_token").notNull().default(""),
  chatId: text("chat_id").notNull().default(""),
  groupId: text("group_id").notNull().default(""),
  dailyEnabled: boolean("daily_enabled").notNull().default(false),
  weeklyEnabled: boolean("weekly_enabled").notNull().default(false),
  monthlyEnabled: boolean("monthly_enabled").notNull().default(false),
  riskAlertEnabled: boolean("risk_alert_enabled").notNull().default(false),
  winThresholdPct: numeric("win_threshold_pct", { precision: 5, scale: 2 }).default("10"),
  lossThresholdPct: numeric("loss_threshold_pct", { precision: 5, scale: 2 }).default("6"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const accountSettingsTable = pgTable("account_settings", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull().unique(),
  openingBalance: numeric("opening_balance", { precision: 12, scale: 2 }).notNull().default("1000"),
  timezone: text("timezone").notNull().default("GMT+6"),
  defaultRiskPct: numeric("default_risk_pct", { precision: 5, scale: 2 }).default("1"),
  dailyTargetPct: numeric("daily_target_pct", { precision: 5, scale: 2 }).default("2"),
  /** User-chosen display name shown in the terminal header. */
  nickname: text("nickname"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertTelegramSettingsSchema = createInsertSchema(telegramSettingsTable).omit({ id: true, updatedAt: true });
export type InsertTelegramSettings = z.infer<typeof insertTelegramSettingsSchema>;
export type TelegramSettings = typeof telegramSettingsTable.$inferSelect;

export const insertAccountSettingsSchema = createInsertSchema(accountSettingsTable).omit({ id: true, updatedAt: true });
export type InsertAccountSettings = z.infer<typeof insertAccountSettingsSchema>;
export type AccountSettings = typeof accountSettingsTable.$inferSelect;

/** Global system settings — single-row singleton (id = 1). */
export const systemSettingsTable = pgTable("system_settings", {
  id: serial("id").primaryKey(),
  licenseEnforcementEnabled: boolean("license_enforcement_enabled").notNull().default(true),
  /** When true, users can self-activate a free trial without admin approval. */
  trialModeEnabled: boolean("trial_mode_enabled").notNull().default(false),
  /** Number of days for the free trial (admin-configurable, default 7). */
  trialDurationDays: integer("trial_duration_days").notNull().default(7),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type SystemSettings = typeof systemSettingsTable.$inferSelect;
