import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";

/**
 * AES-256-GCM encryption for chat messages stored in DB.
 * Key is derived from SESSION_SECRET env var so it persists across restarts.
 */
function getEncryptionKey(): Buffer {
  const secret = process.env["SESSION_SECRET"] ?? "default-dev-chat-key-change-in-prod";
  return createHash("sha256").update(secret).digest();
}

export function encryptMessage(plaintext: string): { content: string; iv: string } {
  const key = getEncryptionKey();
  const iv = randomBytes(12); // 96-bit IV for AES-GCM
  const cipher = createCipheriv("aes-256-gcm", key, iv);

  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Store encrypted + authTag together
  const combined = Buffer.concat([encrypted, authTag]);
  return {
    content: combined.toString("hex"),
    iv: iv.toString("hex"),
  };
}

export function decryptMessage(content: string, iv: string): string {
  try {
    const key = getEncryptionKey();
    const ivBuf = Buffer.from(iv, "hex");
    const combined = Buffer.from(content, "hex");

    // Last 16 bytes are authTag
    const authTag = combined.subarray(combined.length - 16);
    const encrypted = combined.subarray(0, combined.length - 16);

    const decipher = createDecipheriv("aes-256-gcm", key, ivBuf);
    decipher.setAuthTag(authTag);

    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  } catch {
    return "[encrypted message]";
  }
}
