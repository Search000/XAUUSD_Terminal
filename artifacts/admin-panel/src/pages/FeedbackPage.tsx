import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Star, MessageSquare } from "lucide-react";
import { format } from "date-fns";

type FeedbackRow = {
  id: number;
  userId: string;
  email: string;
  rating: number;
  comment: string | null;
  createdAt: string;
};

async function getFeedback(): Promise<FeedbackRow[]> {
  return customFetch<FeedbackRow[]>("/api/admin/feedback");
}

function StarDisplay({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1,2,3,4,5].map(n => (
        <Star
          key={n}
          className={`w-3.5 h-3.5 ${n <= rating ? "text-primary fill-primary" : "text-muted-foreground/30"}`}
        />
      ))}
      <span className="ml-1.5 text-xs font-mono font-bold text-primary">{rating}/5</span>
    </div>
  );
}

export function FeedbackPage() {
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["admin", "feedback"],
    queryFn: getFeedback,
  });

  const avg = rows.length
    ? (rows.reduce((s, r) => s + r.rating, 0) / rows.length).toFixed(1)
    : "—";

  const dist = [5, 4, 3, 2, 1].map(star => ({
    star,
    count: rows.filter(r => r.rating === star).length,
    pct: rows.length ? Math.round((rows.filter(r => r.rating === star).length / rows.length) * 100) : 0,
  }));

  return (
    <div className="p-6 space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">User Feedback</h2>
        <p className="text-muted-foreground">Ratings submitted by trial users.</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Average Rating */}
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="pt-6 flex items-center gap-6">
            <div className="text-center">
              <p className="text-5xl font-bold font-mono text-primary">{avg}</p>
              <div className="flex items-center justify-center gap-0.5 mt-1">
                {[1,2,3,4,5].map(n => (
                  <Star
                    key={n}
                    className={`w-4 h-4 ${n <= Math.round(Number(avg)) ? "text-primary fill-primary" : "text-muted-foreground/30"}`}
                  />
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-1">{rows.length} review{rows.length !== 1 ? "s" : ""}</p>
            </div>

            {/* Distribution bars */}
            <div className="flex-1 space-y-1.5">
              {dist.map(({ star, count, pct }) => (
                <div key={star} className="flex items-center gap-2">
                  <span className="text-xs font-mono text-muted-foreground w-4">{star}</span>
                  <Star className="w-3 h-3 text-primary fill-primary shrink-0" />
                  <div className="flex-1 h-1.5 bg-secondary rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-xs font-mono text-muted-foreground w-6 text-right">{count}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* With comments */}
        <Card>
          <CardContent className="pt-6 flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-secondary flex items-center justify-center shrink-0">
              <MessageSquare className="w-6 h-6 text-muted-foreground" />
            </div>
            <div>
              <p className="text-3xl font-bold font-mono">{rows.filter(r => r.comment).length}</p>
              <p className="text-sm text-muted-foreground">with written comments</p>
              <p className="text-xs text-muted-foreground/60 mt-1">out of {rows.length} total submissions</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle>All Submissions</CardTitle>
          <CardDescription>Most recent first.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Rating</TableHead>
                <TableHead>Comment</TableHead>
                <TableHead>Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(row => (
                <TableRow key={row.id}>
                  <TableCell className="font-mono text-sm">{row.email || <span className="text-muted-foreground italic">—</span>}</TableCell>
                  <TableCell><StarDisplay rating={row.rating} /></TableCell>
                  <TableCell className="text-sm text-muted-foreground max-w-xs">
                    {row.comment || <span className="italic text-muted-foreground/50">No comment</span>}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {format(new Date(row.createdAt), "dd MMM yyyy, HH:mm")}
                  </TableCell>
                </TableRow>
              ))}
              {!isLoading && rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground p-10">
                    No feedback yet. Feedback appears here after trial users submit ratings.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
