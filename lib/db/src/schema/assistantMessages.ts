import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Terminal Assistant (AI chat) history.
 * Separate from the human support chat_messages table — this stores the
 * user's conversation with the AI assistant, keyed by Clerk userId, so it
 * follows them across any device/browser.
 */
export const assistantMessagesTable = pgTable("assistant_messages", {
  id: serial("id").primaryKey(),
  /** Clerk userId — scopes every message to exactly one account. */
  userId: text("user_id").notNull(),
  /** "user" | "assistant" */
  role: text("role").notNull(),
  content: text("content").notNull(),
  /** "up" | "down" | null — only ever set on assistant messages */
  feedback: text("feedback"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type AssistantMessage = typeof assistantMessagesTable.$inferSelect;
