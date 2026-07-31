import { Badge } from "@/components/ui/badge";
import { differenceInDays, isPast } from "date-fns";

export function LicenseStatusBadge({ license }: { license: any }) {
  if (license.isRevoked) {
    return <Badge variant="destructive">REVOKED</Badge>;
  }
  if (!license.isActive) {
    return <Badge variant="secondary">UNUSED</Badge>;
  }
  if (license.expiresAt && isPast(new Date(license.expiresAt))) {
    return <Badge className="border-amber-500/30 bg-amber-500/10 text-amber-400">EXPIRED</Badge>;
  }
  return <Badge className="border-green-500/30 bg-green-500/10 text-green-400">ACTIVE</Badge>;
}

export function formatDaysLeft(expiresAt: string | null) {
  if (!expiresAt) return <span className="text-muted-foreground">-</span>;
  const days = differenceInDays(new Date(expiresAt), new Date());
  if (days < 0) return <span className="text-destructive">Expired</span>;
  return <span className="data-number">{days}d</span>;
}
