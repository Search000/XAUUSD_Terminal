import { RequestHandler, Request, Response, NextFunction } from "express";

/**
 * Wraps an async Express route handler so that any unhandled rejection is
 * forwarded to next() instead of crashing the process or hanging the request.
 *
 * Express 4 does NOT catch async errors automatically — without this wrapper
 * a rejected promise leaves the request hanging indefinitely.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
