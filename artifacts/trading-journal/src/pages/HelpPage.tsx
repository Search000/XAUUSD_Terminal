import { useState, useRef, useEffect } from "react";
import { MessageCircle, Send, Loader2 } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";

const CHAT_API_URL = "https://xauusd-chatbot.searchoption00.workers.dev/chat";

type ChatMsg = {
  role: "user" | "assistant";
  content: string;
};

export default function HelpPage() {
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
  }, [messages]);

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
    <AppLayout>
      <div className="flex flex-col h-screen">
        {/* Header */}
        <div className="flex items-center gap-2 px-4 sm:px-6 py-4 border-b border-border shrink-0">
          <MessageCircle className="w-5 h-5 text-primary" />
          <span className="text-sm font-mono uppercase tracking-wider text-foreground">
            Terminal Assistant
          </span>
        </div>

        {/* Messages */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto px-4 sm:px-6 py-5 flex flex-col gap-3 max-w-3xl w-full mx-auto"
        >
          {messages.map((m, i) => (
            <div
              key={i}
              className={`max-w-[85%] text-sm leading-relaxed rounded-lg px-3.5 py-2.5 whitespace-pre-wrap ${
                m.role === "user"
                  ? "self-end bg-primary/15 text-foreground border border-primary/20"
                  : "self-start bg-secondary/50 text-foreground border border-border"
              }`}
            >
              {m.content}
            </div>
          ))}
          {isLoading && (
            <div className="self-start flex items-center gap-2 text-sm text-muted-foreground px-3.5 py-2.5">
              <Loader2 className="w-4 h-4 animate-spin" />
              Thinking...
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
              onClick={sendMessage}
              disabled={isLoading || !input.trim()}
              className="text-primary hover:text-primary/80 disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
              aria-label="Send"
            >
              <Send className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
