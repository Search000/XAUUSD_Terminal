import { pgTable, serial, text, timestamp, boolean, jsonb, integer } from "drizzle-orm/pg-core";

// ---- ops_error_logs ----------------------------------------------------
export const opsErrorLogs = pgTable("ops_error_logs", {
  id: serial("id").primaryKey(),
  source: text("source").notNull(), // 'backend' | 'frontend' | 'worker' | 'scheduler'
  route: text("route"),
  message: text("message").notNull(),
  stack: text("stack"),
  meta: jsonb("meta"), // arbitrary context (userId, ip, payload, etc)
  occurrences: integer("occurrences").notNull().default(1), // bumped on repeat-pattern match
  resolved: boolean("resolved").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---- ops_alerts ---------------------------------------------------------
export const opsAlerts = pgTable("ops_alerts", {
  id: serial("id").primaryKey(),
  type: text("type").notNull(), // 'downtime' | 'error' | 'security' | 'business' | 'digest'
  severity: text("severity").notNull().default("info"), // 'info' | 'warning' | 'critical'
  title: text("title").notNull(),
  detail: text("detail"),
  errorLogId: integer("error_log_id").references(() => opsErrorLogs.id),
  acknowledged: boolean("acknowledged").notNull().default(false),
  telegramSent: boolean("telegram_sent").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---- ops_actions ---------------------------------------------------------
// Every proposed/executed action by the ops agent. Approval-gated audit trail.
export const opsActions = pgTable("ops_actions", {
  id: serial("id").primaryKey(),
  alertId: integer("alert_id").references(() => opsAlerts.id),
  actionType: text("action_type").notNull(), // 'db_flag_toggle' | 'cache_clear' | 'retry_job' | ...
  description: text("description").notNull(), // human-readable "what it will do"
  reasoning: text("reasoning"), // "why"
  payload: jsonb("payload"), // structured params needed to execute
  status: text("status").notNull().default("pending"), // 'pending' | 'approved' | 'rejected' | 'executed' | 'failed'
  requestedBy: text("requested_by").notNull().default("ops-agent"), // 'ops-agent' | telegram user id | admin user id
  approvedBy: text("approved_by"),
  result: jsonb("result"), // execution outcome (success/fail detail)
  requiresDoubleConfirm: boolean("requires_double_confirm").notNull().default(false), // Phase 3: risky types (role_change, license_revoke)
  doubleConfirmed: boolean("double_confirmed").notNull().default(false),
  outcomeVerified: boolean("outcome_verified").notNull().default(false), // Phase 5: was fix actually re-checked?
  outcomeSuccess: boolean("outcome_success"), // Phase 5: did it actually work?
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  executedAt: timestamp("executed_at", { withTimezone: true }),
});

// ---- ops_mistakes (Phase 5, included now so schema is stable) -----------
export const opsMistakes = pgTable("ops_mistakes", {
  id: serial("id").primaryKey(),
  actionId: integer("action_id").references(() => opsActions.id),
  problem: text("problem").notNull(),
  triedFix: text("tried_fix").notNull(),
  result: text("result").notNull(), // 'success' | 'fail' | 'rollback'
  rootCause: text("root_cause"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
