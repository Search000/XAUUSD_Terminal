import { useState, useRef, useEffect } from "react";
import { MessageCircle, Send, Loader2, LifeBuoy, ThumbsUp, ThumbsDown } from "lucide-react";
import { useAuth } from "@clerk/react";
import { Link as WouterLink, useLocation } from "wouter";
import { AppLayout } from "@/components/AppLayout";
import { API_BASE_URL } from "@/lib/apiConfig";

const CHAT_API_URL = "https://xauusd-chatbot.searchoption00.workers.dev/chat";

type ChatMsg = {
  id?: number;
  role: "user" | "assistant";
  content: string;
  feedback?: "up" | "down" | null;
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

/** Splits a raw bot reply into { text, suggestions } — parses the trailing <suggestions>a|b|c</suggestions> block.
 *  Tolerant of a truncated/unclosed tag (e.g. response cut short) — in that case the tag is just stripped. */
function parseReply(raw: string): { text: string; suggestions: string[] } {
  const closedMatch = raw.match(/<suggestions>(.*?)<\/suggestions>/s);
  if (closedMatch) {
    const suggestions = closedMatch[1].split("|").map((s) => s.trim()).filter(Boolean).slice(0, 3);
    const text = raw.replace(closedMatch[0], "").trim();
    return { text, suggestions };
  }
  // Unclosed/truncated tag — drop everything from the opening tag onward, no suggestions to show
  const openIndex = raw.indexOf("<suggestions>");
  if (openIndex !== -1) {
    return { text: raw.slice(0, openIndex).trim(), suggestions: [] };
  }
  return { text: raw.trim(), suggestions: [] };
}

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
  const [followUps, setFollowUps] = useState<string[]>([]);
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

  const saveMessage = async (msg: ChatMsg): Promise<number | undefined> => {
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE_URL}/api/assistant/history`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ role: msg.role, content: msg.content }),
      });
      const data = await res.json();
      return data.id;
    } catch {
      // non-critical — conversation still works locally even if a save fails
      return undefined;
    }
  };

  const [feedbackModal, setFeedbackModal] = useState<{ index: number; rating: "up" | "down" } | null>(null);
  const [feedbackCategory, setFeedbackCategory] = useState("");
  const [feedbackNote, setFeedbackNote] = useState("");

  const NEGATIVE_CATEGORIES = [
    "Wrong or inaccurate info",
    "Didn't understand my question",
    "Language mismatch",
    "Broken or wrong link",
    "Slow / didn't respond",
    "Rude or unhelpful tone",
    "Other",
  ];
  const POSITIVE_CATEGORIES = [
    "Solved my problem",
    "Fast and accurate",
    "Explained clearly",
    "Found the right page",
    "Other",
  ];

  const submitFeedback = async () => {
    if (!feedbackModal) return;
    const { index, rating } = feedbackModal;
    const combinedNote = [feedbackCategory, feedbackNote.trim()].filter(Boolean).join(" — ");
    setMessages((prev) => prev.map((m, i) => (i === index ? { ...m, feedback: rating } : m)));
    const msg = messages[index];
    setFeedbackModal(null);
    setFeedbackCategory("");
    setFeedbackNote("");
    if (!msg?.id) return;
    try {
      const token = await getToken();
      await fetch(`${API_BASE_URL}/api/assistant/history/${msg.id}/feedback`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ rating, note: combinedNote || undefined }),
      });
    } catch {
      // best-effort only
    }
  };

  const clearFeedback = async (index: number) => {
    setMessages((prev) => prev.map((m, i) => (i === index ? { ...m, feedback: null } : m)));
    const msg = messages[index];
    if (!msg?.id) return;
    try {
      const token = await getToken();
      await fetch(`${API_BASE_URL}/api/assistant/history/${msg.id}/feedback`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ rating: null }),
      });
    } catch {
      // best-effort only
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
    setFollowUps([]);
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
      const { text, suggestions } = parseReply(data.reply || "Sorry, I couldn't process that.");
      const replyMsg: ChatMsg = { role: "assistant", content: text };
      setMessages((prev) => [...prev, replyMsg]);
      setFollowUps(suggestions);
      const id = await saveMessage(replyMsg);
      if (id) setMessages((prev) => prev.map((m, i) => (i === prev.length - 1 ? { ...m, id } : m)));
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
                  <div key={i} className={`flex flex-col gap-1 ${m.role === "user" ? "items-end" : "items-start"}`}>
                    <div
                      className={`max-w-[85%] text-sm leading-relaxed rounded-lg px-3.5 py-2.5 whitespace-pre-wrap ${
                        m.role === "user"
                          ? "bg-primary/15 text-foreground border border-primary/20"
                          : "bg-secondary/50 text-foreground border border-border"
                      }`}
                    >
                      {m.role === "assistant" ? <MessageContent text={m.content} /> : m.content}
                    </div>
                    {m.role === "assistant" && i > 0 && (
                      <div className="flex items-center gap-1 px-1">
                        <button
                          type="button"
                          onClick={() =>
                            m.feedback === "up" ? clearFeedback(i) : setFeedbackModal({ index: i, rating: "up" })
                          }
                          aria-label="Good reply"
                          className={`p-1.5 rounded transition-colors ${
                            m.feedback === "up"
                              ? "text-green-500 bg-green-500/15"
                              : "text-muted-foreground/50 hover:bg-secondary/60"
                          }`}
                        >
                          <ThumbsUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            m.feedback === "down" ? clearFeedback(i) : setFeedbackModal({ index: i, rating: "down" })
                          }
                          aria-label="Bad reply"
                          className={`p-1.5 rounded transition-colors ${
                            m.feedback === "down"
                              ? "text-red-500 bg-red-500/15"
                              : "text-muted-foreground/50 hover:bg-secondary/60"
                          }`}
                        >
                          <ThumbsDown className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
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

              {followUps.length > 0 && !isLoading && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {followUps.map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => sendMessage(q)}
                      className="text-xs px-3 py-1.5 rounded-full border border-primary/30 bg-primary/10 hover:bg-primary/20 text-primary transition-colors"
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

      {/* Feedback detail modal */}
      {feedbackModal && (
        <div className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-card border border-border rounded-lg shadow-2xl p-4">
            <p className="text-sm font-medium text-foreground mb-1">
              {feedbackModal.rating === "up" ? "Give positive feedback" : "Give negative feedback"}
            </p>
            <p className="text-xs text-muted-foreground mb-1">What type of issue is this? (optional)</p>
            <select
              value={feedbackCategory}
              onChange={(e) => setFeedbackCategory(e.target.value)}
              className="w-full bg-secondary/40 border border-border rounded px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 mb-3"
            >
              <option value="">Select...</option>
              {(feedbackModal.rating === "up" ? POSITIVE_CATEGORIES : NEGATIVE_CATEGORIES).map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground mb-1">Add a detail (optional)</p>
            <textarea
              value={feedbackNote}
              onChange={(e) => setFeedbackNote(e.target.value)}
              placeholder="Tell us more..."
              rows={3}
              className="w-full bg-secondary/40 border border-border rounded px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 resize-none"
            />
            <div className="flex justify-end gap-2 mt-3">
              <button
                type="button"
                onClick={() => {
                  setFeedbackModal(null);
                  setFeedbackCategory("");
                  setFeedbackNote("");
                }}
                className="text-xs px-3 py-1.5 rounded border border-border text-muted-foreground hover:bg-secondary/40"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitFeedback}
                className="text-xs px-3 py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90"
              >
                Submit
              </button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
