import { logger } from "./logger";

/**
 * Telegram Bot API helper.
 * Sends a message to one recipient (chatId or groupId).
 */
export async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  text: string,
): Promise<void> {
  const res = await fetch(
    `https://api.telegram.org/bot${botToken}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
    },
  );
  const json = (await res.json()) as { ok: boolean; description?: string };
  if (!json.ok) throw new Error(json.description ?? "Telegram API error");
}

/**
 * Sends the same message to chatId AND groupId (if provided).
 * Errors are logged but don't throw so one failure won't block the other.
 */
export async function broadcastTelegramMessage(
  botToken: string,
  chatId: string,
  groupId: string | null | undefined,
  text: string,
): Promise<void> {
  const sends: Promise<void>[] = [];

  if (chatId) {
    sends.push(
      sendTelegramMessage(botToken, chatId, text).catch((e: unknown) => {
        logger.error({ err: e }, "[telegram] chatId send failed");
      }),
    );
  }

  if (groupId) {
    sends.push(
      sendTelegramMessage(botToken, groupId, text).catch((e: unknown) => {
        logger.error({ err: e }, "[telegram] groupId send failed");
      }),
    );
  }

  await Promise.all(sends);
}
