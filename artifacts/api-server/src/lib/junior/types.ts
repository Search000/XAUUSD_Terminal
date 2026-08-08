/**
 * Junior tool-layer types.
 *
 * A JuniorTool wraps one piece of real application data/functionality
 * (market data, technicals, user trades, etc.) behind a uniform call
 * signature so an orchestrator (future work — not implemented yet) can
 * invoke tools by name without knowing their internals.
 *
 * Rules baked into this layer (see JUNIOR spec):
 * - Tools must return real data or a typed failure — never fabricate.
 * - Tools that touch user-specific data must be given a userId and must
 *   only return that user's own data.
 */

export interface JuniorToolContext {
  /** Clerk user id of the person Junior is chatting with. Required for any
   *  tool that reads user-specific data (trades, stats, etc). */
  userId?: string;
}

export type JuniorToolResult<T> =
  | { ok: true; data: T; stale?: boolean }
  | { ok: false; error: string };

export interface JuniorTool<TArgs = void, TResult = unknown> {
  name: string;
  description: string;
  /** Set true for tools that require ctx.userId (enforced by the caller). */
  requiresAuth: boolean;
  run: (args: TArgs, ctx: JuniorToolContext) => Promise<JuniorToolResult<TResult>>;
}
