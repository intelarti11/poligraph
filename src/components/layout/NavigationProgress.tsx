"use client";

import { useEffect, useState, useCallback } from "react";
import { usePathname, useSearchParams } from "next/navigation";

export function NavigationProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isNavigating, setIsNavigating] = useState(false);

  const onComplete = useCallback(() => {
    setIsNavigating(false);
  }, []);

  useEffect(() => {
    onComplete();
  }, [pathname, searchParams, onComplete]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = (e.target as HTMLElement).closest("a");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("http") || anchor.target === "_blank")
        return;
      const target = new URL(href, window.location.href);
      // A hash only changes scroll position, so no route completion will follow.
      if (
        target.pathname !== window.location.pathname ||
        target.search !== window.location.search
      ) {
        setIsNavigating(true);
      }
    };

    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [pathname, searchParams]);

  if (!isNavigating) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[100] h-1 pointer-events-none" aria-hidden="true">
      <div className="h-full bg-primary animate-progress-bar shadow-[0_0_8px_rgba(var(--primary-rgb,59,130,246),0.5)]" />
    </div>
  );
}
