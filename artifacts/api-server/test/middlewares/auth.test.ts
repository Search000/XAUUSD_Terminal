import { describe, it, expect, beforeEach, vi } from "vitest";
import "../setup";
import { mockDb } from "../setup";
import { getUserMock, resetClerkMock } from "../helpers/mockClerk";
import { requireAuth, requireAdmin } from "../../src/lib/auth";
import type { Request, Response } from "express";

interface FakeRes {
  statusCode: number;
  body: unknown;
  status(this: FakeRes, code: number): FakeRes;
  json(this: FakeRes, payload: unknown): FakeRes;
}

function fakeReqRes(userId: string | null) {
  const req = {
    auth: undefined,
    log: { error: vi.fn(), warn: vi.fn() },
  } as unknown as Request;
  // our @clerk/express mock reads this field via getAuth()
  (req as unknown as { __clerkUserId?: string | null }).__clerkUserId = userId;

  const fakeRes: FakeRes = {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  const res = fakeRes as unknown as Response;

  const next = vi.fn();
  return { req, res, next, fakeRes };
}

describe("requireAuth", () => {
  beforeEach(() => {
    mockDb.reset();
    resetClerkMock();
  });

  it("rejects requests with no signed-in user", async () => {
    const { req, res, next, fakeRes } = fakeReqRes(null);
    await requireAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(fakeRes.statusCode).toBe(401);
    expect(fakeRes.body).toEqual({ error: "Unauthorized" });
  });

  it("calls next() for a signed-in user", async () => {
    // requireAuth fire-and-forgets a "touch last login" DB update the first
    // time it sees a given userId — queue a benign result for it.
    mockDb.resolveNext(undefined);

    const { req, res, next, fakeRes } = fakeReqRes("user_123");
    await requireAuth(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(fakeRes.statusCode).toBe(200);
  });
});

describe("requireAdmin", () => {
  // ADMIN_EMAILS is read from process.env once, at module import time (before
  // any beforeEach in this file can run), so tests use the library's default
  // fallback admin email rather than trying to override it at runtime.
  const ADMIN_EMAIL = "searchoption00@gmail.com";

  beforeEach(() => {
    mockDb.reset();
    resetClerkMock();
  });

  it("rejects unauthenticated requests with 401", async () => {
    const { req, res, next, fakeRes } = fakeReqRes(null);
    await requireAdmin(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(fakeRes.statusCode).toBe(401);
  });

  it("allows a user whose Clerk email is in ADMIN_EMAILS", async () => {
    getUserMock.mockResolvedValueOnce({
      id: "user_admin",
      emailAddresses: [{ emailAddress: ADMIN_EMAIL }],
    });
    // requireAdmin fire-and-forgets an upsertUser() call in the background
    // on the fast (admin-email-match) path — queue a result for its insert
    // and flush microtasks so it settles before the next test resets mockDb.
    mockDb.resolveNext(undefined);

    const { req, res, next, fakeRes } = fakeReqRes("user_admin");
    await requireAdmin(req, res, next);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(next).toHaveBeenCalledTimes(1);
  });

  it("rejects a signed-in user whose email is not an admin email and has no admin DB row", async () => {
    getUserMock.mockResolvedValueOnce({
      id: "user_regular",
      emailAddresses: [{ emailAddress: "regular@example.com" }],
    });
    // DB fallback lookup — no admin row found
    mockDb.resolveNext([]);

    const { req, res, next, fakeRes } = fakeReqRes("user_regular");
    await requireAdmin(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(fakeRes.statusCode).toBe(403);
    expect(fakeRes.body).toEqual({ error: "Forbidden – admin only" });
  });

  it("falls back to the DB isAdmin flag when Clerk lookup succeeds but email isn't in ADMIN_EMAILS", async () => {
    getUserMock.mockResolvedValueOnce({
      id: "user_db_admin",
      emailAddresses: [{ emailAddress: "not-in-list@example.com" }],
    });
    mockDb.resolveNext([{ userId: "user_db_admin", isAdmin: true }]);

    const { req, res, next, fakeRes } = fakeReqRes("user_db_admin");
    await requireAdmin(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it("denies access (does not fail open) when the Clerk API is unreachable and the DB is also unreachable", async () => {
    getUserMock.mockRejectedValueOnce(new Error("Clerk unavailable"));
    mockDb.rejectNext(new Error("DB unavailable"));

    const { req, res, next, fakeRes } = fakeReqRes("user_x");
    await requireAdmin(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(fakeRes.statusCode).toBe(403);
  });
});
