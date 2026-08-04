import { vi } from "vitest";

/**
 * A minimal fake of the drizzle-orm fluent query builder.
 *
 * Routes call `db.select()/.insert()/.update()/.delete()` and chain methods
 * like `.from()/.where()/.orderBy()/.limit()/.offset()/.values()/.set()/
 * `.returning()/.onConflictDoUpdate()/.innerJoin()` before finally `await`ing
 * (or `.catch()`ing) the chain.
 *
 * Rather than reimplement SQL semantics, tests queue up the value each
 * top-level `db.<verb>()` call should resolve to (in call order), and this
 * helper returns a chainable thenable that resolves to that queued value no
 * matter how many builder methods are chained on top of it.
 */

type QueuedResult =
  | { type: "resolve"; value: unknown }
  | { type: "reject"; error: unknown };

function createChain(result: QueuedResult) {
  const chain: Record<string, unknown> = {};

  const chainable = [
    "from",
    "where",
    "orderBy",
    "limit",
    "offset",
    "values",
    "set",
    "onConflictDoUpdate",
    "innerJoin",
    "leftJoin",
    "groupBy",
    "having",
    "returning",
  ];

  for (const method of chainable) {
    chain[method] = vi.fn(() => chain);
  }

  chain.then = (
    onFulfilled?: (value: unknown) => unknown,
    onRejected?: (reason: unknown) => unknown,
  ) => {
    if (result.type === "reject") {
      return Promise.reject(result.error).then(onFulfilled, onRejected);
    }
    return Promise.resolve(result.value).then(onFulfilled, onRejected);
  };
  chain.catch = (onRejected?: (reason: unknown) => unknown) => {
    if (result.type === "reject") {
      return Promise.reject(result.error).catch(onRejected);
    }
    return Promise.resolve(result.value).catch(onRejected);
  };
  chain.finally = (onFinally?: () => void) => {
    return Promise.resolve(result.type === "resolve" ? result.value : Promise.reject(result.error)).finally(onFinally);
  };

  return chain;
}

export function createMockDb() {
  const queue: QueuedResult[] = [];

  function nextChain() {
    const result = queue.shift();
    if (!result) {
      throw new Error(
        "mockDb: a db call was made but no queued result is available. " +
          "Call mockDb.resolveNext(value) once for every db.select/insert/update/delete " +
          "the route under test is expected to perform, in order.",
      );
    }
    return createChain(result);
  }

  const db = {
    select: vi.fn(() => nextChain()),
    insert: vi.fn(() => nextChain()),
    update: vi.fn(() => nextChain()),
    delete: vi.fn(() => nextChain()),
  };

  return {
    db,
    /** Queue the value the next db call should resolve to. */
    resolveNext(value: unknown) {
      queue.push({ type: "resolve", value });
    },
    /** Queue an error the next db call should reject with. */
    rejectNext(error: unknown) {
      queue.push({ type: "reject", error });
    },
    /** Number of still-unconsumed queued results (helps catch test bugs). */
    pendingCount() {
      return queue.length;
    },
    reset() {
      queue.length = 0;
      db.select.mockClear();
      db.insert.mockClear();
      db.update.mockClear();
      db.delete.mockClear();
    },
  };
}

export type MockDb = ReturnType<typeof createMockDb>;
