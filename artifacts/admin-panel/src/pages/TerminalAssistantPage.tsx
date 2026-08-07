import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ThumbsUp, ThumbsDown, MessageCircle } from "lucide-react";
import { format } from "date-fns";

type AssistantFeedbackRow = {
  id: number;
  userId: string;
  userEmail: string;
  content: string;
  feedback: "up" | "down";
  feedbackNote: string | null;
  createdAt: string;
};

async function getAssistantFeedback(): Promise<AssistantFeedbackRow[]> {
  return customFetch<AssistantFeedbackRow[]>("/api/admin/assistant-feedback");
}

export function TerminalAssistantPage() {
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["admin", "assistant-feedback"],
    queryFn: getAssistantFeedback,
  });

  const upCount = rows.filter((r) => r.feedback === "up").length;
  const downCount = rows.filter((r) => r.feedback === "down").length;

  return (
    <div className="p-6 space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Terminal Assistant</h2>
        <p className="text-muted-foreground">Feedback users left on Junior's replies.</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <ThumbsUp className="w-4 h-4 text-green-500" />
              Positive
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold font-mono text-green-500">{upCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <ThumbsDown className="w-4 h-4 text-red-500" />
              Negative
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold font-mono text-red-500">{downCount}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <MessageCircle className="w-4 h-4" />
            Rated Replies
          </CardTitle>
          <CardDescription>Most recent 200 rated messages, newest first.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No feedback yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Reply</TableHead>
                  <TableHead>Rating</TableHead>
                  <TableHead>Note</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{r.userEmail}</TableCell>
                    <TableCell className="text-xs max-w-md truncate" title={r.content}>{r.content}</TableCell>
                    <TableCell>
                      {r.feedback === "up" ? (
                        <ThumbsUp className="w-4 h-4 text-green-500" />
                      ) : (
                        <ThumbsDown className="w-4 h-4 text-red-500" />
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-xs">
                      {r.feedbackNote || "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {format(new Date(r.createdAt), "MMM d, HH:mm")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
