import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import "../setup";
import { mockDb } from "../setup";
import { setAuthedUser, setSignedOut, getUserMock, resetClerkMock } from "../helpers/mockClerk";
import app from "../../src/app";

describe("POST /api/licenses/activate", () => {
  beforeEach(() => {
    mockDb.reset();
    resetClerkMock();
  });

  it("requires authentication", async () => {
    setSignedOut();
    const res = await request(app).post("/api/licenses/activate").send({ licenseCode: "ABC" });
    expect(res.status).toBe(401);
  });

  it("rejects an unknown license code", async () => {
    setAuthedUser("user_1");
    getUserMock.mockResolvedValueOnce({ id: "user_1", emailAddresses: [{ emailAddress: "u1@example.com" }] });

    mockDb.resolveNext(undefined); // requireAuth touchLastLogin fire-and-forget update
    // upsertUser(): getClerkEmail (mocked above, no db call) then db.insert().onConflictDoUpdate()
    mockDb.resolveNext(undefined);
    // license lookup by code -> none found
    mockDb.resolveNext([]);

    const res = await request(app)
      .post("/api/licenses/activate")
      .send({ licenseCode: "DOES-NOT-EXIST" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Invalid license code" });
  });

  it("rejects a license already in use by a different user", async () => {
    setAuthedUser("user_2");
    getUserMock.mockResolvedValueOnce({ id: "user_2", emailAddresses: [{ emailAddress: "u2@example.com" }] });

    mockDb.resolveNext(undefined); // requireAuth touchLastLogin fire-and-forget update
    mockDb.resolveNext(undefined); // upsertUser insert
    mockDb.resolveNext([
      { id: 1, licenseCode: "TAKEN-CODE", isRevoked: false, isActive: true, usedByUserId: "someone_else", durationDays: 30 },
    ]);

    const res = await request(app).post("/api/licenses/activate").send({ licenseCode: "TAKEN-CODE" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "This license is already in use" });
  });

  it("activates a valid, unused license for the requesting user", async () => {
    setAuthedUser("user_3");
    getUserMock.mockResolvedValueOnce({ id: "user_3", emailAddresses: [{ emailAddress: "u3@example.com" }] });

    mockDb.resolveNext(undefined); // requireAuth touchLastLogin fire-and-forget update
    mockDb.resolveNext(undefined); // upsertUser insert
    mockDb.resolveNext([
      { id: 2, licenseCode: "FRESH-CODE", isRevoked: false, isActive: false, usedByUserId: null, durationDays: 30 },
    ]); // license lookup
    mockDb.resolveNext([{ userId: "user_3", email: "u3@example.com" }]); // userRow lookup
    mockDb.resolveNext(undefined); // the update() itself (not destructured)
    mockDb.resolveNext([{ licenseEnforcementEnabled: true }]); // system settings

    const res = await request(app).post("/api/licenses/activate").send({ licenseCode: "fresh-code" });

    expect(res.status).toBe(200);
    expect(res.body.hasLicense).toBe(true);
    expect(res.body.isActive).toBe(true);
    expect(res.body.daysRemaining).toBe(30);
  });
});

describe("POST /api/licenses/trial", () => {
  beforeEach(() => {
    mockDb.reset();
    resetClerkMock();
  });

  it("requires authentication", async () => {
    setSignedOut();
    const res = await request(app).post("/api/licenses/trial");
    expect(res.status).toBe(401);
  });

  it("refuses to grant a trial when trial mode is disabled", async () => {
    setAuthedUser("user_4");
    getUserMock.mockResolvedValueOnce({ id: "user_4", emailAddresses: [{ emailAddress: "u4@example.com" }] });

    mockDb.resolveNext(undefined); // requireAuth touchLastLogin fire-and-forget update
    mockDb.resolveNext(undefined); // upsertUser insert
    mockDb.resolveNext([{ trialModeEnabled: false }]); // system settings

    const res = await request(app).post("/api/licenses/trial");

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "Trial mode is currently disabled by admin." });
  });

  it("refuses a second trial for a user who already used one", async () => {
    setAuthedUser("user_5");
    getUserMock.mockResolvedValueOnce({ id: "user_5", emailAddresses: [{ emailAddress: "u5@example.com" }] });

    mockDb.resolveNext(undefined); // requireAuth touchLastLogin fire-and-forget update
    mockDb.resolveNext(undefined); // upsertUser insert
    mockDb.resolveNext([{ trialModeEnabled: true, trialDurationDays: 7 }]); // system settings
    mockDb.resolveNext([{ id: 9, transactionCode: "TRIAL", usedByUserId: "user_5" }]); // existing trial found

    const res = await request(app).post("/api/licenses/trial");

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "You have already used your free trial." });
  });

  it("grants a fresh trial to a first-time user", async () => {
    setAuthedUser("user_6");
    getUserMock.mockResolvedValueOnce({ id: "user_6", emailAddresses: [{ emailAddress: "u6@example.com" }] });

    mockDb.resolveNext(undefined); // requireAuth touchLastLogin fire-and-forget update
    mockDb.resolveNext(undefined); // upsertUser insert
    mockDb.resolveNext([{ trialModeEnabled: true, trialDurationDays: 7, licenseEnforcementEnabled: true }]); // system settings
    mockDb.resolveNext([]); // no existing trial
    mockDb.resolveNext([{ userId: "user_6", email: "u6@example.com" }]); // userRow lookup
    mockDb.resolveNext([
      {
        licenseCode: "TRIAL-ABC-123",
        durationDays: 7,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        activatedAt: new Date(),
      },
    ]); // insert trial license .returning()

    const res = await request(app).post("/api/licenses/trial");

    expect(res.status).toBe(201);
    expect(res.body.isTrial).toBe(true);
    expect(res.body.daysRemaining).toBe(7);
  });
});

