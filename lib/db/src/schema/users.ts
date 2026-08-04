import { pgTable, text, timestamp, boolean, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Staff roles. "user" = regular (non-staff) account, has no admin panel access.
export const STAFF_ROLES = ["owner", "admin", "moderator", "support", "viewer"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];
export const ALL_ROLES = ["user", ...STAFF_ROLES] as const;
export type UserRole = (typeof ALL_ROLES)[number];

export const usersTable = pgTable("users", {
  userId: text("user_id").primaryKey(), // Clerk user ID
  email: text("email").notNull(),
  isAdmin: boolean("is_admin").notNull().default(false),
  // Staff role — drives what the admin panel lets this user do. See lib/permissions.ts (api-server).
  role: text("role").notNull().default("user").$type<UserRole>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  lastLoginAt: timestamp("last_login_at"),
}, (table) => [
  // Index on email — speeds up admin lookup by email
  index("users_email_idx").on(table.email),
]);

export const insertUserSchema = createInsertSchema(usersTable);
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
