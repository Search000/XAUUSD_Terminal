import { pgTable, serial, text, boolean, timestamp } from "drizzle-orm/pg-core";

/**
 * In-app notifications mirror.
 * Every message sent to Telegram is also saved here so users can
 * see the same content inside the terminal UI without leaving the app.
 * Admin-broadcast rows have userId = "__admin__" and are shown to every user.
 */
export const notificationsTable = pgTable("notifications", {
  id: serial("id").primaryKey(),
  /** Clerk userId of the recipient, or "__admin__" for broadcast (shown to all). */
  userId: text("user_id").notNull(),
  /** Category: daily | weekly | monthly | win_alert | loss_alert | off_day | admin */
  type: text("type").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  isRead: boolean("is_read").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type Notification = typeof notificationsTable.$inferSelect;
