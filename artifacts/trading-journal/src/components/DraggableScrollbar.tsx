import { useEffect, useRef, useState, useCallback } from 'react';

// A visible, always-on scrollbar on the right edge of the page that can be
// pressed and dragged (mouse OR touch) to scroll the whole page. Native
// mobile scrollbars are thin, auto-hiding, and not really "grabbable" — this
// gives users an explicit bar they can hold onto and drag up/down.
const TRACK_WIDTH = 14;
const MIN_THUMB_HEIGHT = 36;

export function DraggableScrollbar() {
  const [visible, setVisible] = useState(false);
  const [thumbTop, setThumbTop] = useState(0);
  const [thumbHeight, setThumbHeight] = useState(MIN_THUMB_HEIGHT);
  const draggingRef = useRef(false);
  const dragStartYRef = useRef(0);
  const dragStartScrollRef = useRef(0);
  const trackRef = useRef<HTMLDivElement | null>(null);

  const recompute = useCallback(() => {
    const doc = document.documentElement;
    const scrollHeight = doc.scrollHeight;
    const viewportHeight = window.innerHeight;
    const scrollable = scrollHeight - viewportHeight;

    if (scrollable <= 4) {
      setVisible(false);
      return;
    }
    setVisible(true);

    const rawThumbHeight = (viewportHeight / scrollHeight) * viewportHeight;
    const height = Math.max(MIN_THUMB_HEIGHT, Math.min(viewportHeight, rawThumbHeight));
    setThumbHeight(height);

    const scrollTop = window.scrollY || doc.scrollTop;
    const maxThumbTravel = viewportHeight - height;
    const ratio = scrollTop / scrollable;
    setThumbTop(Math.max(0, Math.min(maxThumbTravel, ratio * maxThumbTravel)));
  }, []);

  useEffect(() => {
    recompute();
    window.addEventListener('scroll', recompute, { passive: true });
    window.addEventListener('resize', recompute);
    // Content height can change after async data loads (charts, panels) —
    // poll briefly on mount/route-change so the thumb size stays accurate.
    const poll = setInterval(recompute, 1000);
    return () => {
      window.removeEventListener('scroll', recompute);
      window.removeEventListener('resize', recompute);
      clearInterval(poll);
    };
  }, [recompute]);

  const scrollToRatio = useCallback((clientY: number) => {
    const viewportHeight = window.innerHeight;
    const scrollHeight = document.documentElement.scrollHeight;
    const scrollable = scrollHeight - viewportHeight;
    const maxThumbTravel = viewportHeight - thumbHeight;
    const ratio = Math.max(0, Math.min(1, (clientY - thumbHeight / 2) / maxThumbTravel));
    window.scrollTo({ top: ratio * scrollable, behavior: 'auto' });
  }, [thumbHeight]);

  const onThumbPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    draggingRef.current = true;
    dragStartYRef.current = e.clientY;
    dragStartScrollRef.current = window.scrollY;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const onThumbPointerMove = useCallback((e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    e.preventDefault();
    const viewportHeight = window.innerHeight;
    const scrollHeight = document.documentElement.scrollHeight;
    const scrollable = scrollHeight - viewportHeight;
    const maxThumbTravel = viewportHeight - thumbHeight;
    if (maxThumbTravel <= 0) return;
    const deltaY = e.clientY - dragStartYRef.current;
    const deltaScroll = (deltaY / maxThumbTravel) * scrollable;
    window.scrollTo({ top: dragStartScrollRef.current + deltaScroll, behavior: 'auto' });
  }, [thumbHeight]);

  const onThumbPointerUp = useCallback((e: React.PointerEvent) => {
    draggingRef.current = false;
    try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* noop */ }
  }, []);

  const onTrackPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.target !== trackRef.current) return; // let the thumb handle its own events
    scrollToRatio(e.clientY);
  }, [scrollToRatio]);

  if (!visible) return null;

  return (
    <div
      ref={trackRef}
      onPointerDown={onTrackPointerDown}
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        width: TRACK_WIDTH,
        height: '100vh',
        zIndex: 1500,
        background: 'rgba(255,255,255,0.03)',
        touchAction: 'none',
      }}
    >
      <div
        onPointerDown={onThumbPointerDown}
        onPointerMove={onThumbPointerMove}
        onPointerUp={onThumbPointerUp}
        onPointerCancel={onThumbPointerUp}
        style={{
          position: 'absolute',
          top: thumbTop,
          right: 2,
          width: TRACK_WIDTH - 4,
          height: thumbHeight,
          borderRadius: 5,
          background: 'rgba(212,168,67,0.55)',
          border: '1px solid rgba(212,168,67,0.7)',
          touchAction: 'none',
          cursor: 'grab',
        }}
      />
    </div>
  );
}
