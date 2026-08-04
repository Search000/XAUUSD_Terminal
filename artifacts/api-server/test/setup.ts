import { vi } from "vitest";
import { createMockDb } from "./helpers/mockDb";
import { makeClerkExpressMock } from "./helpers/mockClerk";

// Single shared mock db instance for the lifetime of a test file. Each test
// pushes the results it expects db calls to resolve to via mockDb.resolveNext(),
// and should call mockDb.reset() in beforeEach for isolation.
export const mockDb = createMockDb();

vi.mock("@workspace/db", async () => {
  // Pull in the *real* schema (table definitions only — no DB connection,
  // since "@workspace/db/schema" doesn't touch src/index.ts / DATABASE_URL).
  const schema = await vi.importActual<typeof import("@workspace/db/schema")>(
    "@workspace/db/schema",
  );
  return { ...schema, db: mockDb.db, pool: {} };
});

vi.mock("@clerk/express", () => makeClerkExpressMock());
