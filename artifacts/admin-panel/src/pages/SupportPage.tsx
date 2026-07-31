import { useEffect, useRef, useState, useCallback } from "react";
import { useAuth } from "@clerk/react";
import {
  MessageCircle,
  Send,
  ShieldCheck,
  Wifi,
  WifiOff,
  Loader2,
  Clock,
  User,
} from "lucide-react";

type Conversation = {
  id: number;
  userId: string;
  email: string;
  status: "open" | "closed";
  createdAt: string;
  updatedAt: string;
};

type ChatMessage = {
  id: number;
  senderId: string;
  senderType: "user" | "admin";
  text: string;
  createdAt: string;
};

function getWsBaseUrl(): string {
  const apiUrl = (import.meta.env.VITE_API_URL as string | undefined) ?? "";
  if (!apiUrl) return `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}`;
  // Extract only the origin (protocol + host) from VITE_API_URL.
  // If VITE_API_URL includes a path like "/api", we must strip it here
  // because the WebSocket URL already appends "/api/chat/ws" itself.
  // Without this, the path would be duplicated: wss://host/api/api/chat/ws
  try {
    const { protocol, host } = new URL(apiUrl);
    const wsProtocol = protocol === "https:" ? "wss:" : "ws:";
    return `${wsProtocol}//${host}`;
  } catch {
    // Fallback: naively replace protocol if URL parsing fails
    return apiUrl.replace(/^https?:\/\/([^/]*).*/, (_, h, offset, str) =>
      `${str.startsWith("https") ? "wss" : "ws"}://${h}`
    );
  }
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function timeStr(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function SupportPage() {
  const { userId, getToken } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selected, setSelected] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(true);
  const wsRef = useRef<WebSocket | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(async () => {
    if (!userId) return;
    setConnecting(true);
    const token = await getToken();
    const url = `${getWsBaseUrl()}/api/chat/ws?userId=${encodeURIComponent(userId)}&isAdmin=true${token ? `&token=${encodeURIComponent(token)}` : ""}`;

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
          data?: unknown;
          userId?: string;
          userEmail?: string;
        };

        if (payload.type === "conversations" && Array.isArray(payload.data)) {
          setConversations(payload.data as Conversation[]);
        } else if (payload.type === "history" && Array.isArray(payload.data)) {
          setMessages(payload.data as ChatMessage[]);
        } else if (payload.type === "message" && payload.data) {
          const msg = payload.data as ChatMessage;
          // Update conversation list (move to top, refresh updatedAt)
          if (payload.conversationId !== undefined) {
            const convId = payload.conversationId;
            setConversations((prev) => {
              const updated = prev.map((c) =>
                c.id === convId ? { ...c, updatedAt: new Date().toISOString() } : c
              );
              // Sort by updatedAt desc
              return [...updated].sort(
                (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
              );
            });
            // Add to current conversation if it's open
            setSelected((sel) => {
              if (sel && sel.id === convId) {
                setMessages((prev) => {
                  if (prev.some((m) => m.id === msg.id)) return prev;
                  return [...prev, msg];
                });
              }
              return sel;
            });
          }
        }
      } catch { /* ignore */ }
    };

    ws.onclose = () => {
      setConnected(false);
      setConnecting(false);
      reconnectTimer.current = setTimeout(connect, 3000);
    };
    ws.onerror = () => ws.close();
  }, [userId, getToken]);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const openConversation = (conv: Conversation) => {
    setSelected(conv);
    setMessages([]);
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "get_history", conversationId: conv.id }));
    }
  };

  const sendReply = () => {
    const text = input.trim();
    if (!text || !selected || wsRef.current?.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: "send", text, conversationId: selected.id }));
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendReply();
    }
  };

  return (
    <div className="p-6 h-[calc(100vh-80px)] flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-2xl font-bold font-mono tracking-tight">Support Chat</h1>
          <p className="text-sm text-muted-foreground mt-1">Real-time encrypted conversations with users</p>
        </div>
        <div className="flex items-center gap-1.5">
          {connected ? (
            <>
              <Wifi className="w-4 h-4 text-green-400" />
              <span className="text-xs text-green-400 font-mono font-semibold">LIVE</span>
            </>
          ) : (
            <>
              <WifiOff className="w-4 h-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground font-mono">
                {connecting ? "Connecting…" : "Reconnecting…"}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Disconnect banner */}
      {!connected && (
        <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive flex-shrink-0">
          <WifiOff className="w-4 h-4 shrink-0" />
          <span className="text-sm font-mono font-medium">
            {connecting ? "Connecting to server…" : "Connection lost — reconnecting…"}
          </span>
          <span className="ml-auto flex gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-destructive animate-bounce [animation-delay:0ms]" />
            <span className="w-1.5 h-1.5 rounded-full bg-destructive animate-bounce [animation-delay:150ms]" />
            <span className="w-1.5 h-1.5 rounded-full bg-destructive animate-bounce [animation-delay:300ms]" />
          </span>
        </div>
      )}

      {/* Main chat layout */}
      <div className="flex flex-1 gap-4 min-h-0 border border-border rounded-lg overflow-hidden">
        {/* Conversation List */}
        <div className="w-72 flex-shrink-0 border-r border-border overflow-y-auto bg-secondary/10">
          <div className="p-3 border-b border-border">
            <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
              Conversations ({conversations.length})
            </p>
          </div>

          {connecting && conversations.length === 0 && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          )}

          {!connecting && conversations.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-12 px-4 text-center">
              <MessageCircle className="w-8 h-8 text-muted-foreground/40" />
              <p className="text-xs text-muted-foreground">No conversations yet</p>
            </div>
          )}

          {conversations.map((conv) => (
            <button
              key={conv.id}
              onClick={() => openConversation(conv)}
              className={`w-full text-left px-4 py-3 border-b border-border/50 hover:bg-secondary/40 transition-colors ${
                selected?.id === conv.id ? "bg-primary/10 border-l-2 border-l-primary" : ""
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center flex-shrink-0">
                    <User className="w-3.5 h-3.5 text-muted-foreground" />
                  </div>
                  <p className="text-xs font-mono truncate text-foreground">
                    {conv.email || conv.userId.slice(0, 16) + "…"}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1 mt-1.5 ml-9">
                <Clock className="w-3 h-3 text-muted-foreground/60" />
                <span className="text-[10px] text-muted-foreground/60 font-mono">
                  {timeAgo(conv.updatedAt)}
                </span>
              </div>
            </button>
          ))}
        </div>

        {/* Chat Area */}
        <div className="flex-1 flex flex-col min-w-0">
          {!selected ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-8">
              <div className="w-14 h-14 rounded-full bg-secondary/60 flex items-center justify-center">
                <MessageCircle className="w-7 h-7 text-muted-foreground/50" />
              </div>
              <p className="text-sm text-muted-foreground">
                Select a conversation to start chatting
              </p>
            </div>
          ) : (
            <>
              {/* Chat Header */}
              <div className="px-4 py-3 border-b border-border bg-secondary/20 flex items-center justify-between flex-shrink-0">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center">
                    <User className="w-3.5 h-3.5 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold font-mono">{selected.email || selected.userId}</p>
                    <p className="text-[10px] text-muted-foreground font-mono">Conv #{selected.id}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <ShieldCheck className="w-3.5 h-3.5 text-primary/60" />
                  <span className="text-[10px] text-muted-foreground/60 font-mono">AES-256-GCM</span>
                </div>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
                {messages.length === 0 && (
                  <div className="flex items-center justify-center h-full">
                    <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                  </div>
                )}
                {messages.map((msg) => {
                  const isAdmin = msg.senderType === "admin";
                  return (
                    <div key={msg.id} className={`flex ${isAdmin ? "justify-end" : "justify-start"}`}>
                      <div
                        className={`max-w-[75%] px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed ${
                          isAdmin
                            ? "bg-primary text-black rounded-br-sm"
                            : "bg-secondary border border-border text-foreground rounded-bl-sm"
                        }`}
                      >
                        {!isAdmin && (
                          <p className="text-xs font-semibold text-primary mb-1 font-mono">
                            {selected.email || "User"}
                          </p>
                        )}
                        {isAdmin && msg.senderId === "bot" && (
                          <p className="text-xs font-semibold text-amber-300/70 mb-1 font-mono">⚡ XAUUSD Bot</p>
                        )}
                        <p className="whitespace-pre-wrap break-words">{msg.text}</p>
                        <p className={`text-[10px] mt-1.5 font-mono ${isAdmin ? "text-black/50 text-right" : "text-muted-foreground"}`}>
                          {timeStr(msg.createdAt)}
                        </p>
                      </div>
                    </div>
                  );
                })}
                <div ref={bottomRef} />
              </div>

              {/* Input */}
              <div className="border-t border-border px-3 py-3 bg-secondary/10 flex-shrink-0">
                <div className="flex items-end gap-2">
                  <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={connected ? "Reply to user… (Enter to send)" : "Connecting…"}
                    disabled={!connected}
                    rows={2}
                    className="flex-1 px-3 py-2 bg-input border border-border rounded-lg text-sm resize-none focus:outline-none focus:border-primary/60 transition-colors disabled:opacity-50 placeholder:text-muted-foreground/40 font-mono"
                  />
                  <button
                    onClick={sendReply}
                    disabled={!connected || !input.trim()}
                    className="h-10 w-10 rounded-lg bg-primary text-black hover:bg-amber-400 transition-colors disabled:opacity-40 flex items-center justify-center flex-shrink-0"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
