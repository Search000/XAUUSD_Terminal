import { Router, type Request, type Response, type NextFunction } from "express";
import { db } from "@workspace/db";
import {
  opsDevSuggestions,
  opsSuggestions,
  opsMistakes,
  opsActions,
} from "@workspace/db";
import { eq, desc, sql, ilike } from "drizzle-orm";
import { requirePermission } from "../lib/permissions";

const router = Router();

function requireWorkerSecret(req: Request, res: Response, next: NextFunction) {
  const secret = req.header("x-ops-agent-secret");
  if (!secret || secret !== process.env.OPS_AGENT_SHARED_SECRET) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
}
function requireOpsAccess(req: Request, res: Response, next: NextFunction) {
  const secret = req.header("x-ops-agent-secret");
  if (secret && secret === process.env.OPS_AGENT_SHARED_SECRET) {
    next();
    return;
  }
  requirePermission("manage_ops_agent")(req, res, next);
}

// ===========================================================================
// Phase 4 — Dev Assist (all read-only advisory, nothing auto-applied)
// ===========================================================================

// POST /api/ops/dev/suggestions — worker stores a fix/changelog/test/review suggestion
router.post("/dev/suggestions", requireWorkerSecret, async (req, res) => {
  const { type, sourceRef, title, content } = req.body ?? {};
  if (!type || !title || !content) {
    return res.status(400).json({ error: "type, title, content required" });
  }
  const [row] = await db
    .insert(opsDevSuggestions)
    .values({ type, sourceRef: sourceRef ?? null, title, content })
    .returning();
  res.status(201).json({ suggestion: row });
  return;
});

// GET /api/ops/dev/suggestions?type=fix_suggestion&status=new
router.get("/dev/suggestions", requireOpsAccess, async (req, res) => {
  const rows = await db.select().from(opsDevSuggestions).orderBy(desc(opsDevSuggestions.createdAt)).limit(100);
  const { type, status } = req.query;
  const filtered = rows.filter(
    (r) => (!type || r.type === type) && (!status || r.status === status)
  );
  res.json({ suggestions: filtered });
});

// PATCH /api/ops/dev/suggestions/:id — owner marks reviewed/applied/dismissed
router.patch("/dev/suggestions/:id", requireOpsAccess, async (req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body ?? {};
  if (!["reviewed", "applied", "dismissed"].includes(status)) {
    return res.status(400).json({ error: "status must be reviewed|applied|dismissed" });
  }
  const [row] = await db.update(opsDevSuggestions).set({ status }).where(eq(opsDevSuggestions.id, id)).returning();
  if (!row) { res.status(404).json({ error: "not found" }); return; }
  res.json({ suggestion: row });
  return;
});

// NOTE: GitHub read (recent commits/PRs) + npm-audit summary happen in the
// WORKER (has fetch + AI), not here — this router just stores results.
// Worker needs a GITHUB_TOKEN secret (read-only, repo scope) to call:
//   GET https://api.github.com/repos/{owner}/{repo}/commits
//   GET https://api.github.com/repos/{owner}/{repo}/pulls
// See worker/src/phase4-dev-assist.ts for the fetch + AI-summarize logic.

// ===========================================================================
// Phase 5 — Self-Learning
// ===========================================================================

// POST /api/ops/mistakes — log a failed/rolled-back fix attempt
router.post("/mistakes", requireOpsAccess, async (req, res) => {
  const { actionId, problem, triedFix, result, rootCause } = req.body ?? {};
  if (!problem || !triedFix || !result) {
    return res.status(400).json({ error: "problem, triedFix, result required" });
  }
  const [row] = await db
    .insert(opsMistakes)
    .values({ actionId: actionId ?? null, problem, triedFix, result, rootCause: rootCause ?? null })
    .returning();
  res.status(201).json({ mistake: row });
  return;
});

// GET /api/ops/mistakes?like=stale+feed — check memory BEFORE proposing a fix.
// Worker calls this first; if a similar problem already failed with a given
// fix, it should try a different approach instead of repeating it.
router.get("/mistakes", requireOpsAccess, async (req, res) => {
  const q = (req.query.like as string) || "";
  const rows = q
    ? await db.select().from(opsMistakes).where(ilike(opsMistakes.problem, `%${q}%`)).orderBy(desc(opsMistakes.createdAt)).limit(20)
    : await db.select().from(opsMistakes).orderBy(desc(opsMistakes.createdAt)).limit(20);
  res.json({ mistakes: rows });
});

