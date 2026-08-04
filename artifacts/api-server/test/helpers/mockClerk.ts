import { vi } from "vitest";
import type { Request, Response, NextFunction } from "express";

/**
 * In-memory stand-in for @clerk/express.
 *
 * `setAuthedUser(userId)` / `setSignedOut()` control what the *next* incoming
 * request looks like as far as `getAuth(req)` is concerned. `clerkClient`
 * exposes a mockable `users.getUser` so tests can control the email Clerk
 * would return for the current user (used by admin checks).
 */

let currentUserId: string | null = null;

export function setAuthedUser(userId: string | null) {
  currentUserId = userId;
}

export function setSignedOut() {
  currentUserId = null;
}

export const getUserMock = vi.fn(async (userId: string) => ({
  id: userId,
  emailAddresses: [{ emailAddress: "user@example.com" }],
}));

export function makeClerkExpressMock() {
  return {
    clerkMiddleware: () => (req: Request, _res: Response, next: NextFunction) => {
      (req as unknown as { __clerkUserId?: string | null }).__clerkUserId = currentUserId;
      next();
    },
    getAuth: (req: Request) => ({
      userId: (req as unknown as { __clerkUserId?: string | null }).__clerkUserId ?? null,
    }),
    clerkClient: {
      users: {
        getUser: getUserMock,
      },
    },
  };
}

export function resetClerkMock() {
  currentUserId = null;
  getUserMock.mockReset();
  getUserMock.mockImplementation(async (userId: string) => ({
    id: userId,
    emailAddresses: [{ emailAddress: "user@example.com" }],
  }));
}
