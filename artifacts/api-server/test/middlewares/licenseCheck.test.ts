import { describe, it, expect, beforeEach, vi } from "vitest";
import "../setup";
import { mockDb } from "../setup";
import { resetClerkMock } from "../helpers/mockClerk";
import { requireLicense, invalidateLicenseCache } from "../../src/lib/licenseCheck";
import type { Request, Response } from "express";

interface FakeRes {
  statusCode: number;
  body: unknown;
  status(this: FakeRes, code: number): FakeRes;
  json(this: FakeRes, payload: unknown): FakeRes;
}

function fakeReqRes(userId: string | null) {
  const req = { log: { error: vi.fn() } } as unknown as Request;
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

describe("requireLicense", () => {
  beforeEach(() => {
    mockDb.reset();
    resetClerkMock();
    // The middleware caches system settings / per-user license status
    // in-memory — clear it so every test starts from a clean slate.
    invalidateLicenseCache();
  });

  it("rejects unauthenticated requests with 401", async () => {
    const { req, res, next, fakeRes } = fakeReqRes(null);
    await requireLicense(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(fakeRes.statusCode).toBe(401);
  });

  it("allows everyone through when global license enforcement is disabled", async () => {
    mockDb.resolveNext([{ licenseEnforcementEnabled: false }]);

    const { req, res, next, fakeRes } = fakeReqRes("user_1");
    await requireLicense(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it("blocks a user with no active license when enforcement is enabled", async () => {
    mockDb.resolveNext([{ licenseEnforcementEnabled: true }]);
    mockDb.resolveNext([]); // no matching active/non-revoked license row

    const { req, res, next, fakeRes } = fakeReqRes("user_no_license");
    await requireLicense(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(fakeRes.statusCode).toBe(403);
    expect(fakeRes.body).toEqual({ error: "No active license" });
  });

  it("allows a user with a valid, unexpired license", async () => {
    mockDb.resolveNext([{ licenseEnforcementEnabled: true }]);
    mockDb.resolveNext([
      {
        usedByUserId: "user_good",
        isActive: true,
        isRevoked: false,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    ]);

    const { req, res, next, fakeRes } = fakeReqRes("user_good");
    await requireLicense(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it("blocks a user whose license has expired", async () => {
    mockDb.resolveNext([{ licenseEnforcementEnabled: true }]);
    mockDb.resolveNext([
      {
        usedByUserId: "user_expired",
        isActive: true,
        isRevoked: false,
        expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      },
    ]);

    const { req, res, next, fakeRes } = fakeReqRes("user_expired");
    await requireLicense(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(fakeRes.statusCode).toBe(403);
  });

  it("serves the second request for the same user from cache without hitting the DB again", async () => {
    mockDb.resolveNext([{ licenseEnforcementEnabled: true }]);
    mockDb.resolveNext([
      {
        usedByUserId: "user_cached",
        isActive: true,
        isRevoked: false,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    ]);

    const first = fakeReqRes("user_cached");
    await requireLicense(first.req, first.res, first.next);
    expect(first.next).toHaveBeenCalledTimes(1);

    // No mockDb.resolveNext() queued for this second call — if the
    // middleware skipped its cache and hit the DB again, mockDb would
    // throw because the queue is empty.
    const second = fakeReqRes("user_cached");
    await requireLicense(second.req, second.res, second.next);
    expect(second.next).toHaveBeenCalledTimes(1);
  });
});