// POST /api/ops/actions/:id/verify-outcome — worker re-checks health after an
// executed action and records whether it actually fixed the problem.
router.post("/actions/:id/verify-outcome", requireWorkerSecret, async (req, res) => {
  const id = Number(req.params.id);
  const { success } = req.body ?? {};
  if (typeof success !== "boolean") { res.status(400).json({ error: "success (boolean) required" }); return; }

  const [row] = await db
    .update(opsActions)
    .set({ outcomeVerified: true, outcomeSuccess: success })
    .where(eq(opsActions.id, id))
    .returning();
  if (!row) { res.status(404).json({ error: "not found" }); return; }

  // Auto-log a mistake entry when a fix didn't work, so future proposals avoid repeating it.
  if (!success) {
    await db.insert(opsMistakes).values({
      actionId: id,
      problem: row.description,
      triedFix: row.actionType,
      result: "fail",
    });
  }

  res.json({ action: row });
  return;
});

// GET /api/ops/confidence?actionType=cache_clear — success rate for a fix type
router.get("/confidence", requireOpsAccess, async (req, res) => {
  const actionType = req.query.actionType as string | undefined;
  if (!actionType) { res.status(400).json({ error: "actionType required" }); return; }

  const rows = await db
    .select({
      total: sql<number>`count(*)`,
      successes: sql<number>`count(*) filter (where outcome_success = true)`,
    })
    .from(opsActions)
    .where(eq(opsActions.actionType, actionType));

  const { total, successes } = rows[0] ?? { total: 0, successes: 0 };
  const rate = total > 0 ? successes / total : null;
  res.json({ actionType, total, successes, successRate: rate });
  return;
});

// GET /api/ops/self-audit/data — raw numbers for worker's weekly self-audit report
router.get("/self-audit/data", requireWorkerSecret, async (_req, res) => {
  const byType = await db
    .select({
      actionType: opsActions.actionType,
      total: sql<number>`count(*)`,
      successes: sql<number>`count(*) filter (where outcome_success = true)`,
      failures: sql<number>`count(*) filter (where outcome_success = false)`,
    })
    .from(opsActions)
    .groupBy(opsActions.actionType);

  res.json({ byActionType: byType });
});

// ===========================================================================
// Phase 6 — Product Advisory (suggestion-only, nothing auto-applied)
// ===========================================================================

// POST /api/ops/suggestions — worker proposes a UI/UX/feature suggestion
router.post("/suggestions", requireWorkerSecret, async (req, res) => {
  const { what, why, impact, timing, priority, effort, effortImpactNote, area } = req.body ?? {};
  if (!what || !why || !impact || !timing || !priority) {
    return res.status(400).json({ error: "what, why, impact, timing, priority required" });
  }
  const [row] = await db
    .insert(opsSuggestions)
    .values({ what, why, impact, timing, priority, effort, effortImpactNote, area })
    .returning();
  res.status(201).json({ suggestion: row });
  return;
});

// GET /api/ops/suggestions?priority=urgent — admin panel "what should I build next" list
router.get("/suggestions", requireOpsAccess, async (req, res) => {
  const rows = await db.select().from(opsSuggestions).orderBy(desc(opsSuggestions.createdAt)).limit(200);
  const priority = req.query.priority as string | undefined;
  res.json({ suggestions: priority ? rows.filter((r) => r.priority === priority) : rows });
});

// PATCH /api/ops/suggestions/:id — owner marks reviewed/dismissed
router.patch("/suggestions/:id", requireOpsAccess, async (req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body ?? {};
  if (!["reviewed", "dismissed"].includes(status)) {
    return res.status(400).json({ error: "status must be reviewed|dismissed" });
  }
  const [row] = await db.update(opsSuggestions).set({ status }).where(eq(opsSuggestions.id, id)).returning();
  if (!row) { res.status(404).json({ error: "not found" }); return; }
  res.json({ suggestion: row });
  return;
});

export default router;
