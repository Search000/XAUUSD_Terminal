import { pgTable, serial, text, timestamp, boolean, jsonb, integer } from "drizzle-orm/pg-core";

// ---- ops_digests (Phase 2) ------------------------------------------------
// One row per generated daily/weekly digest — history for "what happened when".
export const opsDigests = pgTable("ops_digests", {
  id: serial("id").primaryKey(),
  period: text("period").notNull(), // 'daily' | 'weekly'
  periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
  periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
  stats: jsonb("stats").notNull(), // raw numbers: signups, errors, revenue, active users, churn
  summary: text("summary"), // AI-written human summary (from worker)
  telegramSent: boolean("telegram_sent").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---- ops_ticket_meta (Phase 2) --------------------------------------------
// Sits alongside your existing support-ticket/feedback table — adds ops-agent
// category + draft-reply WITHOUT touching that table's schema.
// ticketId here should reference your existing tickets/feedback table's id.
export const opsTicketMeta = pgTable("ops_ticket_meta", {
  id: serial("id").primaryKey(),
  ticketId: integer("ticket_id").notNull(), // FK to existing tickets table (add real reference once table name confirmed)
  category: text("category"), // 'bug' | 'question' | 'feature_request' | 'complaint'
  draftReply: text("draft_reply"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---- ops_security_events (Phase 3) ----------------------------------------
export const opsSecurityEvents = pgTable("ops_security_events", {
  id: serial("id").primaryKey(),
  type: text("type").notNull(), // 'rate_limit' | 'cors_violation' | 'secret_probe' | 'suspicious_login' | 'failed_payment' | 'webhook_error'
  ip: text("ip"),
  userId: text("user_id"),
  detail: jsonb("detail"),
  severity: text("severity").notNull().default("warning"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
