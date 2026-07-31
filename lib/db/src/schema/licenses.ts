import { pgTable, serial, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const licensesTable = pgTable("licenses", {
  id: serial("id").primaryKey(),
  licenseCode: text("license_code").notNull().unique(),
  transactionCode: text("transaction_code").notNull(),
  durationDays: integer("duration_days").notNull(),
  note: text("note"),
  isActive: boolean("is_active").notNull().default(false),
  isRevoked: boolean("is_revoked").notNull().default(false),
  activatedAt: timestamp("activated_at"),
  expiresAt: timestamp("expires_at"),
  usedByUserId: text("used_by_user_id"),
  usedByEmail: text("used_by_email"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertLicenseSchema = createInsertSchema(licensesTable).omit({ id: true, createdAt: true });
export type InsertLicense = z.infer<typeof insertLicenseSchema>;
export type License = typeof licensesTable.$inferSelect;
