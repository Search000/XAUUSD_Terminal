import { pgTable, serial, text, timestamp, pgEnum } from "drizzle-orm/pg-core";

export const senderTypeEnum = pgEnum("chat_sender_type", ["user", "admin"]);
export const conversationStatusEnum = pgEnum("chat_conversation_status", ["open", "closed"]);

export const chatConversationsTable = pgTable("chat_conversations", {
  id:        serial("id").primaryKey(),
  userId:    text("user_id").notNull().unique(),
  email:     text("email").notNull().default(""),
  status:    conversationStatusEnum("status").notNull().default("open"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const chatMessagesTable = pgTable("chat_messages", {
  id:             serial("id").primaryKey(),
  conversationId: serial("conversation_id").notNull(),
  senderId:       text("sender_id").notNull(),           // userId or "admin"
  senderType:     senderTypeEnum("sender_type").notNull(),
  content:        text("content").notNull(),             // AES-GCM encrypted (hex)
  iv:             text("iv").notNull(),                  // AES-GCM IV (hex)
  createdAt:      timestamp("created_at").notNull().defaultNow(),
});

export type ChatConversation = typeof chatConversationsTable.$inferSelect;
export type ChatMessage = typeof chatMessagesTable.$inferSelect;
