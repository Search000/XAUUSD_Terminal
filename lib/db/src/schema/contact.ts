import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";

/** One row per IP — tracks attempt count and most recent contact info */
export const contactAttemptsTable = pgTable("contact_attempts", {
  id:          serial("id").primaryKey(),
  ip:          text("ip").notNull().unique(),
  attempts:    integer("attempts").notNull().default(0),
  lastEmail:   text("last_email"),
  lastPhone:   text("last_phone"),
  lastAt:      timestamp("last_at").notNull().defaultNow(),
  createdAt:   timestamp("created_at").notNull().defaultNow(),
});

/** Singleton row (id=1) — global contact limit config */
export const contactConfigTable = pgTable("contact_config", {
  id:    serial("id").primaryKey(),
  limit: integer("limit").notNull().default(3),
});

export type ContactAttempt = typeof contactAttemptsTable.$inferSelect;
export type ContactConfig  = typeof contactConfigTable.$inferSelect;
