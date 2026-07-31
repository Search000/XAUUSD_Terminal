import { Link, useLocation } from "wouter";
import { useUser, useClerk } from "@clerk/react";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { LayoutDashboard, Key, Users, LogOut, Tag, Settings2, Phone, Bell, Activity, Star, MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";

const links = [
  { href: "/dashboard",        label: "Dashboard",        icon: LayoutDashboard },
  { href: "/licenses",         label: "Licenses",         icon: Key },
  { href: "/users",            label: "Users",            icon: Users },
  { href: "/activity",         label: "Activity Log",     icon: Activity },
  { href: "/offers",           label: "Offers",           icon: Tag },
  { href: "/contact-requests", label: "Contact Requests", icon: Phone },
  { href: "/notifications",    label: "Announcements",    icon: Bell },
  { href: "/feedback",         label: "Feedback",         icon: Star },
  { href: "/support",          label: "Support",          icon: MessageCircle },
  { href: "/settings",         label: "Settings",         icon: Settings2 },
];

export function Sidebar() {
  const [location] = useLocation();
  const { user } = useUser();
  const { signOut } = useClerk();

  const { data: unreadData } = useQuery({
    queryKey: ["admin", "support-unread"],
    queryFn: () => customFetch<{ count: number }>("/api/admin/support/unread-count"),
    refetchInterval: 30000,
  });
  const unreadCount = unreadData?.count ?? 0;

  return (
    <aside className="fixed inset-y-0 left-0 z-50 w-64 border-r border-sidebar-border bg-sidebar text-sidebar-foreground flex flex-col">
      <div className="h-16 flex items-center px-6 border-b border-sidebar-border">
        <div className="flex items-center gap-2 text-primary font-bold text-xl tracking-tighter">
          <span className="bg-primary text-primary-foreground px-2 py-0.5 rounded text-sm">XAU</span>
          <span>ADMIN</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-6 px-3 space-y-1">
        {links.map((link) => (
          <Link key={link.href} href={link.href} className={cn(
            "flex items-center gap-3 px-3 py-2 rounded-md transition-colors cursor-pointer",
            location === link.href ? "bg-sidebar-primary/10 text-sidebar-primary font-medium" : "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground text-muted-foreground"
          )}>
            <link.icon className="h-4 w-4 flex-shrink-0" />
            <span className="flex-1">{link.label}</span>
            {link.href === "/support" && unreadCount > 0 && (
              <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-primary text-black text-xs font-bold px-1.5">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </Link>
        ))}
      </div>

      <div className="p-4 border-t border-sidebar-border">
        <div className="flex items-center gap-3 mb-4 px-2">
          {user?.imageUrl ? (
            <img src={user.imageUrl} alt={user.fullName || "User"} className="h-8 w-8 rounded-full border border-sidebar-border" />
          ) : (
            <div className="h-8 w-8 rounded-full border border-sidebar-border bg-muted flex items-center justify-center text-xs">
              U
            </div>
          )}
          <div className="flex flex-col overflow-hidden">
            <span className="text-sm font-medium truncate">{user?.fullName || user?.primaryEmailAddress?.emailAddress}</span>
            <span className="text-xs text-muted-foreground truncate font-mono">{user?.primaryEmailAddress?.emailAddress}</span>
          </div>
        </div>
        <button 
          onClick={() => signOut({ redirectUrl: import.meta.env.BASE_URL || "/" })}
          className="flex w-full items-center gap-3 px-3 py-2 rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors text-sm"
        >
          <LogOut className="h-4 w-4" />
          Sign Out
        </button>
      </div>
    </aside>
  );
}
