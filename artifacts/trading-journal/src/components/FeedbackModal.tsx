import { useState } from "react";
import { createPortal } from "react-dom";
import { Star, X, Send, Loader2 } from "lucide-react";
import { useSubmitFeedback } from "@workspace/api-client-react";

interface Props {
  onClose: () => void;
  onSubmitted: () => void;
}

const LABELS = ["", "Poor", "Fair", "Good", "Great", "Excellent!"];

export function FeedbackModal({ onClose, onSubmitted }: Props) {
  const [rating, setRating] = useState(0);
  const [hovered, setHovered] = useState(0);
  const [comment, setComment] = useState("");
  const [done, setDone] = useState(false);

  const { mutate: submitFeedback, isPending: loading } = useSubmitFeedback({
    mutation: {
      onSuccess: () => {
        setDone(true);
        setTimeout(() => { onSubmitted(); onClose(); }, 1800);
      },
      onError: () => {
        // silently fail — feedback is optional
        onClose();
      },
    },
  });

  const displayed = hovered || rating;

  const handleSubmit = () => {
    if (!rating || loading) return;
    submitFeedback({ data: { rating, comment: comment.trim() || undefined } });
  };

  return createPortal(
    <div
      style={{ position: "fixed", inset: 0, zIndex: 99999, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

      <div
        className="relative w-full max-w-sm bg-card border border-border rounded-2xl shadow-2xl p-6 flex flex-col items-center text-center animate-in fade-in zoom-in-95 duration-200"
        onClick={e => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-muted-foreground hover:text-white transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        {done ? (
          <>
            <div className="w-14 h-14 rounded-full bg-green-500/10 border border-green-500/30 flex items-center justify-center mb-4">
              <Star className="w-7 h-7 text-green-400 fill-green-400" />
            </div>
            <h2 className="text-lg font-bold text-white mb-2">Thanks for your feedback!</h2>
            <p className="text-sm text-muted-foreground">Your rating helps us improve the terminal.</p>
          </>
        ) : (
          <>
            {/* Icon */}
            <div className="w-12 h-12 rounded-full bg-primary/10 border border-primary/25 flex items-center justify-center mb-4">
              <Star className="w-6 h-6 text-primary" />
            </div>

            <h2 className="text-lg font-bold text-white mb-1">How was your trial?</h2>
            <p className="text-sm text-muted-foreground mb-5">
              Rate your experience with the XAUUSD Terminal
            </p>

            {/* Stars */}
            <div className="flex items-center gap-2 mb-2">
              {[1, 2, 3, 4, 5].map(n => (
                <button
                  key={n}
                  onMouseEnter={() => setHovered(n)}
                  onMouseLeave={() => setHovered(0)}
                  onClick={() => setRating(n)}
                  className="transition-transform hover:scale-110 active:scale-95"
                  aria-label={`Rate ${n}`}
                >
                  <Star
                    className={`w-8 h-8 transition-colors ${
                      n <= displayed
                        ? "text-primary fill-primary"
                        : "text-muted-foreground/40"
                    }`}
                  />
                </button>
              ))}
            </div>

            {/* Rating label */}
            <p className={`text-sm font-semibold mb-4 h-5 transition-opacity ${displayed ? "opacity-100 text-primary" : "opacity-0"}`}>
              {LABELS[displayed]}
            </p>

            {/* Optional comment */}
            <textarea
              value={comment}
              onChange={e => setComment(e.target.value)}
              placeholder="Anything you'd like to share? (optional)"
              maxLength={300}
              rows={3}
              className="w-full bg-secondary/60 border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/50 resize-none mb-4 transition-colors"
            />

            <button
              onClick={handleSubmit}
              disabled={!rating || loading}
              className="w-full flex items-center justify-center gap-2 bg-primary text-black font-semibold rounded-lg py-2.5 hover:bg-amber-400 transition-colors text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {loading ? "Submitting…" : "Submit Rating"}
            </button>

            <button
              onClick={onClose}
              className="mt-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Maybe later
            </button>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
