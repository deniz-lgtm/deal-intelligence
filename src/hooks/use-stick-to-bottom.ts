import { useEffect, useRef, type DependencyList, type RefObject } from "react";

// Engage threshold: when content arrives, auto-scroll only if the user is
// within this distance of the bottom (so a tiny gap doesn't strand them).
const ENGAGE_NEAR_BOTTOM_PX = 80;
// Re-engage threshold: once the user has scrolled away, only restart sticking
// if they manually scroll all the way to the very bottom. Strict so a small
// wheel-up doesn't accidentally re-arm stick on the next message.
const REENGAGE_AT_BOTTOM_PX = 4;

// Auto-scrolls a sentinel into view when `deps` change, but only while the
// user is "stuck" to the bottom. The previous version smooth-scrolled, but
// browser-native smooth scrolls don't cancel on user input — every chunk of
// streamed content fired a fresh animation that fought any wheel/touch
// gesture. This rev:
//   1. Snaps instantly (`behavior: "auto"`) so there's no animation to race.
//   2. Disengages stick immediately on any wheel-up or touch-drag-down.
//   3. Only re-engages when the user themselves scrolls to the very bottom.
export function useStickToBottom(
  sentinelRef: RefObject<HTMLElement | null>,
  deps: DependencyList,
) {
  const stickRef = useRef(true);

  useEffect(() => {
    const container = sentinelRef.current?.parentElement;
    if (!container) return;

    const distFromBottom = () =>
      container.scrollHeight - container.scrollTop - container.clientHeight;

    const onWheel = (e: WheelEvent) => {
      // Any upward wheel intent cancels stick, even if scrollTop hasn't moved
      // far enough yet to leave the engage band.
      if (e.deltaY < 0) stickRef.current = false;
    };

    let touchStartY = 0;
    const onTouchStart = (e: TouchEvent) => {
      touchStartY = e.touches[0]?.clientY ?? 0;
    };
    const onTouchMove = (e: TouchEvent) => {
      const y = e.touches[0]?.clientY ?? 0;
      // Finger dragging downward on screen = content scrolling up = user
      // moving away from the latest message.
      if (y - touchStartY > 4) stickRef.current = false;
    };

    const onScroll = () => {
      // Re-engage when the user has scrolled all the way to the very bottom
      // (also catches our own programmatic scrollIntoView landing at d≈0).
      // Disengage as soon as they leave the engage band — this is what makes
      // scrollbar-drag and keyboard scrolling work, since those don't fire
      // wheel/touch events. Positions in between are left alone so a small
      // wheel-up doesn't accidentally re-arm stick.
      const d = distFromBottom();
      if (d <= REENGAGE_AT_BOTTOM_PX) {
        stickRef.current = true;
      } else if (d > ENGAGE_NEAR_BOTTOM_PX) {
        stickRef.current = false;
      }
    };

    stickRef.current = distFromBottom() <= ENGAGE_NEAR_BOTTOM_PX;

    container.addEventListener("wheel", onWheel, { passive: true });
    container.addEventListener("touchstart", onTouchStart, { passive: true });
    container.addEventListener("touchmove", onTouchMove, { passive: true });
    container.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      container.removeEventListener("wheel", onWheel);
      container.removeEventListener("touchstart", onTouchStart);
      container.removeEventListener("touchmove", onTouchMove);
      container.removeEventListener("scroll", onScroll);
    };
  }, [sentinelRef]);

  useEffect(() => {
    if (!stickRef.current) return;
    // Instant scroll — smooth animations from prior chunks would still be
    // running on the next chunk and fight any user gesture mid-flight.
    sentinelRef.current?.scrollIntoView({ block: "end" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
