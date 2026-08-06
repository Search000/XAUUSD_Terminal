import { pgTable, serial, text, numeric, timestamp, date, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const tradesTable = pgTable("trades", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  tradeDate: date("trade_date").notNull(),
  // balance: the trader's total account balance at the time this trade was logged (manually entered).
  // Do NOT use this as the single source of truth for current balance — it can be stale.
  // For live balance, use: investors.investmentAmount_sum + sum(closed_trades.pnl).
  // See /api/investors/shares for the authoritative computed balance.
  balance: numeric("balance", { precision: 12, scale: 2 }),
  riskPct: numeric("risk_pct", { precision: 5, scale: 2 }),
  entryPrice: numeric("entry_price", { precision: 10, scale: 5 }),
  slPrice: numeric("sl_price", { precision: 10, scale: 5 }),
  tpPrice: numeric("tp_price", { precision: 10, scale: 5 }),
  lotSize: numeric("lot_size", { precision: 8, scale: 2 }),
  direction: text("direction").notNull(), // Long | Short
  status: text("status").notNull().default("Pending"), // Pending | Running | TP Hit | SL Hit
  closePrice: numeric("close_price", { precision: 10, scale: 5 }),
  pips: numeric("pips", { precision: 8, scale: 2 }),
  pnl: numeric("pnl", { precision: 12, scale: 2 }),
  tags: text("tags"),
  session: text("session"),
  notes: text("notes"),
  screenshotUrl: text("screenshot_url"),
  lossReason: text("loss_reason"), // Mistake Journal: why did this trade lose? (FOMO, Revenge Trade, News, Wrong SL, etc.)
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  // Index on user_id — essential for dashboard/report query performance as trade volume grows
  index("trades_user_id_idx").on(table.userId),
]);

export const insertTradeSchema = createInsertSchema(tradesTable).omit({ id: true, createdAt: true });
export type InsertTrade = z.infer<typeof insertTradeSchema>;
export type Trade = typeof tradesTable.$inferSelect;
