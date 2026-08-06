import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import "../setup";
import { mockDb } from "../setup";
import { setAuthedUser, setSignedOut, resetClerkMock } from "../helpers/mockClerk";
import { invalidateLicenseCache } from "../../src/lib/licenseCheck";
import app from "../../src/app";

// Every /api/trades route is gated by requireAuth -> requireLicense, so each
// test queues those two lookups first (system settings, then per-user
// license) before whatever the route handler itself needs.
function queueLicenseAllowed() {
  mockDb.resolveNext(undefined); // requireAuth touchLastLogin fire-and-forget update
  mockDb.resolveNext([{ licenseEnforcementEnabled: true }]);
  mockDb.resolveNext([
    {
      isActive: true,
      isRevoked: false,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  ]);
}

describe("/api/trades", () => {
  beforeEach(() => {
    mockDb.reset();
    resetClerkMock();
    invalidateLicenseCache();
  });

  it("GET requires authentication", async () => {
    setSignedOut();
    const res = await request(app).get("/api/trades");
    expect(res.status).toBe(401);
  });

  it("GET blocks a user with no active license", async () => {
    setAuthedUser("user_1");
    mockDb.resolveNext(undefined); // requireAuth touchLastLogin fire-and-forget update
    mockDb.resolveNext([{ licenseEnforcementEnabled: true }]);
    mockDb.resolveNext([]); // no active license

    const res = await request(app).get("/api/trades");
    expect(res.status).toBe(403);
  });

  it("GET returns only the caller's trades", async () => {
    setAuthedUser("user_1b");
    queueLicenseAllowed();
    mockDb.resolveNext([
      { id: 1, userId: "user_1b", tradeDate: "2026-01-01", direction: "Buy", status: "Open", createdAt: new Date() },
    ]);

    const res = await request(app).get("/api/trades");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].userId).toBe("user_1b");
  });

  it("PATCH on a trade owned by someone else returns 404, not the other user's data", async () => {
    setAuthedUser("attacker");
    queueLicenseAllowed();
    // The real query filters by `and(eq(id), eq(userId))`, so a mismatched
    // owner yields no row back from the DB. The route must translate that
    // into 404, not silently succeed.
    mockDb.resolveNext([]); // update ... where(id AND userId) -> no match

    const res = await request(app)
      .patch("/api/trades/42")
      .send({ notes: "trying to edit someone else's trade" });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Trade not found" });
  });

  it("PATCH on the caller's own trade succeeds", async () => {
    setAuthedUser("owner_1");
    queueLicenseAllowed();
    mockDb.resolveNext([
      { id: 42, userId: "owner_1", tradeDate: "2026-01-01", direction: "Buy", status: "Open", notes: "updated", createdAt: new Date() },
    ]);

    const res = await request(app).patch("/api/trades/42").send({ notes: "updated" });
    expect(res.status).toBe(200);
    expect(res.body.notes).toBe("updated");
  });

  it("DELETE requires a numeric trade id", async () => {
    setAuthedUser("owner_1b");
    queueLicenseAllowed();

    const res = await request(app).delete("/api/trades/not-a-number");
    expect(res.status).toBe(400);
  });

  it("DELETE only ever targets the caller's own trade (scoped by userId in the query)", async () => {
    setAuthedUser("owner_2");
    queueLicenseAllowed();
    mockDb.resolveNext(undefined); // delete ... where(id AND userId) -- not destructured

    const res = await request(app).delete("/api/trades/7");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
  });

  it("POST rejects an invalid body", async () => {
    setAuthedUser("owner_3");
    queueLicenseAllowed();

    const res = await request(app).post("/api/trades").send({ direction: "Buy" }); // missing tradeDate
    expect(res.status).toBe(400);
  });

  it("POST creates a trade tagged with the authenticated user's id, not a client-supplied one", async () => {
    setAuthedUser("owner_4");
    queueLicenseAllowed();
    mockDb.resolveNext([
      { id: 99, userId: "owner_4", tradeDate: "2026-01-01", direction: "Buy", status: "Pending", createdAt: new Date() },
    ]);

    const res = await request(app)
      .post("/api/trades")
      // client tries to spoof someone else's userId in the body — the route
      // never reads it; it uses the authenticated user's id instead.
      .send({ tradeDate: "2026-01-01", direction: "Buy", userId: "someone_else" });

    expect(res.status).toBe(201);
    expect(res.body.userId).toBe("owner_4");
  });

  it("hides internal error details from the client on an unexpected 5xx (e.g. a DB failure)", async () => {
    setAuthedUser("owner_5");
    queueLicenseAllowed();
    mockDb.rejectNext(new Error("connect ECONNREFUSED 10.1.4.22:5432 — internal db host"));

    const res = await request(app).get("/api/trades");

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Internal server error" });
    expect(JSON.stringify(res.body)).not.toContain("10.1.4.22");
  });
});
