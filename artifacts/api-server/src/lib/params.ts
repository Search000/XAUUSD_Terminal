/**
 * Express 5's route param type is `string | string[]` (a param can appear
 * more than once when a path segment repeats, e.g. `/:id/:id`). Our routes
 * never intentionally rely on that — they expect a single value — so this
 * takes the first occurrence and normalizes to a plain string.
 */
export function paramToString(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}
