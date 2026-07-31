import { useEffect, useState } from "react";
import { useListActiveOffers, getListActiveOffersQueryKey } from "@workspace/api-client-react";
import { Tag, X, Sparkles } from "lucide-react";

export function ActiveOfferPopup() {
  const [dismissedOfferId, setDismissedOfferId] = useState<number | null>(null);
  const [offerIndex, setOfferIndex] = useState(0);

  const { data: offers = [] } = useListActiveOffers({
    query: {
      queryKey: getListActiveOffersQueryKey(),
      staleTime: 30_000,
      refetchInterval: 60_000,
    },
  });

  useEffect(() => {
    setOfferIndex(0);
  }, [offers.length]);

  useEffect(() => {
    if (offers.length <= 1) return;

    const rotationTimer = window.setInterval(() => {
      setOfferIndex((currentIndex) => (currentIndex + 1) % offers.length);
    }, 5_000);

    return () => window.clearInterval(rotationTimer);
  }, [offers.length]);

  const offer = offers[offerIndex % Math.max(offers.length, 1)];

  if (!offer || offer.id === dismissedOfferId) {
    return null;
  }

  return (
    <aside
      role="status"
      aria-label="Active offer"
      className="fixed inset-x-4 bottom-5 z-[60] mx-auto max-w-md overflow-hidden rounded-xl border border-amber-400/40 bg-[#17181c]/95 text-white shadow-[0_18px_60px_rgba(0,0,0,0.55),0_0_28px_rgba(245,158,11,0.16)] backdrop-blur-xl sm:inset-x-auto sm:right-6 sm:w-[390px]"
    >
      <div className="flex items-center justify-between border-b border-amber-400/15 bg-amber-400/10 px-4 py-2.5">
        <div className="flex items-center gap-2 text-[11px] font-mono font-semibold uppercase tracking-[0.18em] text-amber-300">
          <Sparkles className="h-3.5 w-3.5" />
          Special Offer
        </div>
        <button
          type="button"
          aria-label="Dismiss offer"
          onClick={() => setDismissedOfferId(offer.id)}
          className="rounded-md p-1 text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="p-4">
        <div className="flex gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-400/15 text-amber-300">
            <Tag className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-bold tracking-tight">{offer.title}</h2>
            {offer.description && (
              <p className="mt-1 text-sm leading-5 text-slate-300">{offer.description}</p>
            )}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 font-mono text-xs">
          {offer.badge && (
            <span className="rounded-md bg-amber-400 px-2.5 py-1 font-bold text-black">
              {offer.badge}
            </span>
          )}
          {offer.price != null && (
            <span className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 font-semibold text-white">
              ${offer.price}
            </span>
          )}
          {offer.originalPrice != null && (
            <span className="text-slate-400 line-through">
              ${offer.originalPrice}
            </span>
          )}
        </div>
      </div>
    </aside>
  );
}
