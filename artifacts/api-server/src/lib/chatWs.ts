import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import type { Server } from "node:http";
import { verifyToken, clerkClient } from "@clerk/express";
import { db } from "@workspace/db";
import {
  chatConversationsTable,
  chatMessagesTable,
  usersTable,
  telegramSettingsTable,
} from "@workspace/db";
import { eq, desc, asc } from "drizzle-orm";
import { encryptMessage, decryptMessage } from "./chatEncryption";
import { sendTelegramMessage } from "./telegram";
import { logger } from "./logger";

// Map: userId → Set of WebSocket connections
const userConnections = new Map<string, Set<WebSocket>>();
// Map: "admin" → Set of WebSocket connections (admin panel connections)
const adminConnections = new Set<WebSocket>();

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS ?? "searchoption00@gmail.com")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

function parseQueryParams(url: string | undefined): Record<string, string> {
  if (!url) return {};
  const idx = url.indexOf("?");
  if (idx === -1) return {};
  const params: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(url.slice(idx + 1)).entries()) {
    params[k] = v;
  }
  return params;
}

async function getAdminTelegram() {
  const [tg] = await db
    .select({ botToken: telegramSettingsTable.botToken, chatId: telegramSettingsTable.chatId })
    .from(telegramSettingsTable)
    .innerJoin(usersTable, eq(usersTable.userId, telegramSettingsTable.userId))
    .where(eq(usersTable.isAdmin, true))
    .limit(1);
  return tg ?? null;
}

async function getOrCreateConversation(userId: string, email: string) {
  const existing = await db
    .select()
    .from(chatConversationsTable)
    .where(eq(chatConversationsTable.userId, userId))
    .limit(1);

  if (existing[0]) return existing[0];

  const [conv] = await db
    .insert(chatConversationsTable)
    .values({ userId, email })
    .returning();
  return conv;
}

async function getConversationHistory(conversationId: number) {
  const rows = await db
    .select()
    .from(chatMessagesTable)
    .where(eq(chatMessagesTable.conversationId, conversationId))
    .orderBy(asc(chatMessagesTable.createdAt))
    .limit(200);

  return rows.map((r) => ({
    id: r.id,
    senderId: r.senderId,
    senderType: r.senderType,
    text: decryptMessage(r.content, r.iv),
    createdAt: r.createdAt.toISOString(),
  }));
}

function broadcast(sockets: Set<WebSocket>, payload: unknown) {
  const data = JSON.stringify(payload);
  for (const ws of sockets) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  }
}

/**
 * The client sends `isAdmin=true` as a plain query param on the WS URL —
 * that is NOT proof of anything (anyone can open a WebSocket with that
 * param set, no auth required to do so). Real admin status is decided
 * here, server-side, from a verified Clerk session token: verify the JWT,
 * look up the authenticated user's email, and check it against
 * ADMIN_EMAILS (falling back to the DB isAdmin flag) — mirrors the
 * requireAdmin() check used for the REST admin routes in lib/auth.ts.
 * Returns the verified Clerk userId on success, or null if the caller
 * should NOT be treated as admin (missing/invalid token, or a real but
 * non-admin account).
 */
async function verifyAdminToken(token: string | undefined): Promise<string | null> {
  if (!token) return null;
  try {
    const payload = await verifyToken(token, { secretKey: process.env.CLERK_SECRET_KEY });
    const verifiedUserId = payload.sub;
    if (!verifiedUserId) return null;

    const clerkUser = await clerkClient.users.getUser(verifiedUserId);
    const email = clerkUser.emailAddresses[0]?.emailAddress?.toLowerCase() ?? "";
    if (email && ADMIN_EMAILS.includes(email)) return verifiedUserId;

    const [user] = await db.select().from(usersTable).where(eq(usersTable.userId, verifiedUserId));
    if (user?.isAdmin) return verifiedUserId;

    return null;
  } catch (err) {
    logger.warn({ err }, "chatWs: admin token verification failed");
    return null;
  }
}

