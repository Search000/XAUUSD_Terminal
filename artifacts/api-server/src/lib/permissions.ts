import { Request, Response, NextFunction } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { usersTable, STAFF_ROLES, type StaffRole, type UserRole } from "@workspace/db";
import { eq } from "drizzle-orm";

/**
 * Role-based access control for the admin panel.
 *
 * Roles (least → most powerful): viewer, support, moderator, admin, owner.
 * "owner" is reserved for ADMIN_EMAILS (lib/auth.ts) and can't be reassigned
 * away by anyone else — see requirePermission("manage_roles").
 */
export const PERMISSIONS = [
  "view_dashboard",
  "view_users",
  "view_licenses",
  "manage_licenses",
  "manage_offers",
  "manage_settings",
  "manage_notifications",
  "manage_support",
  "manage_feedback",
  "manage_contact_requests",
  "manage_roles",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** What each staff role is allowed to do. Human-readable copy lives in ROLE_DESCRIPTIONS below —
 *  keep both in sync when adding/removing a permission from a role. */
export const ROLE_PERMISSIONS: Record<StaffRole, Permission[]> = {
  owner: [...PERMISSIONS],
  admin: PERMISSIONS.filter((p) => p !== "manage_roles"),
  moderator: [
    "view_dashboard", "view_users", "view_licenses", "manage_licenses",
    "manage_offers", "manage_support", "manage_feedback", "manage_contact_requests",
  ],
  support: ["view_dashboard", "manage_support", "manage_feedback", "manage_contact_requests"],
  viewer: ["view_dashboard", "view_users", "view_licenses"],
};

/** One-line description of what each role can do, shown in the admin panel. */
export const ROLE_DESCRIPTIONS: Record<StaffRole, string> = {
  owner: "Full control, including assigning roles to other staff. Reserved for the account owner.",
  admin: "Full control over users, licenses, offers, settings, notifications and support — cannot change staff roles.",
  moderator: "Manage users, licenses, offers, support and feedback — no access to system settings or broadcasts.",
  support: "Handle support messages, feedback and contact requests only.",
  viewer: "Read-only — can view the dashboard, users and licenses, no changes allowed.",
};

export function hasPermission(role: UserRole, permission: Permission): boolean {
  if (role === "user") return false;
  return ROLE_PERMISSIONS[role].includes(permission);
}

/** Require the signed-in user's staff role to grant `permission`. 401 if signed out, 403 if lacking. */
export function requirePermission(permission: Permission) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const { userId } = getAuth(req);
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    try {
      const [user] = await db.select().from(usersTable).where(eq(usersTable.userId, userId));
      if (user && hasPermission(user.role, permission)) {
        next();
        return;
      }
    } catch {
      // fall through to deny
    }
    res.status(403).json({ error: "Forbidden – insufficient role" });
  };
}

export function isStaffRole(value: string): value is StaffRole {
  return (STAFF_ROLES as readonly string[]).includes(value);
}
