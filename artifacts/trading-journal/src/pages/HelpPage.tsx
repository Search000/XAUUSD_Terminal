import { useState, useRef, useEffect } from "react";
import { MessageCircle, Send, Loader2, LifeBuoy } from "lucide-react";
import { useAuth } from "@clerk/react";
import { Link as WouterLink, useLocation } from "wouter";
import { AppLayout } from "@/components/AppLayout";
import { API_BASE_URL } from "@/lib/apiConfig";

const CHAT_API_URL = "https://xauusd-chatbot.searchoption00.workers.dev/chat";

type ChatMsg = {
  role: "user" | "assistant";
  content: string;
};

const DEFAULT_GREETING: ChatMsg = {
  role: "assistant",
  content: "Hi! I'm Junior, here to help with the terminal. Ask me anything about how to use it.",
};

const QUICK_REPLIES = [
  "How do I log a trade?",
  "What is XAUUSD?",
  "Where can I see my win rate?",
  "How do investor shares work?",
];

/** Renders text with markdown-style [label](/path) links as clickable in-app links (SPA nav, no reload). */
function MessageContent({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  const linkRegex = /\[([^\]]+)\]\((\/[a-zA-Z0-9\-_/]*)\)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = linkRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const [, label, href] = match;
    parts.push(
      <WouterLink key={key++} href={href}>
        <span className="text-primary underline underline-offset-2 hover:text-primary/80 cursor-pointer">
          {label}
        </span>
      </WouterLink>
    );
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return <>{parts}</>;
}