export function createChatWss(server: Server): WebSocketServer {
  const wss = new WebSocketServer({ server, path: "/api/chat/ws" });

  wss.on("connection", async (ws: WebSocket, req: IncomingMessage) => {
    const params = parseQueryParams(req.url);
    const claimedUserId = params["userId"];
    const email = params["email"] ?? "";

    // Never trust params["isAdmin"] — verify it server-side against a real
    // Clerk session token. Any unauthenticated caller can set isAdmin=true
    // in the URL, so that value alone must never grant admin access.
    const verifiedAdminUserId = await verifyAdminToken(params["token"]);
    const isAdmin = verifiedAdminUserId !== null;
    const userId = isAdmin ? verifiedAdminUserId! : claimedUserId;

    if (!userId) {
      ws.close(1008, "userId required");
      return;
    }

    // Register connection
    if (isAdmin) {
      adminConnections.add(ws);
      logger.info({ userId }, "Admin connected to chat WS");
    } else {
      if (!userConnections.has(userId)) userConnections.set(userId, new Set());
      userConnections.get(userId)!.add(ws);
      logger.info({ userId }, "User connected to chat WS");
    }

    // Send conversation history on connect
    try {
      if (isAdmin) {
        // Admin: send list of all conversations
        const convs = await db
          .select()
          .from(chatConversationsTable)
          .orderBy(desc(chatConversationsTable.updatedAt));
        ws.send(JSON.stringify({ type: "conversations", data: convs }));
      } else {
        // User: send their conversation history
        const conv = await getOrCreateConversation(userId, email);
        const history = await getConversationHistory(conv.id);
        ws.send(JSON.stringify({ type: "history", conversationId: conv.id, data: history }));
      }
    } catch (err) {
      logger.error({ err }, "Error sending initial chat data");
    }

    // Handle messages
    ws.on("message", async (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as {
          type: string;
          text?: string;
          conversationId?: number;
          targetUserId?: string;
        };

        if (msg.type === "send" && msg.text?.trim()) {
          if (isAdmin) {
            // Admin sends to a user
            const conv = msg.conversationId
              ? (await db.select().from(chatConversationsTable).where(eq(chatConversationsTable.id, msg.conversationId)).limit(1))[0]
              : null;

            if (!conv) return;

            const { content, iv } = encryptMessage(msg.text.trim());
            const [saved] = await db.insert(chatMessagesTable).values({
              conversationId: conv.id,
              senderId: userId,
              senderType: "admin",
              content,
              iv,
            }).returning();

            // Update conversation updatedAt
            await db.update(chatConversationsTable)
              .set({ updatedAt: new Date() })
              .where(eq(chatConversationsTable.id, conv.id));

            const outMsg = {
              type: "message",
              data: {
                id: saved.id,
                senderId: userId,
                senderType: "admin",
                text: msg.text.trim(),
                createdAt: saved.createdAt.toISOString(),
              },
            };

            // Send to the user
            const userSockets = userConnections.get(conv.userId);
            if (userSockets) broadcast(userSockets, outMsg);
            // Echo to all admin connections
            broadcast(adminConnections, { ...outMsg, conversationId: conv.id });

          } else {
            // User sends to admin
            const conv = await getOrCreateConversation(userId, email);

            // Check if this is the very first message in this conversation
            const existing = await db
              .select({ id: chatMessagesTable.id })
              .from(chatMessagesTable)
              .where(eq(chatMessagesTable.conversationId, conv.id))
              .limit(1);
            const isFirstMessage = existing.length === 0;

            const { content, iv } = encryptMessage(msg.text.trim());
            const [saved] = await db.insert(chatMessagesTable).values({
              conversationId: conv.id,
              senderId: userId,
              senderType: "user",
              content,
              iv,
            }).returning();

            await db.update(chatConversationsTable)
              .set({ updatedAt: new Date() })
              .where(eq(chatConversationsTable.id, conv.id));

            const outMsg = {
              type: "message",
              conversationId: conv.id,
              data: {
                id: saved.id,
                senderId: userId,
                senderType: "user",
                text: msg.text.trim(),
                createdAt: saved.createdAt.toISOString(),
              },
            };

            // Echo back to user
            const userSockets = userConnections.get(userId);
            if (userSockets) broadcast(userSockets, outMsg);
            // Send to all admins
            broadcast(adminConnections, { ...outMsg, userEmail: email, userId });

            // Auto bot reply + Telegram notify — only on the very first message
            if (isFirstMessage) {
              // Send auto bot reply
              const botText = "Thanks for reaching out! Your message has been received. A Team Member will get back to you shortly. Please wait. 🙏";
              const { content: botContent, iv: botIv } = encryptMessage(botText);
              const [botMsg] = await db.insert(chatMessagesTable).values({
                conversationId: conv.id,
                senderId: "bot",
                senderType: "admin",
                content: botContent,
                iv: botIv,
              }).returning();

              const botOutMsg = {
                type: "message",
                conversationId: conv.id,
                data: {
                  id: botMsg.id,
                  senderId: "bot",
                  senderType: "admin",
                  text: botText,
                  createdAt: botMsg.createdAt.toISOString(),
                },
              };
              // Send bot reply to user
              const userSockets2 = userConnections.get(userId);
              if (userSockets2) broadcast(userSockets2, botOutMsg);
              // Show bot reply in admin panel too
              broadcast(adminConnections, { ...botOutMsg, userEmail: email, userId });

              // Telegram notify admin
              try {
                const tg = await getAdminTelegram();
                if (tg?.botToken && tg?.chatId) {
                  const text = `💬 *New Support Chat*\n👤 ${email || userId}\n\nA user has started a support chat.`;
                  await sendTelegramMessage(tg.botToken, tg.chatId, text);
                }
              } catch { /* silent */ }
            }
          }
        } else if (msg.type === "get_history" && isAdmin && msg.conversationId) {
          // Admin requests history of a specific conversation
          const history = await getConversationHistory(msg.conversationId);
          ws.send(JSON.stringify({ type: "history", conversationId: msg.conversationId, data: history }));
        }
      } catch (err) {
        logger.error({ err }, "Error handling chat WS message");
      }
    });

    ws.on("close", () => {
      if (isAdmin) {
        adminConnections.delete(ws);
      } else {
        const set = userConnections.get(userId);
        if (set) {
          set.delete(ws);
          if (set.size === 0) userConnections.delete(userId);
        }
      }
    });
  });

  return wss;
}
