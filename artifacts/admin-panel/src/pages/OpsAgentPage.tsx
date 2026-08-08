import { useState, useRef, useEffect } from "react";
import { customFetch } from "@workspace/api-client-react";

// Worker URL — set via admin-panel env, e.g. VITE_OPS_AGENT_WORKER_URL
const WORKER_URL = import.meta.env.VITE_OPS_AGENT_WORKER_URL as string;

type ChatMsg = { role: "user" | "bot"; text: string; suggestions?: string[] };

function parseReply(raw: string): { text: string; suggestions: string[] } {
  const match = raw.match(/<suggestions>(.*?)<\/suggestions>/s);
  if (!match) return { text: raw.trim(), suggestions: [] };
  const suggestions = match[1].split("|").map((s) => s.trim()).filter(Boolean);
  const text = raw.replace(match[0], "").trim();
  return { text, suggestions };
}

type PendingAction = {
  id: number;
  actionType: string;
  description: string;
  reasoning: string | null;
  status: string;
};

export function OpsAgentPage() {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<PendingAction[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadPending();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function loadPending() {
    try {
      const data = await customFetch<{ actions: PendingAction[] }>("/api/ops/actions?status=pending");
      setPending(data.actions ?? []);
    } catch {
      // non-fatal, chat still works
    }
  }

  async function send(overrideText?: string) {
    const userText = (overrideText ?? input).trim();
    if (!userText || loading) return;
    setMessages((m) => [...m, { role: "user", text: userText }]);
    setInput("");
    setLoading(true);
    try {
      // Worker chat endpoint is a separate Cloudflare Worker (no Clerk session),
      // so it stays a plain fetch — not routed through customFetch's api-server base.
      const res = await fetch(`${WORKER_URL}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: userText }),
      });
      const data = await res.json();
      const { text, suggestions } = parseReply(data.reply ?? "(no response)");
      setMessages((m) => [...m, { role: "bot", text, suggestions }]);
    } catch (err) {
      setMessages((m) => [...m, { role: "bot", text: `Error: ${String(err)}` }]);
    } finally {
      setLoading(false);
    }
  }

  async function decide(id: number, decision: "approve" | "reject") {
    await customFetch(`/api/ops/actions/${id}/${decision}`, { method: "POST" });
    if (decision === "approve") {
      await customFetch(`/api/ops/actions/${id}/execute`, { method: "POST" });
    }
    loadPending();
  }

  return (
    <div className="flex h-full flex-col gap-4 p-4 md:flex-row">
      {/* Chat panel */}
      <div className="flex flex-1 flex-col rounded-lg border border-neutral-800 bg-neutral-900">
        <div className="border-b border-neutral-800 px-4 py-3">
          <h1 className="text-sm font-semibold text-neutral-100">Ops Agent</h1>
          <p className="text-xs text-neutral-500">Owner-only. Site manager bot.</p>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
          {messages.map((m, i) => (
            <div key={i} className={m.role === "user" ? "ml-auto max-w-[80%]" : "max-w-[80%]"}>
              <div
                className={`rounded-lg px-3 py-2 text-sm ${
                  m.role === "user"
                    ? "bg-blue-600 text-white"
                    : "bg-neutral-800 text-neutral-100"
                }`}
              >
                {m.text}
              </div>
              {m.role === "bot" && m.suggestions && m.suggestions.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {m.suggestions.map((s, si) => (
                    <button
                      key={si}
                      onClick={() => send(s)}
                      disabled={loading}
                      className="rounded-full border border-neutral-700 bg-neutral-900 px-2.5 py-1 text-xs text-neutral-300 hover:border-blue-500 hover:text-blue-400 disabled:opacity-50"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
          {loading && <div className="text-xs text-neutral-500">thinking…</div>}
          <div ref={bottomRef} />
        </div>
        <div className="flex gap-2 border-t border-neutral-800 p-3">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder="Ask about health, errors, signups…"
            className="flex-1 rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-blue-500"
          />
          <button
            onClick={() => send()}
            disabled={loading}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </div>

      {/* Pending actions panel */}
      <div className="w-full rounded-lg border border-neutral-800 bg-neutral-900 md:w-80">
        <div className="border-b border-neutral-800 px-4 py-3">
          <h2 className="text-sm font-semibold text-neutral-100">Pending Actions</h2>
        </div>
        <div className="space-y-3 p-3">
          {pending.length === 0 && (
            <p className="text-xs text-neutral-500">No pending actions.</p>
          )}
          {pending.map((a) => (
            <div key={a.id} className="rounded-md border border-neutral-800 p-3">
              <p className="text-xs font-medium text-neutral-200">{a.actionType}</p>
              <p className="mt-1 text-xs text-neutral-400">{a.description}</p>
              {a.reasoning && (
                <p className="mt-1 text-xs italic text-neutral-500">{a.reasoning}</p>
              )}
              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => decide(a.id, "approve")}
                  className="rounded bg-green-700 px-2 py-1 text-xs text-white"
                >
                  Approve
                </button>
                <button
                  onClick={() => decide(a.id, "reject")}
                  className="rounded bg-red-700 px-2 py-1 text-xs text-white"
                >
                  Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
