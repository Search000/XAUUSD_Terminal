import { pgTable, serial, text, timestamp, boolean, jsonb, integer } from "drizzle-orm/pg-core";

// ---- ops_dev_suggestions (Phase 4) -----------------------------------------
// Fix suggestions, changelog drafts, test-case ideas, code-review-lite notes.
// Never auto-applied — read-only advisory, owner/dev copies into actual PR.
export const opsDevSuggestions = pgTable("ops_dev_suggestions", {
  id: serial("id").primaryKey(),
  type: text("type").notNull(), // 'fix_suggestion' | 'changelog' | 'test_case' | 'code_review' | 'dependency_audit'
  sourceRef: text("source_ref"), // commit sha / PR number / error_log id / free text
  title: text("title").notNull(),
  content: text("content").notNull(), // markdown: explanation + diff/snippet
  status: text("status").notNull().default("new"), // 'new' | 'reviewed' | 'applied' | 'dismissed'
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---- Phase 5: self-learning columns on ops_actions (see migrate append) ---
// ops_mistakes already exists from Phase 1 schema — reused as-is here.

// ---- ops_suggestions (Phase 6 — product advisory) --------------------------
export const opsSuggestions = pgTable("ops_suggestions", {
  id: serial("id").primaryKey(),
  what: text("what").notNull(),
  why: text("why").notNull(),
  impact: text("impact").notNull(),
  timing: text("timing").notNull(), // 'now' | 'later' | 'optional'
  priority: text("priority").notNull(), // 'urgent' | 'important' | 'nice_to_have'
  effort: text("effort"), // 'small' | 'medium' | 'large'
  effortImpactNote: text("effort_impact_note"), // e.g. "small effort, big impact"
  area: text("area"), // page/component this concerns
  status: text("status").notNull().default("pending"), // 'pending' | 'reviewed' | 'dismissed'
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