describe("GET /api/licenses (admin only)", () => {
  beforeEach(() => {
    mockDb.reset();
    resetClerkMock();
  });

  it("returns 401 for signed-out requests", async () => {
    setSignedOut();
    const res = await request(app).get("/api/licenses");
    expect(res.status).toBe(401);
  });

  it("returns 403 for a signed-in non-admin user", async () => {
    setAuthedUser("user_regular");
    getUserMock.mockResolvedValueOnce({ id: "user_regular", emailAddresses: [{ emailAddress: "regular@example.com" }] });
    mockDb.resolveNext(undefined); // requireAuth touchLastLogin fire-and-forget update
    mockDb.resolveNext([]); // requireAdmin's DB fallback lookup -> no admin row

    const res = await request(app).get("/api/licenses");
    expect(res.status).toBe(403);
  });

  it("returns the license list for an admin user", async () => {
    setAuthedUser("user_admin");
    // Use an email NOT in ADMIN_EMAILS so requireAdmin takes its DB-fallback
    // path (a single, synchronous-order-friendly `isAdmin` row lookup)
    // instead of the fast path, which fires a background upsertUser() call
    // whose timing relative to the route handler's own query is unpredictable.
    getUserMock.mockResolvedValueOnce({ id: "user_admin", emailAddresses: [{ emailAddress: "user_admin@example.com" }] });
    mockDb.resolveNext(undefined); // requireAuth touchLastLogin fire-and-forget update
    mockDb.resolveNext([{ userId: "user_admin", isAdmin: true }]); // requireAdmin DB-fallback lookup
    mockDb.resolveNext([
      { id: 1, licenseCode: "AAA-BBB-CCC", transactionCode: "TXN1", durationDays: 30, isActive: true, isRevoked: false, createdAt: new Date() },
    ]); // GET /api/licenses select

    const res = await request(app).get("/api/licenses");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].licenseCode).toBe("AAA-BBB-CCC");
  });
});
