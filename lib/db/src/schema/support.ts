import { pgTable, serial, text, boolean, timestamp } from "drizzle-orm/pg-core";

export const supportMessagesTable = pgTable("support_messages", {
  id:        serial("id").primaryKey(),
  userId:    text("user_id").notNull(),
  email:     text("email").notNull().default(""),
  message:   text("message").notNull(),
  isRead:    boolean("is_read").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type SupportMessage = typeof supportMessagesTable.$inferSelect;
