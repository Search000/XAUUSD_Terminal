import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import "../setup";
import { mockDb } from "../setup";
import { resetClerkMock } from "../helpers/mockClerk";
import app from "../../src/app";

describe("POST /api/contact", () => {
  beforeEach(() => {
    mockDb.reset();
    resetClerkMock();
  });

  it("rejects a request with no phone number", async () => {
    const res = await request(app).post("/api/contact").send({ email: "a@b.com" });
    expect(res.status).toBe(400);
  });

  it("succeeds and reports attempts left while under the limit", async () => {
    mockDb.resolveNext([{ limit: 3 }]); // getLimit()
    mockDb.resolveNext([{ attempts: 1 }]); // upsert increment -> 1st attempt
    mockDb.resolveNext([]); // telegram settings lookup (none configured)

    const res = await request(app)
      .post("/api/contact")
      .send({ phone: "+1234567890", email: "a@b.com" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, attemptsLeft: 2 });
  });

  it("reports limitReached once the configured limit has been hit, without notifying Telegram", async () => {
    mockDb.resolveNext([{ limit: 3 }]); // getLimit()
    // previousCount = newCount - 1 = 3, which is >= limit(3) -> blocked.
    // Only this one db call should happen for a blocked request: no
    // telegram-settings lookup, since we return before that point.
    mockDb.resolveNext([{ attempts: 4 }]);

    const res = await request(app)
      .post("/api/contact")
      .send({ phone: "+1234567890" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: false, limitReached: true });
    // No queued result left over means the route didn't make an extra
    // (unnecessary) DB call once the limit was hit.
    expect(mockDb.pendingCount()).toBe(0);
  });
});

describe("Admin contact-config routes require admin auth", () => {
  beforeEach(() => {
    mockDb.reset();
    resetClerkMock();
  });

  it("GET /api/admin/contact-config returns 401 when signed out", async () => {
    const res = await request(app).get("/api/admin/contact-config");
    expect(res.status).toBe(401);
  });
});
