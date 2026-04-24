import { useEffect, useRef, type DependencyList, type RefObject } from "react";

const NEAR_BOTTOM_PX = 80;

export function useStickToBottom(
  sentinelRef: RefObject<HTMLElement | null>,
  deps: DependencyList
) {
  const isAtBottomRef = useRef(true);

  useEffect(() => {
    const container = sentinelRef.current?.parentElement;
    if (!container) return;

    const update = () => {
      isAtBottomRef.current =
        container.scrollHeight - container.scrollTop - container.clientHeight <=
        NEAR_BOTTOM_PX;
    };
    update();
    container.addEventListener("scroll", update, { passive: true });
    return () => container.removeEventListener("scroll", update);
  }, [sentinelRef]);

  useEffect(() => {
    if (isAtBottomRef.current) {
      sentinelRef.current?.scrollIntoView({ behavior: "smooth" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
