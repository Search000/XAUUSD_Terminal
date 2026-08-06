import { useEffect, useRef, useState, useCallback } from "react";
import { useUser, useAuth } from "@clerk/react";
import { Send, ShieldCheck, Wifi, WifiOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { API_BASE_URL, toWsUrl } from "@/lib/apiConfig";

type ChatMessage = {
  id: number;
  senderId: string;
  senderType: "user" | "admin";
  text: string;
  createdAt: string;
};

function getWsBaseUrl(): string {
  return toWsUrl(API_BASE_URL);
}

function timeStr(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function SupportChat() {
  const { user, isLoaded } = useUser();
  const { getToken } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [input, setInput] = useState("");
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(true);
  const wsRef = useRef<WebSocket | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(async () => {
    if (!isLoaded || !user) return;

    setConnecting(true);
    const userId = user.id;
    const email = user.primaryEmailAddress?.emailAddress ?? "";
    // userId/email in the URL are only pre-auth hints; the server verifies
    // identity from this session token and ignores the claimed values.
    const token = await getToken();
    if (!token) {
      setConnecting(false);
      return;
    }
    const url = `${getWsBaseUrl()}/api/chat/ws?userId=${encodeURIComponent(userId)}&email=${encodeURIComponent(email)}&isAdmin=false&token=${encodeURIComponent(token)}`;

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      setConnecting(false);
    };

    ws.onmessage = (e) => {
      try {
        const payload = JSON.parse(e.data as string) as {
          type: string;
          conversationId?: number;
          data?: ChatMessage | ChatMessage[];
        };
        if (payload.type === "history" && Array.isArray(payload.data)) {
          setMessages(payload.data as ChatMessage[]);
          if (payload.conversationId) setConversationId(payload.conversationId);
        } else if (payload.type === "message" && payload.data) {
          setMessages((prev) => {
            const msg = payload.data as ChatMessage;
            if (prev.some((m) => m.id === msg.id)) return prev;
            return [...prev, msg];
          });
        }
      } catch { /* ignore */ }
    };

    ws.onclose = () => {
      setConnected(false);
      setConnecting(false);
      // Auto-reconnect after 3s
      reconnectTimer.current = setTimeout(connect, 3000);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [isLoaded, user]);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = () => {
    const text = input.trim();
    if (!text || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: "send", text }));
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  if (!isLoaded) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  const myId = user?.id ?? "";

  return (
    <div className="flex flex-col border border-border rounded-lg bg-card overflow-hidden" style={{ height: "520px" }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-secondary/30">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-primary" />
          <span className="font-mono text-sm font-semibold text-foreground">Support Chat</span>
          <span className="text-xs text-muted-foreground font-mono">— End-to-end encrypted</span>
        </div>
        <div className="flex items-center gap-1.5">
          {connected ? (
            <>
              <Wifi className="w-3.5 h-3.5 text-green-400" />
              <span className="text-xs text-green-400 font-mono">LIVE</span>
            </>
          ) : (
            <>
              <WifiOff className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground font-mono">
                {connecting ? "Connecting…" : "Reconnecting…"}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Disconnect banner */}
      {!connected && (
        <div className="flex items-center gap-3 px-4 py-2 bg-destructive/10 border-b border-destructive/30 text-destructive flex-shrink-0">
          <WifiOff className="w-3.5 h-3.5 shrink-0" />
          <span className="text-xs font-mono font-medium">
            {connecting ? "Connecting…" : "Connection lost — reconnecting…"}
          </span>
          <span className="ml-auto flex gap-0.5">
            <span className="w-1 h-1 rounded-full bg-destructive animate-bounce [animation-delay:0ms]" />
            <span className="w-1 h-1 rounded-full bg-destructive animate-bounce [animation-delay:150ms]" />
            <span className="w-1 h-1 rounded-full bg-destructive animate-bounce [animation-delay:300ms]" />
          </span>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
            <div className="w-12 h-12 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center">
              <ShieldCheck className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-sm font-semibold">Start a conversation</p>
              <p className="text-xs text-muted-foreground mt-1">
                Messages are encrypted. Admin will respond shortly.
              </p>
            </div>
          </div>
        )}

        {messages.map((msg) => {
          const isMe = msg.senderType === "user";
          return (
            <div key={msg.id} className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[75%] px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed ${
                  isMe
                    ? "bg-primary text-black rounded-br-sm"
                    : "bg-secondary border border-border text-foreground rounded-bl-sm"
                }`}
              >
                {!isMe && (
                  <p className="text-xs font-semibold text-primary mb-1 font-mono">
                    {msg.senderId === "bot" ? "⚡ XAUUSD Bot" : "Team Member"}
                  </p>
                )}
                <p className="whitespace-pre-wrap break-words">{msg.text}</p>
                <p className={`text-[10px] mt-1.5 font-mono ${isMe ? "text-black/50 text-right" : "text-muted-foreground"}`}>
                  {timeStr(msg.createdAt)}
                </p>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-border px-3 py-3 bg-secondary/20">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={connected ? "Type a message… (Enter to send)" : "Connecting…"}
            disabled={!connected}
            rows={2}
            className="flex-1 px-3 py-2 bg-input border border-border rounded-lg text-sm resize-none focus:outline-none focus:border-primary/60 transition-colors disabled:opacity-50 placeholder:text-muted-foreground/40 font-mono"
          />
          <Button
            onClick={sendMessage}
            disabled={!connected || !input.trim()}
            size="sm"
            className="bg-primary text-black hover:bg-amber-400 h-10 w-10 p-0 rounded-lg flex-shrink-0"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground/50 font-mono mt-1.5 flex items-center gap-1">
          <ShieldCheck className="w-3 h-3" /> AES-256-GCM encrypted at rest
        </p>
      </div>
    </div>
  );
}
