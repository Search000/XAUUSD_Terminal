import { useState, useRef, useEffect } from "react";
import { MessageCircle, X, Send, Loader2 } from "lucide-react";

const CHAT_API_URL = "https://xauusd-chatbot.searchoption00.workers.dev/chat";

type ChatMsg = {
  role: "user" | "assistant";
  content: string;
};

export function HelpChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>([
    {
      role: "assistant",
      content: "Hi! I'm here to help with the terminal. Ask me anything about how to use it.",
    },
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, isOpen]);

  const sendMessage = async () => {
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;

    const newMessages: ChatMsg[] = [...messages, { role: "user", content: trimmed }];
    setMessages(newMessages);
    setInput("");
    setIsLoading(true);

    try {
      const res = await fetch(CHAT_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmed,
          history: newMessages.slice(-10).map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      const data = await res.json();
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.reply || "Sorry, I couldn't process that." },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Connection issue. Please try again in a moment." },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      {/* Trigger button — sits in the sidebar empty space */}
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        title="Need help?"
        className="w-full text-xs font-mono uppercase tracking-wider text-primary border border-primary/30 bg-primary/10 hover:bg-primary/20 transition-colors px-1 sm:px-2.5 py-2 rounded flex items-center justify-center sm:justify-start gap-2"
      >
        <MessageCircle className="w-3.5 h-3.5 shrink-0" />
        <span className="hidden sm:inline">Need help?</span>
      </button>

      {/* Floating chat panel */}
      {isOpen && (
        <div className="fixed bottom-4 right-4 z-[100] w-[92vw] max-w-sm h-[70vh] max-h-[520px] bg-card border border-border rounded-lg shadow-2xl flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-border bg-secondary/40 shrink-0">
            <div className="flex items-center gap-2">
              <MessageCircle className="w-4 h-4 text-primary" />
              <span className="text-xs font-mono uppercase tracking-wider text-foreground">
                Terminal Assistant
              </span>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Close chat"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-2.5">
            {messages.map((m, i) => (
              <div
                key={i}
                className={`max-w-[85%] text-xs leading-relaxed rounded-lg px-3 py-2 whitespace-pre-wrap ${
                  m.role === "user"
                    ? "self-end bg-primary/15 text-foreground border border-primary/20"
                    : "self-start bg-secondary/50 text-foreground border border-border"
                }`}
              >
                {m.content}
              </div>
            ))}
            {isLoading && (
              <div className="self-start flex items-center gap-2 text-xs text-muted-foreground px-3 py-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Thinking...
              </div>
            )}
          </div>

          {/* Input */}
          <div className="border-t border-border p-2 flex items-center gap-2 shrink-0">
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
              className="flex-1 bg-secondary/40 border border-border rounded px-2.5 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
            />
            <button
              type="button"
              onClick={sendMessage}
              disabled={isLoading || !input.trim()}
              className="text-primary hover:text-primary/80 disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
              aria-label="Send"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
