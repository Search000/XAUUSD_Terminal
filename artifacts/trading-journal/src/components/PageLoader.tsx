import { Activity } from "lucide-react";

export function PageLoader({ message = "LOADING..." }: { message?: string }) {
  return (
    <div className="flex-1 flex items-center justify-center min-h-[300px]">
      <div className="flex flex-col items-center gap-3">
        <Activity className="w-7 h-7 text-primary animate-pulse" />
        <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest">{message}</p>
      </div>
    </div>
  );
}

export function TableLoader({ colSpan = 6 }: { colSpan?: number }) {
  return (
    <tr>
      <td colSpan={colSpan} className="h-32 text-center">
        <div className="flex flex-col items-center justify-center gap-2">
          <Activity className="w-5 h-5 text-primary animate-pulse" />
          <span className="text-xs font-mono text-muted-foreground uppercase tracking-widest">Loading...</span>
        </div>
      </td>
    </tr>
  );
}
