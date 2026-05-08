import { useEffect, useRef, type DependencyList, type RefObject } from "react";

const NEAR_BOTTOM_PX = 80;
// Smooth-scroll animations rarely run longer than this. While the timer is
// active we ignore `scroll` events so the animation doesn't keep "fixing"
// our isAtBottom flag mid-flight.
const PROGRAMMATIC_SCROLL_GUARD_MS = 600;

// Auto-scrolls a sentinel into view whenever `deps` change, but only when
// the user is already pinned near the bottom. The previous version trusted
// `scroll` events alone — but the smooth-scroll animation itself fires scroll
// events that re-pin isAtBottom to true, so a user scrolling up while content
// streams in would get yanked back to the bottom on every chunk. This rev
// distinguishes user-initiated scroll (wheel / touchmove) from programmatic
// scroll, and disengages stick the moment the user actually moves the
// viewport away from the bottom.
export function useStickToBottom(
  sentinelRef: RefObject<HTMLElement | null>,
  deps: DependencyList,
) {
  const stickRef = useRef(true);
  const programmaticRef = useRef(false);
  const programmaticTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const container = sentinelRef.current?.parentElement;
    if (!container) return;

    const isNearBottom = () =>
      container.scrollHeight - container.scrollTop - container.clientHeight <=
      NEAR_BOTTOM_PX;

    // Real user input. Cancel any in-flight programmatic-scroll guard so the
    // resulting scroll event below is treated as the user's, not ours.
    const onUserIntent = () => {
      programmaticRef.current = false;
      if (programmaticTimerRef.current != null) {
        clearTimeout(programmaticTimerRef.current);
        programmaticTimerRef.current = null;
      }
    };

    const onScroll = () => {
      if (programmaticRef.current) return;
      stickRef.current = isNearBottom();
    };

    stickRef.current = isNearBottom();

    container.addEventListener("wheel", onUserIntent, { passive: true });
    container.addEventListener("touchmove", onUserIntent, { passive: true });
    container.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      container.removeEventListener("wheel", onUserIntent);
      container.removeEventListener("touchmove", onUserIntent);
      container.removeEventListener("scroll", onScroll);
    };
  }, [sentinelRef]);

  useEffect(() => {
    if (!stickRef.current) return;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    programmaticRef.current = true;
    sentinel.scrollIntoView({ behavior: "smooth" });

    if (programmaticTimerRef.current != null) {
      clearTimeout(programmaticTimerRef.current);
    }
    programmaticTimerRef.current = window.setTimeout(() => {
      programmaticRef.current = false;
      programmaticTimerRef.current = null;
    }, PROGRAMMATIC_SCROLL_GUARD_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