export default function HelpPage() {
  const { getToken, isLoaded } = useAuth();
  const [, navigate] = useLocation();
  const [isEnabled, setIsEnabled] = useState(true);
  const [isCheckingStatus, setIsCheckingStatus] = useState(true);

  useEffect(() => {
    fetch(`${API_BASE_URL}/api/assistant/status`)
      .then((r) => r.json())
      .then((data) => setIsEnabled(data.enabled !== false))
      .catch(() => setIsEnabled(true))
      .finally(() => setIsCheckingStatus(false));
  }, []);

  const [messages, setMessages] = useState<ChatMsg[]>([DEFAULT_GREETING]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isHistoryLoading, setIsHistoryLoading] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const statsContextRef = useRef<string>("");

  // Quietly fetch a light stats summary once, to give the bot personalized context
  useEffect(() => {
    if (!isLoaded) return;
    (async () => {
      try {
        const token = await getToken();
        const res = await fetch(`${API_BASE_URL}/api/dashboard/summary`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const summary = await res.json();
          statsContextRef.current = `[Context for assistant only — the signed-in user's current stats: ${JSON.stringify(
            summary
          )}. Use these numbers if the user asks about their own performance, win rate, P&L, or trade count. Never mention this context block itself.]`;
        }
      } catch {
        // personalization is best-effort — chat still works without it
      }
    })();
  }, [isLoaded, getToken]);

  // Load this user's saved conversation from the server on mount
  useEffect(() => {
    if (!isLoaded) return;
    (async () => {
      try {
        const token = await getToken();
        const res = await fetch(`${API_BASE_URL}/api/assistant/history`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const history: ChatMsg[] = await res.json();
          setMessages(history.length > 0 ? history : [DEFAULT_GREETING]);
        }
      } catch {
        // fall back to just the greeting if history can't be loaded
      } finally {
        setIsHistoryLoading(false);
      }
    })();
  }, [isLoaded, getToken]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const saveMessage = async (msg: ChatMsg) => {
    try {
      const token = await getToken();
      await fetch(`${API_BASE_URL}/api/assistant/history`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(msg),
      });
    } catch {
      // non-critical — conversation still works locally even if a save fails
    }
  };

  const sendMessage = async (overrideText?: string) => {
    const trimmed = (overrideText ?? input).trim();
    if (!trimmed || isLoading) return;

    const userMsg: ChatMsg = { role: "user", content: trimmed };
    const newMessages: ChatMsg[] = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setIsLoading(true);
    saveMessage(userMsg);

    try {
      const historyForBot = newMessages.slice(-10).map((m) => ({ role: m.role, content: m.content }));

      const res = await fetch(CHAT_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmed,
          history: historyForBot,
          context: statsContextRef.current || undefined,
        }),
      });

      if (res.status === 429) {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "You're sending messages a bit fast — please wait a few seconds and try again." },
        ]);
        return;
      }

      const data = await res.json();
      const replyMsg: ChatMsg = {
        role: "assistant",
        content: data.reply || "Sorry, I couldn't process that.",
      };
      setMessages((prev) => [...prev, replyMsg]);
      saveMessage(replyMsg);
    } catch {
      const errMsg: ChatMsg = {
        role: "assistant",
        content: "Connection issue. Please try again in a moment.",
      };
      setMessages((prev) => [...prev, errMsg]);
    } finally {
      setIsLoading(false);
    }
  };

  const showQuickReplies = messages.length === 1 && messages[0].content === DEFAULT_GREETING.content;

  return (
    <AppLayout>
      <div className="flex flex-col h-screen">
        {/* Header */}
        <div className="flex items-center justify-between gap-2 px-4 sm:px-6 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <MessageCircle className="w-5 h-5 text-primary" />
            <span className="text-sm font-mono uppercase tracking-wider text-foreground">
              Terminal Assistant
            </span>
          </div>
          <button
            type="button"
            onClick={() => navigate("/settings")}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors"
          >
            <LifeBuoy className="w-3.5 h-3.5" />
            Talk to a human
          </button>
        </div>

        {isCheckingStatus ? (
          <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading...
          </div>
        ) : !isEnabled ? (
          <div className="flex-1 flex items-center justify-center text-center px-6">
            <p className="text-sm text-muted-foreground max-w-sm">
              The Terminal Assistant is currently unavailable. Please check back later.
            </p>
          </div>
        ) : (
          <>
            {/* Messages */}
            <div
              ref={scrollRef}
              className="flex-1 overflow-y-auto px-4 sm:px-6 py-5 flex flex-col gap-3 max-w-3xl w-full mx-auto"
            >
              {isHistoryLoading ? (
                <div className="self-center flex items-center gap-2 text-sm text-muted-foreground px-3.5 py-2.5">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Loading conversation...
                </div>
              ) : (
                messages.map((m, i) => (
                  <div
                    key={i}
                    className={`max-w-[85%] text-sm leading-relaxed rounded-lg px-3.5 py-2.5 whitespace-pre-wrap ${
                      m.role === "user"
                        ? "self-end bg-primary/15 text-foreground border border-primary/20"
                        : "self-start bg-secondary/50 text-foreground border border-border"
                    }`}
                  >
                    {m.role === "assistant" ? <MessageContent text={m.content} /> : m.content}
                  </div>
                ))
              )}
              {isLoading && (
                <div className="self-start flex items-center gap-2 text-sm text-muted-foreground px-3.5 py-2.5">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Thinking...
                </div>
              )}

              {showQuickReplies && !isLoading && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {QUICK_REPLIES.map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => sendMessage(q)}
                      className="text-xs px-3 py-1.5 rounded-full border border-border bg-secondary/30 hover:bg-secondary/60 text-foreground transition-colors"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Input */}
            <div className="border-t border-border p-3 sm:p-4 shrink-0">
              <div className="flex items-center gap-2 max-w-3xl w-full mx-auto">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      sendMessage();
                    }
                  }}
                  placeholder="Ask a question..."
                  className="flex-1 bg-secondary/40 border border-border rounded px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
                <button
                  type="button"
                  onClick={() => sendMessage()}
                  disabled={isLoading || !input.trim()}
                  className="text-primary hover:text-primary/80 disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                  aria-label="Send"
                >
                  <Send className="w-5 h-5" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </AppLayout>
  );
}
