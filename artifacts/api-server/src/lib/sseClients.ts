import type { Response } from "express";

/** In-memory registry: userId → set of SSE response streams */
const clients = new Map<string, Set<Response>>();

/** Register a connected SSE client. Returns an unregister function. */
export function registerSSEClient(userId: string, res: Response): () => void {
  if (!clients.has(userId)) clients.set(userId, new Set());
  clients.get(userId)!.add(res);

  return () => {
    const set = clients.get(userId);
    if (set) {
      set.delete(res);
      if (set.size === 0) clients.delete(userId);
    }
  };
}

function writeEvent(res: Response) {
  try {
    res.write("event: notification\ndata: {}\n\n");
  } catch {
    // client already gone — close handler will clean up
  }
}

/**
 * Push a notification event to the relevant connected clients.
 *
 * - userId === "__admin__" → broadcast to every connected user (admin notification)
 * - otherwise             → push only to that user's connections
 */
export function pushNotificationSSE(userId: string): void {
  if (userId === "__admin__") {
    for (const set of clients.values()) {
      for (const res of set) writeEvent(res);
    }
  } else {
    const set = clients.get(userId);
    if (set) for (const res of set) writeEvent(res);
  }
}
