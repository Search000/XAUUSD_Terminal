import { pgTable, serial, text, boolean, timestamp } from "drizzle-orm/pg-core";

export const offersTable = pgTable("offers", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  isOn: boolean("is_on").notNull().default(false),
  discountPct: text("discount_pct"),   // e.g. "20" for 20% off
  price: text("price"),                // e.g. "49.99"
  validity: text("validity"),          // e.g. "30 days" or "Until Dec 31"
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type Offer = typeof offersTable.$inferSelect;
